// FILE: web-push-client.js
// Purpose: Sends browser Web Push notifications using local/self-hosted VAPID credentials.
// Layer: Relay push helper
// Exports: createWebPushClient, webPushConfigFromEnv
// Depends on: web-push

const DEFAULT_VAPID_SUBJECT = "mailto:remodex-local@example.invalid";

function createWebPushClient({
  webPushImpl = loadWebPushImplementation(),
  publicKey = "",
  privateKey = "",
  subject = DEFAULT_VAPID_SUBJECT,
  generateKeys = true,
} = {}) {
  const resolvedSubject = readString(subject) || DEFAULT_VAPID_SUBJECT;
  let resolvedPublicKey = readString(publicKey);
  let resolvedPrivateKey = readString(privateKey);
  let unavailableReason = "";

  if (!webPushImpl) {
    unavailableReason = "web-push dependency is not installed";
  } else if ((!resolvedPublicKey || !resolvedPrivateKey) && generateKeys) {
    try {
      const generated = webPushImpl.generateVAPIDKeys();
      resolvedPublicKey = readString(generated?.publicKey);
      resolvedPrivateKey = readString(generated?.privateKey);
    } catch (error) {
      unavailableReason = `VAPID key generation failed: ${error.message}`;
    }
  }

  if (webPushImpl && resolvedPublicKey && resolvedPrivateKey) {
    try {
      webPushImpl.setVapidDetails(resolvedSubject, resolvedPublicKey, resolvedPrivateKey);
    } catch (error) {
      unavailableReason = `VAPID configuration failed: ${error.message}`;
    }
  }

  async function sendNotification({ subscription, payload, ttlSeconds = 300 } = {}) {
    if (!isConfigured()) {
      return { ok: false, skipped: true, reason: unavailableReason || "web_push_not_configured" };
    }

    try {
      await webPushImpl.sendNotification(subscription, JSON.stringify(payload || {}), {
        TTL: ttlSeconds,
      });
      return { ok: true };
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        return { ok: false, expired: true, statusCode: error.statusCode };
      }
      throw error;
    }
  }

  function isConfigured() {
    return Boolean(webPushImpl && resolvedPublicKey && resolvedPrivateKey && !unavailableReason);
  }

  return {
    getPublicKey() {
      return resolvedPublicKey;
    },
    getVapidKeys() {
      return {
        publicKey: resolvedPublicKey,
        privateKey: resolvedPrivateKey,
      };
    },
    isConfigured,
    sendNotification,
    unavailableReason() {
      return unavailableReason;
    },
  };
}

function webPushConfigFromEnv(env = process.env) {
  return {
    publicKey: readFirstDefinedEnv(
      ["REMODEX_WEB_PUSH_PUBLIC_KEY", "PHODEX_WEB_PUSH_PUBLIC_KEY", "VAPID_PUBLIC_KEY"],
      env
    ),
    privateKey: readFirstDefinedEnv(
      ["REMODEX_WEB_PUSH_PRIVATE_KEY", "PHODEX_WEB_PUSH_PRIVATE_KEY", "VAPID_PRIVATE_KEY"],
      env
    ),
    subject: readFirstDefinedEnv(
      ["REMODEX_WEB_PUSH_SUBJECT", "PHODEX_WEB_PUSH_SUBJECT", "VAPID_SUBJECT"],
      env
    ) || DEFAULT_VAPID_SUBJECT,
  };
}

function loadWebPushImplementation() {
  try {
    return require("web-push");
  } catch {
    return null;
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

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  createWebPushClient,
  webPushConfigFromEnv,
};
