// FILE: push-service.js
// Purpose: Stores session-scoped push registration state and sends APNs/Web Push alerts for relay-hosted Remodex sessions.
// Layer: Relay push helper
// Exports: createPushSessionService, createFileBackedPushStateStore, resolvePushStateFilePath
// Depends on: crypto, fs, os, path, ./apns-client, ./web-push-client

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAPNsClient } = require("./apns-client");
const { createWebPushClient, webPushConfigFromEnv } = require("./web-push-client");

const PUSH_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const PUSH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PUSH_PREVIEW_MAX_CHARS = 160;

function createPushSessionService({
  apnsClient = createAPNsClient(apnsConfigFromEnv(process.env)),
  webPushClient = null,
  canRegisterSession = () => true,
  canNotifyCompletion = null,
  now = () => Date.now(),
  logPrefix = "[relay]",
  stateStore = createFileBackedPushStateStore({
    stateFilePath: resolvePushStateFilePath(process.env),
  }),
} = {}) {
  const resolvedCanNotifyCompletion = typeof canNotifyCompletion === "function"
    ? canNotifyCompletion
    : canRegisterSession;
  const persistedState = stateStore.read();
  const sessions = new Map(persistedState.sessions || []);
  const deliveredDedupeKeys = new Map(persistedState.deliveredDedupeKeys || []);
  let vapidKeys = normalizeVapidKeys(persistedState.vapidKeys);
  const envWebPushConfig = webPushConfigFromEnv(process.env);
  const resolvedWebPushClient = webPushClient || createWebPushClient({
    ...envWebPushConfig,
    publicKey: envWebPushConfig.publicKey || vapidKeys?.publicKey || "",
    privateKey: envWebPushConfig.privateKey || vapidKeys?.privateKey || "",
  });
  vapidKeys = normalizeVapidKeys(resolvedWebPushClient.getVapidKeys?.()) || vapidKeys;
  pruneStaleState();

  async function registerDevice({
    sessionId,
    notificationSecret,
    deviceToken,
    alertsEnabled,
    apnsEnvironment,
  } = {}) {
    const normalizedSessionId = readString(sessionId);
    const normalizedSecret = readString(notificationSecret);
    const normalizedDeviceToken = normalizeDeviceToken(deviceToken);

    if (!normalizedSessionId || !normalizedSecret || !normalizedDeviceToken) {
      throw pushServiceError(
        "invalid_request",
        "Push registration requires sessionId, notificationSecret, and deviceToken.",
        400
      );
    }

    if (!await canRegisterSession({
      sessionId: normalizedSessionId,
      notificationSecret: normalizedSecret,
    })) {
      throw pushServiceError(
        "session_unavailable",
        "Push registration requires an active relay session.",
        403
      );
    }

    const existing = sessions.get(normalizedSessionId);
    if (existing && !secretsEqual(existing.notificationSecret, normalizedSecret)) {
      throw pushServiceError("unauthorized", "Invalid notification secret for this session.", 403);
    }

    sessions.set(normalizedSessionId, {
      ...(existing || {}),
      notificationSecret: normalizedSecret,
      deviceToken: normalizedDeviceToken,
      alertsEnabled: Boolean(alertsEnabled),
      apnsEnvironment: apnsEnvironment === "development" ? "development" : "production",
      updatedAt: now(),
    });
    persistState("registerDevice");
    return { ok: true };
  }

  async function registerWebPush({
    sessionId,
    notificationSecret,
    subscription,
    alertsEnabled = true,
  } = {}) {
    const normalizedSessionId = readString(sessionId);
    const normalizedSecret = readString(notificationSecret);
    const normalizedSubscription = normalizeWebPushSubscription(subscription);

    if (!normalizedSessionId || !normalizedSecret || !normalizedSubscription) {
      throw pushServiceError(
        "invalid_request",
        "Web Push registration requires sessionId, notificationSecret, and subscription.",
        400
      );
    }

    if (!resolvedWebPushClient.isConfigured()) {
      throw pushServiceError(
        "web_push_unavailable",
        "Web Push is not configured for this relay.",
        503
      );
    }

    if (!await canRegisterSession({
      sessionId: normalizedSessionId,
      notificationSecret: normalizedSecret,
    })) {
      throw pushServiceError(
        "session_unavailable",
        "Web Push registration requires an active relay session.",
        403
      );
    }

    const existing = sessions.get(normalizedSessionId);
    if (existing && !secretsEqual(existing.notificationSecret, normalizedSecret)) {
      throw pushServiceError("unauthorized", "Invalid notification secret for this session.", 403);
    }

    const subscriptions = upsertWebPushSubscription(
      existing?.webPushSubscriptions,
      normalizedSubscription
    );
    sessions.set(normalizedSessionId, {
      ...(existing || {}),
      notificationSecret: normalizedSecret,
      alertsEnabled: Boolean(alertsEnabled),
      webPushSubscriptions: subscriptions,
      updatedAt: now(),
    });
    persistState("registerWebPush");
    return { ok: true, subscriptions: subscriptions.length };
  }

  async function unregisterWebPush({
    sessionId,
    notificationSecret,
    endpoint,
  } = {}) {
    const normalizedSessionId = readString(sessionId);
    const normalizedSecret = readString(notificationSecret);
    const normalizedEndpoint = readString(endpoint);

    if (!normalizedSessionId || !normalizedSecret) {
      throw pushServiceError(
        "invalid_request",
        "Web Push unregister requires sessionId and notificationSecret.",
        400
      );
    }

    const existing = sessions.get(normalizedSessionId);
    if (!existing) {
      return { ok: true, skipped: true };
    }
    if (!secretsEqual(existing.notificationSecret, normalizedSecret)) {
      throw pushServiceError("unauthorized", "Invalid notification secret for this session.", 403);
    }

    const currentSubscriptions = normalizeWebPushSubscriptions(existing.webPushSubscriptions);
    const webPushSubscriptions = normalizedEndpoint
      ? currentSubscriptions.filter((entry) => entry.endpoint !== normalizedEndpoint)
      : [];
    sessions.set(normalizedSessionId, {
      ...existing,
      webPushSubscriptions,
      updatedAt: now(),
    });
    persistState("unregisterWebPush");
    return { ok: true, subscriptions: webPushSubscriptions.length };
  }

  async function notifyCompletion({
    sessionId,
    notificationSecret,
    threadId,
    turnId,
    result,
    title,
    body,
    dedupeKey,
  } = {}) {
    const normalizedSessionId = readString(sessionId);
    const normalizedSecret = readString(notificationSecret);
    const normalizedThreadId = readString(threadId);
    const normalizedResult = result === "failed" ? "failed" : "completed";
    const normalizedDedupeKey = readString(dedupeKey);

    if (!normalizedSessionId || !normalizedSecret || !normalizedThreadId || !normalizedDedupeKey) {
      throw pushServiceError(
        "invalid_request",
        "Push completion requires sessionId, notificationSecret, threadId, and dedupeKey.",
        400
      );
    }

    if (!await resolvedCanNotifyCompletion({
      sessionId: normalizedSessionId,
      notificationSecret: normalizedSecret,
    })) {
      throw pushServiceError(
        "session_unavailable",
        "Push completion requires an active relay session.",
        403
      );
    }

    pruneDeliveredDedupeKeys();
    if (deliveredDedupeKeys.has(normalizedDedupeKey)) {
      return { ok: true, deduped: true };
    }

    const session = sessions.get(normalizedSessionId);
    if (!session || !secretsEqual(session.notificationSecret, normalizedSecret)) {
      throw pushServiceError("unauthorized", "Invalid notification secret for this session.", 403);
    }

    if (!session.alertsEnabled) {
      return { ok: true, skipped: true };
    }

    const alert = {
      title: normalizePreviewText(title) || "New Thread",
      body: normalizePreviewText(body) || fallbackBodyForResult(normalizedResult),
      payload: {
        source: "codex.runCompletion",
        kind: normalizedResult === "failed" ? "failed" : "ready",
        threadId: normalizedThreadId,
        turnId: readString(turnId) || "",
        result: normalizedResult,
      },
    };
    const delivery = await sendChannelNotifications(session, alert, normalizedDedupeKey);
    if (!delivery.delivered) {
      if (delivery.errors.length) {
        throw delivery.errors[0];
      }
      return { ok: true, skipped: true };
    }

    if (delivery.updatedSession) {
      sessions.set(normalizedSessionId, delivery.updatedSession);
    }

    deliveredDedupeKeys.set(normalizedDedupeKey, now());
    persistState("notifyCompletion");
    return { ok: true, channels: delivery.channels };
  }

  async function notifyAttention({
    sessionId,
    notificationSecret,
    threadId,
    turnId,
    requestId,
    title,
    body,
    dedupeKey,
  } = {}) {
    const normalizedSessionId = readString(sessionId);
    const normalizedSecret = readString(notificationSecret);
    const normalizedThreadId = readString(threadId);
    const normalizedDedupeKey = readString(dedupeKey);

    if (!normalizedSessionId || !normalizedSecret || !normalizedThreadId || !normalizedDedupeKey) {
      throw pushServiceError(
        "invalid_request",
        "Push attention requires sessionId, notificationSecret, threadId, and dedupeKey.",
        400
      );
    }

    if (!await resolvedCanNotifyCompletion({
      sessionId: normalizedSessionId,
      notificationSecret: normalizedSecret,
    })) {
      throw pushServiceError(
        "session_unavailable",
        "Push attention requires an active relay session.",
        403
      );
    }

    pruneDeliveredDedupeKeys();
    if (deliveredDedupeKeys.has(normalizedDedupeKey)) {
      return { ok: true, deduped: true };
    }

    const session = sessions.get(normalizedSessionId);
    if (!session || !secretsEqual(session.notificationSecret, normalizedSecret)) {
      throw pushServiceError("unauthorized", "Invalid notification secret for this session.", 403);
    }

    if (!session.alertsEnabled) {
      return { ok: true, skipped: true };
    }

    const alert = {
      title: normalizePreviewText(title) || "New Thread",
      body: normalizePreviewText(body) || "Codex needs approval to continue.",
      payload: {
        source: "codex.approvalRequired",
        kind: "approval",
        threadId: normalizedThreadId,
        turnId: readString(turnId) || "",
        requestId: readString(requestId) || "",
      },
    };
    const delivery = await sendChannelNotifications(session, alert, normalizedDedupeKey);
    if (!delivery.delivered) {
      if (delivery.errors.length) {
        throw delivery.errors[0];
      }
      return { ok: true, skipped: true };
    }

    if (delivery.updatedSession) {
      sessions.set(normalizedSessionId, delivery.updatedSession);
    }

    deliveredDedupeKeys.set(normalizedDedupeKey, now());
    persistState("notifyAttention");
    return { ok: true, channels: delivery.channels };
  }

  async function sendChannelNotifications(session, alert, dedupeKey) {
    let delivered = 0;
    const channels = [];
    const errors = [];
    let updatedSession = null;

    if (session.deviceToken && apnsClient.isConfigured()) {
      try {
        await apnsClient.sendNotification({
          deviceToken: session.deviceToken,
          apnsEnvironment: session.apnsEnvironment,
          title: alert.title,
          body: alert.body,
          payload: alert.payload,
        });
        delivered += 1;
        channels.push("apns");
      } catch (error) {
        errors.push(error);
      }
    }

    const subscriptions = normalizeWebPushSubscriptions(session.webPushSubscriptions);
    if (subscriptions.length && resolvedWebPushClient.isConfigured()) {
      const remainingSubscriptions = [];
      for (const subscription of subscriptions) {
        try {
          const result = await resolvedWebPushClient.sendNotification({
            subscription,
            payload: {
              ...alert.payload,
              title: alert.title,
              body: alert.body,
              tag: dedupeKey,
            },
          });
          if (result?.expired) {
            updatedSession = {
              ...(updatedSession || session),
              webPushSubscriptions: remainingSubscriptions,
              updatedAt: now(),
            };
            continue;
          }
          if (result?.ok) {
            delivered += 1;
            channels.push("web");
          }
          remainingSubscriptions.push(subscription);
        } catch (error) {
          errors.push(error);
          remainingSubscriptions.push(subscription);
        }
      }

      if (updatedSession) {
        updatedSession.webPushSubscriptions = remainingSubscriptions;
      }
    }

    return {
      delivered,
      channels,
      errors,
      updatedSession,
    };
  }

  function getWebPushPublicKey() {
    return resolvedWebPushClient.getPublicKey?.() || "";
  }

  function getStats() {
    pruneDeliveredDedupeKeys();
    return {
      registeredSessions: sessions.size,
      deliveredDedupeKeys: deliveredDedupeKeys.size,
      apnsConfigured: apnsClient.isConfigured(),
      webPushConfigured: resolvedWebPushClient.isConfigured(),
      webPushSubscriptions: [...sessions.values()].reduce((count, session) => {
        return count + normalizeWebPushSubscriptions(session.webPushSubscriptions).length;
      }, 0),
    };
  }

  function pruneDeliveredDedupeKeys() {
    let didChange = false;
    const cutoff = now() - PUSH_DEDUPE_TTL_MS;
    for (const [key, timestamp] of deliveredDedupeKeys.entries()) {
      if (timestamp < cutoff) {
        deliveredDedupeKeys.delete(key);
        didChange = true;
      }
    }
    return didChange;
  }

  function pruneSessions() {
    let didChange = false;
    const cutoff = now() - PUSH_SESSION_TTL_MS;
    for (const [sessionId, session] of sessions.entries()) {
      if (Number(session?.updatedAt || 0) < cutoff) {
        sessions.delete(sessionId);
        didChange = true;
      }
    }
    return didChange;
  }

  function pruneStaleState() {
    if (pruneDeliveredDedupeKeys() || pruneSessions()) {
      persistState("pruneStaleState");
    }
  }

  // Keeps live registrations usable even if the optional state file cannot be updated.
  function persistState(reason) {
    try {
      stateStore.write({
        sessions: [...sessions.entries()],
        deliveredDedupeKeys: [...deliveredDedupeKeys.entries()],
        vapidKeys,
      });
    } catch (error) {
      console.error(
        `${logPrefix} push state persistence failed during ${reason}: ${error.message}`
      );
    }
  }

  return {
    registerDevice,
    registerWebPush,
    unregisterWebPush,
    notifyCompletion,
    notifyAttention,
    getWebPushPublicKey,
    getStats,
  };
}

function createFileBackedPushStateStore({ stateFilePath } = {}) {
  const resolvedPath = typeof stateFilePath === "string" && stateFilePath.trim()
    ? stateFilePath.trim()
    : "";

  return {
    read() {
      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        return emptyPushState();
      }

      const parsed = safeParseJSON(fs.readFileSync(resolvedPath, "utf8"));
      if (!parsed || typeof parsed !== "object") {
        return emptyPushState();
      }

      return {
        sessions: normalizeEntryList(parsed.sessions),
        deliveredDedupeKeys: normalizeEntryList(parsed.deliveredDedupeKeys),
        vapidKeys: normalizeVapidKeys(parsed.vapidKeys),
      };
    },
    write(state) {
      if (!resolvedPath) {
        return;
      }

      const normalizedState = {
        sessions: normalizeEntryList(state?.sessions),
        deliveredDedupeKeys: normalizeEntryList(state?.deliveredDedupeKeys),
        vapidKeys: normalizeVapidKeys(state?.vapidKeys),
      };
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      const tempPath = `${resolvedPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(normalizedState), {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(tempPath, resolvedPath);
      try {
        fs.chmodSync(resolvedPath, 0o600);
      } catch {
        // Best-effort only on filesystems that support POSIX modes.
      }
    },
  };
}

function apnsConfigFromEnv(env) {
  return {
    teamId: readFirstDefinedEnv(["REMODEX_APNS_TEAM_ID", "PHODEX_APNS_TEAM_ID"], env),
    keyId: readFirstDefinedEnv(["REMODEX_APNS_KEY_ID", "PHODEX_APNS_KEY_ID"], env),
    bundleId: readFirstDefinedEnv(["REMODEX_APNS_BUNDLE_ID", "PHODEX_APNS_BUNDLE_ID"], env),
    privateKey: readAPNsPrivateKey(env),
  };
}

function readAPNsPrivateKey(env) {
  const rawValue = readFirstDefinedEnv(["REMODEX_APNS_PRIVATE_KEY", "PHODEX_APNS_PRIVATE_KEY"], env);
  if (rawValue) {
    return rawValue;
  }

  const filePath = readFirstDefinedEnv(
    ["REMODEX_APNS_PRIVATE_KEY_FILE", "PHODEX_APNS_PRIVATE_KEY_FILE"],
    env
  );
  if (!filePath) {
    return "";
  }

  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readFirstDefinedEnv(keys, env) {
  for (const key of keys) {
    const value = readString(env?.[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeDeviceToken(value) {
  const normalized = readString(value);
  if (!normalized) {
    return "";
  }

  return normalized.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

function normalizeWebPushSubscription(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const endpoint = readString(value.endpoint);
  const keys = value.keys && typeof value.keys === "object" && !Array.isArray(value.keys)
    ? value.keys
    : {};
  const p256dh = readString(keys.p256dh);
  const auth = readString(keys.auth);
  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  const normalized = {
    endpoint,
    keys: {
      p256dh,
      auth,
    },
  };
  if (typeof value.expirationTime === "number") {
    normalized.expirationTime = value.expirationTime;
  } else if (value.expirationTime === null) {
    normalized.expirationTime = null;
  }
  return normalized;
}

function normalizeWebPushSubscriptions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeWebPushSubscription).filter(Boolean);
}

function upsertWebPushSubscription(existingSubscriptions, subscription) {
  return [
    subscription,
    ...normalizeWebPushSubscriptions(existingSubscriptions).filter((entry) => {
      return entry.endpoint !== subscription.endpoint;
    }),
  ].slice(0, 4);
}

function normalizeVapidKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const publicKey = readString(value.publicKey);
  const privateKey = readString(value.privateKey);
  if (!publicKey || !privateKey) {
    return null;
  }
  return { publicKey, privateKey };
}

function normalizePreviewText(value) {
  const normalized = readString(value).replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  return normalized.length > PUSH_PREVIEW_MAX_CHARS
    ? `${normalized.slice(0, PUSH_PREVIEW_MAX_CHARS - 1).trimEnd()}…`
    : normalized;
}

function fallbackBodyForResult(result) {
  return result === "failed" ? "Run failed" : "Response ready";
}

function resolvePushStateFilePath(env = process.env) {
  const explicitPath = readFirstDefinedEnv(
    ["REMODEX_PUSH_STATE_FILE", "PHODEX_PUSH_STATE_FILE"],
    env
  );
  if (explicitPath) {
    return explicitPath;
  }

  const codexHome = readString(env.CODEX_HOME) || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "remodex", "push-state.json");
}

function normalizeEntryList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => Array.isArray(entry) && entry.length === 2);
}

function emptyPushState() {
  return {
    sessions: [],
    deliveredDedupeKeys: [],
    vapidKeys: null,
  };
}

function safeParseJSON(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function secretsEqual(left, right) {
  const leftBuffer = Buffer.from(readString(left));
  const rightBuffer = Buffer.from(readString(right));
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function pushServiceError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

module.exports = {
  createPushSessionService,
  createFileBackedPushStateStore,
  resolvePushStateFilePath,
};
