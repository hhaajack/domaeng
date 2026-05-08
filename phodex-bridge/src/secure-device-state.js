// FILE: secure-device-state.js
// Purpose: Persists canonical bridge identity, trusted-phone state, and last seen iPhone app version for local QR pairing.
// Layer: CLI helper
// Exports: local bridge identity, trusted-device state, and safe trusted-device management helpers
// Depends on: fs, os, path, crypto, child_process

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash, randomUUID, generateKeyPairSync } = require("crypto");
const { execFileSync } = require("child_process");

const DEFAULT_STORE_DIR = path.join(os.homedir(), ".remodex");
const DEFAULT_STORE_FILE = path.join(DEFAULT_STORE_DIR, "device-state.json");
const KEYCHAIN_SERVICE = "com.remodex.bridge.device-state";
const KEYCHAIN_ACCOUNT = "default";
let hasLoggedKeychainMismatch = false;

// Loads the canonical bridge state or bootstraps a fresh one when no trusted state exists yet.
function loadOrCreateBridgeDeviceState() {
  const fileRecord = readCanonicalFileStateRecord();
  const keychainRecord = readKeychainStateRecord();

  if (fileRecord.state) {
    reconcileLegacyKeychainMirror(fileRecord.state, keychainRecord);
    return fileRecord.state;
  }

  if (fileRecord.error) {
    if (keychainRecord.state) {
      warnOnce(
        "[domaeng] Recovering the canonical device-state.json from the legacy Keychain pairing mirror."
      );
      writeBridgeDeviceState(keychainRecord.state);
      return keychainRecord.state;
    }
    throw corruptedStateError("device-state.json", fileRecord.error);
  }

  if (keychainRecord.error) {
    warnOnce(
      "[domaeng] Ignoring unreadable legacy Keychain pairing mirror; generating a fresh canonical device-state.json."
    );
    const nextState = createBridgeDeviceState();
    writeBridgeDeviceState(nextState);
    return nextState;
  }

  if (keychainRecord.state) {
    writeBridgeDeviceState(keychainRecord.state);
    return keychainRecord.state;
  }

  const nextState = createBridgeDeviceState();
  writeBridgeDeviceState(nextState);
  return nextState;
}

function readBridgeDeviceState() {
  const fileRecord = readCanonicalFileStateRecord();
  if (fileRecord.state) {
    return fileRecord.state;
  }

  const keychainRecord = readKeychainStateRecord();
  return keychainRecord.state || null;
}

// Removes the saved bridge identity/trust state so the next `domaeng up` requires a fresh QR pairing.
function resetBridgeDeviceState() {
  const removedCanonicalFile = deleteCanonicalFileState();
  const removedKeychainMirror = deleteKeychainStateString();
  return {
    hadState: removedCanonicalFile || removedKeychainMirror,
    removedCanonicalFile,
    removedKeychainMirror,
  };
}

// Generates a fresh relay session for every bridge launch so QR pairing stays explicit per-run.
function resolveBridgeRelaySession(state, { persist = true } = {}) {
  return {
    deviceState: state,
    isPersistent: false,
    sessionId: randomUUID(),
  };
}

// Persists a trusted phone identity so reconnects can be authenticated by device.
function rememberTrustedPhone(
  state,
  phoneDeviceId,
  phoneIdentityPublicKey,
  {
    persist = true,
    displayName = "",
    deviceKind = "",
    now = new Date(),
  } = {}
) {
  const normalizedDeviceId = normalizeNonEmptyString(phoneDeviceId);
  const normalizedPublicKey = normalizeNonEmptyString(phoneIdentityPublicKey);
  if (!normalizedDeviceId || !normalizedPublicKey) {
    return state;
  }

  const currentState = normalizeBridgeDeviceState(state);
  const existingMetadata = currentState.trustedPhoneMetadata?.[normalizedDeviceId] || {};
  const trustedAt = normalizeDateString(existingMetadata.trustedAt) || dateToISOString(now);
  const normalizedDisplayName = normalizeDisplayName(displayName) || existingMetadata.displayName || "";
  const normalizedDeviceKind = normalizeDeviceKind(deviceKind) || existingMetadata.deviceKind || inferTrustedDeviceKind(normalizedDeviceId);

  // Multiple browser/mobile installs may trust the same Mac; a new device must
  // not invalidate an older device's reconnect credential.
  const nextState = normalizeBridgeDeviceState({
    ...currentState,
    trustedPhones: {
      ...(currentState.trustedPhones || {}),
      [normalizedDeviceId]: normalizedPublicKey,
    },
    trustedPhoneMetadata: {
      ...(currentState.trustedPhoneMetadata || {}),
      [normalizedDeviceId]: {
        displayName: normalizedDisplayName,
        deviceKind: normalizedDeviceKind,
        trustedAt,
        lastSeenAt: dateToISOString(now),
        disabledAt: null,
      },
    },
  });
  if (persist) {
    writeBridgeDeviceState(nextState);
  }
  return nextState;
}

function rememberLastSeenPhoneAppVersion(state, phoneAppVersion, { persist = true } = {}) {
  const normalizedPhoneAppVersion = normalizeNonEmptyString(phoneAppVersion);
  if (!normalizedPhoneAppVersion) {
    return state;
  }

  const nextState = normalizeBridgeDeviceState({
    ...state,
    lastSeenPhoneAppVersion: normalizedPhoneAppVersion,
  });
  if (persist) {
    writeBridgeDeviceState(nextState);
  }
  return nextState;
}

function getTrustedPhonePublicKey(state, phoneDeviceId) {
  const normalizedState = normalizeBridgeDeviceState(state);
  const normalizedDeviceId = normalizeNonEmptyString(phoneDeviceId);
  if (!normalizedDeviceId) {
    return null;
  }
  if (isTrustedPhoneDisabled(normalizedState, normalizedDeviceId)) {
    return null;
  }
  return normalizedState.trustedPhones?.[normalizedDeviceId] || null;
}

function getEnabledTrustedPhones(state) {
  const allTrustedPhones = normalizeTrustedPhonesMap(state?.trustedPhones);
  const trustedPhoneMetadata = normalizeTrustedPhoneMetadata(state?.trustedPhoneMetadata, allTrustedPhones);
  const enabledTrustedPhones = {};
  for (const [deviceId, publicKey] of Object.entries(allTrustedPhones || {})) {
    if (isTrustedPhoneDisabled({ trustedPhoneMetadata }, deviceId)) {
      continue;
    }
    enabledTrustedPhones[deviceId] = publicKey;
  }
  return enabledTrustedPhones;
}

function readTrustedDevicesSnapshot() {
  const state = readBridgeDeviceState();
  return listTrustedDevices(state);
}

function listTrustedDevices(state) {
  if (!state) {
    return [];
  }
  const normalizedState = normalizeBridgeDeviceState(state);
  return Object.entries(normalizedState.trustedPhones || {})
    .map(([deviceId, publicKey]) => trustedDeviceSnapshot(normalizedState, deviceId, publicKey))
    .sort(compareTrustedDeviceSnapshots);
}

function setTrustedDeviceEnabled(deviceRecordId, enabled, { now = new Date() } = {}) {
  const state = loadOrCreateBridgeDeviceState();
  const match = findTrustedDeviceByRecordId(state, deviceRecordId);
  if (!match) {
    throw trustedDeviceNotFoundError(deviceRecordId);
  }

  const existingMetadata = state.trustedPhoneMetadata?.[match.deviceId] || {};
  const nextState = normalizeBridgeDeviceState({
    ...state,
    trustedPhoneMetadata: {
      ...(state.trustedPhoneMetadata || {}),
      [match.deviceId]: {
        ...existingMetadata,
        disabledAt: enabled ? null : dateToISOString(now),
      },
    },
  });
  writeBridgeDeviceState(nextState);
  return {
    trustedDevice: trustedDeviceSnapshot(nextState, match.deviceId, match.publicKey),
    trustedDevices: listTrustedDevices(nextState),
  };
}

function revokeTrustedDevice(deviceRecordId) {
  const state = loadOrCreateBridgeDeviceState();
  const match = findTrustedDeviceByRecordId(state, deviceRecordId);
  if (!match) {
    throw trustedDeviceNotFoundError(deviceRecordId);
  }

  const trustedPhones = { ...(state.trustedPhones || {}) };
  const trustedPhoneMetadata = { ...(state.trustedPhoneMetadata || {}) };
  delete trustedPhones[match.deviceId];
  delete trustedPhoneMetadata[match.deviceId];

  const nextState = normalizeBridgeDeviceState({
    ...state,
    trustedPhones,
    trustedPhoneMetadata,
  });
  writeBridgeDeviceState(nextState);
  return {
    trustedDevice: trustedDeviceSnapshot(state, match.deviceId, match.publicKey),
    trustedDevices: listTrustedDevices(nextState),
  };
}

function renameTrustedDevice(deviceRecordId, displayName) {
  const state = loadOrCreateBridgeDeviceState();
  const match = findTrustedDeviceByRecordId(state, deviceRecordId);
  if (!match) {
    throw trustedDeviceNotFoundError(deviceRecordId);
  }

  const existingMetadata = state.trustedPhoneMetadata?.[match.deviceId] || {};
  const nextState = normalizeBridgeDeviceState({
    ...state,
    trustedPhoneMetadata: {
      ...(state.trustedPhoneMetadata || {}),
      [match.deviceId]: {
        ...existingMetadata,
        displayName: normalizeDisplayName(displayName),
      },
    },
  });
  writeBridgeDeviceState(nextState);
  return {
    trustedDevice: trustedDeviceSnapshot(nextState, match.deviceId, match.publicKey),
    trustedDevices: listTrustedDevices(nextState),
  };
}

function hasTrustedPhones(state) {
  return Object.keys(state?.trustedPhones || {}).length > 0;
}

function createBridgeDeviceState() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privateJwk = privateKey.export({ format: "jwk" });
  const publicJwk = publicKey.export({ format: "jwk" });

  return {
    version: 1,
    macDeviceId: randomUUID(),
    macIdentityPublicKey: base64UrlToBase64(publicJwk.x),
    macIdentityPrivateKey: base64UrlToBase64(privateJwk.d),
    trustedPhones: {},
    trustedPhoneMetadata: {},
    lastSeenPhoneAppVersion: null,
  };
}

// Reads the canonical file-backed state and distinguishes "missing" from "corrupted".
function readCanonicalFileStateRecord() {
  const storeFile = resolveStoreFile();
  if (!fs.existsSync(storeFile)) {
    return { state: null, error: null };
  }

  try {
    return {
      state: normalizeBridgeDeviceState(JSON.parse(fs.readFileSync(storeFile, "utf8"))),
      error: null,
    };
  } catch (error) {
    return { state: null, error };
  }
}

// Reads the legacy Keychain mirror so old installs can be migrated into the canonical file.
function readKeychainStateRecord() {
  const rawState = readKeychainStateString();
  if (!rawState) {
    return { state: null, error: null };
  }

  try {
    return {
      state: normalizeBridgeDeviceState(JSON.parse(rawState)),
      error: null,
    };
  } catch (error) {
    return { state: null, error };
  }
}

function writeBridgeDeviceState(state) {
  const serialized = JSON.stringify(state, null, 2);
  writeCanonicalFileStateString(serialized);
  writeKeychainStateString(serialized);
}

// Keeps the canonical file updated even when the optional Keychain mirror is unavailable.
function writeCanonicalFileStateString(serialized) {
  const storeDir = resolveStoreDir();
  const storeFile = resolveStoreFile();
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(storeFile, serialized, { mode: 0o600 });
  try {
    fs.chmodSync(storeFile, 0o600);
  } catch {
    // Best-effort only on filesystems that support POSIX modes.
  }
}

function resolveStoreDir() {
  return normalizeNonEmptyString(process.env.DOMAENG_DEVICE_STATE_DIR)
    || normalizeNonEmptyString(process.env.REMODEX_DEVICE_STATE_DIR)
    || DEFAULT_STORE_DIR;
}

function resolveStoreFile() {
  return normalizeNonEmptyString(process.env.DOMAENG_DEVICE_STATE_FILE)
    || normalizeNonEmptyString(process.env.REMODEX_DEVICE_STATE_FILE)
    || path.join(resolveStoreDir(), "device-state.json");
}

function resolveBridgeDeviceStateFile() {
  return resolveStoreFile();
}

function resolveKeychainMirrorFile() {
  return normalizeNonEmptyString(process.env.DOMAENG_DEVICE_STATE_KEYCHAIN_MOCK_FILE)
    || normalizeNonEmptyString(process.env.REMODEX_DEVICE_STATE_KEYCHAIN_MOCK_FILE);
}

function readKeychainStateString() {
  const keychainMirrorFile = resolveKeychainMirrorFile();
  if (keychainMirrorFile) {
    try {
      return fs.readFileSync(keychainMirrorFile, "utf8");
    } catch {
      return null;
    }
  }

  if (process.platform !== "darwin") {
    return null;
  }

  try {
    return execFileSync(
      "security",
      [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return null;
  }
}

function writeKeychainStateString(value) {
  const keychainMirrorFile = resolveKeychainMirrorFile();
  if (keychainMirrorFile) {
    try {
      fs.mkdirSync(path.dirname(keychainMirrorFile), { recursive: true });
      fs.writeFileSync(keychainMirrorFile, value, { mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform !== "darwin") {
    return false;
  }

  try {
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
        "-w",
        value,
      ],
      { stdio: ["ignore", "ignore", "ignore"] }
    );
    return true;
  } catch {
    return false;
  }
}

function deleteKeychainStateString() {
  const keychainMirrorFile = resolveKeychainMirrorFile();
  if (keychainMirrorFile) {
    const existed = fs.existsSync(keychainMirrorFile);
    try {
      fs.rmSync(keychainMirrorFile, { force: true });
      return existed;
    } catch {
      return false;
    }
  }

  if (process.platform !== "darwin") {
    return false;
  }

  try {
    execFileSync(
      "security",
      [
        "delete-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
      ],
      { stdio: ["ignore", "ignore", "ignore"] }
    );
    return true;
  } catch {
    return false;
  }
}

function deleteCanonicalFileState() {
  const storeFile = resolveStoreFile();
  const existed = fs.existsSync(storeFile);
  try {
    fs.rmSync(storeFile, { force: true });
    return existed;
  } catch {
    return false;
  }
}

// Prefers the canonical file, but repairs or warns about stale legacy Keychain mirrors.
function reconcileLegacyKeychainMirror(canonicalState, keychainRecord) {
  if (keychainRecord.error) {
    warnOnce("[domaeng] Ignoring unreadable legacy Keychain pairing mirror; using canonical device-state.json.");
    return;
  }

  if (!keychainRecord.state) {
    writeKeychainStateString(JSON.stringify(canonicalState, null, 2));
    return;
  }

  if (bridgeStatesEqual(canonicalState, keychainRecord.state)) {
    return;
  }

  warnOnce("[domaeng] Canonical bridge pairing state differs from the legacy Keychain mirror; using device-state.json.");
  writeKeychainStateString(JSON.stringify(canonicalState, null, 2));
}

function normalizeBridgeDeviceState(rawState) {
  const macDeviceId = normalizeNonEmptyString(rawState?.macDeviceId);
  const macIdentityPublicKey = normalizeNonEmptyString(rawState?.macIdentityPublicKey);
  const macIdentityPrivateKey = normalizeNonEmptyString(rawState?.macIdentityPrivateKey);
  const lastSeenPhoneAppVersion = normalizeNonEmptyString(rawState?.lastSeenPhoneAppVersion) || null;

  if (!macDeviceId || !macIdentityPublicKey || !macIdentityPrivateKey) {
    throw new Error("Bridge device state is incomplete");
  }

  const trustedPhones = normalizeTrustedPhonesMap(rawState?.trustedPhones);
  const trustedPhoneMetadata = normalizeTrustedPhoneMetadata(
    rawState?.trustedPhoneMetadata,
    trustedPhones
  );

  return {
    version: 1,
    macDeviceId,
    macIdentityPublicKey,
    macIdentityPrivateKey,
    trustedPhones,
    trustedPhoneMetadata,
    lastSeenPhoneAppVersion,
  };
}

function normalizeTrustedPhonesMap(rawTrustedPhones) {
  const trustedPhones = {};
  if (rawTrustedPhones && typeof rawTrustedPhones === "object" && !Array.isArray(rawTrustedPhones)) {
    for (const [deviceId, publicKey] of Object.entries(rawTrustedPhones)) {
      const normalizedDeviceId = normalizeNonEmptyString(deviceId);
      const normalizedPublicKey = normalizeNonEmptyString(publicKey);
      if (!normalizedDeviceId || !normalizedPublicKey) {
        continue;
      }
      trustedPhones[normalizedDeviceId] = normalizedPublicKey;
    }
  }
  return trustedPhones;
}

function normalizeTrustedPhoneMetadata(rawMetadata, trustedPhones) {
  const normalized = {};
  const source = rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
    ? rawMetadata
    : {};
  for (const deviceId of Object.keys(trustedPhones || {})) {
    const rawRecord = source[deviceId] && typeof source[deviceId] === "object" ? source[deviceId] : {};
    normalized[deviceId] = {
      displayName: normalizeDisplayName(rawRecord.displayName),
      deviceKind: normalizeDeviceKind(rawRecord.deviceKind) || inferTrustedDeviceKind(deviceId),
      trustedAt: normalizeDateString(rawRecord.trustedAt),
      lastSeenAt: normalizeDateString(rawRecord.lastSeenAt),
      disabledAt: normalizeDateString(rawRecord.disabledAt),
    };
  }
  return normalized;
}

function trustedDeviceSnapshot(state, deviceId, publicKey) {
  const normalizedState = normalizeBridgeDeviceState(state);
  const metadata = normalizedState.trustedPhoneMetadata?.[deviceId] || {};
  const fingerprint = fingerprintForPublicKey(publicKey);
  const displayName = normalizeDisplayName(metadata.displayName)
    || defaultTrustedDeviceDisplayName(metadata.deviceKind, fingerprint);
  const disabledAt = normalizeDateString(metadata.disabledAt);

  return {
    id: trustedDeviceRecordId(deviceId, publicKey),
    displayName,
    kind: normalizeDeviceKind(metadata.deviceKind) || inferTrustedDeviceKind(deviceId),
    fingerprint,
    trustedAt: normalizeDateString(metadata.trustedAt) || null,
    lastSeenAt: normalizeDateString(metadata.lastSeenAt) || null,
    disabledAt: disabledAt || null,
    status: disabledAt ? "disabled" : "enabled",
  };
}

function compareTrustedDeviceSnapshots(left, right) {
  const leftTime = Date.parse(left.lastSeenAt || left.trustedAt || "") || 0;
  const rightTime = Date.parse(right.lastSeenAt || right.trustedAt || "") || 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return left.displayName.localeCompare(right.displayName);
}

function findTrustedDeviceByRecordId(state, deviceRecordId) {
  const normalizedRecordId = normalizeNonEmptyString(deviceRecordId);
  if (!normalizedRecordId) {
    return null;
  }
  const normalizedState = normalizeBridgeDeviceState(state);
  for (const [deviceId, publicKey] of Object.entries(normalizedState.trustedPhones || {})) {
    if (trustedDeviceRecordId(deviceId, publicKey) === normalizedRecordId) {
      return { deviceId, publicKey };
    }
  }
  return null;
}

function trustedDeviceRecordId(deviceId, publicKey) {
  return `dev_${createHash("sha256")
    .update(`${deviceId}\0${publicKey}`)
    .digest("hex")
    .slice(0, 12)}`;
}

function fingerprintForPublicKey(publicKey) {
  const normalizedPublicKey = normalizeNonEmptyString(publicKey);
  const bytes = Buffer.from(normalizedPublicKey, "base64");
  const digestInput = bytes.length > 0 ? bytes : Buffer.from(normalizedPublicKey, "utf8");
  const digest = createHash("sha256").update(digestInput).digest("hex").slice(0, 8).toUpperCase();
  return digest.replace(/^(.{4})(.{4})$/, "$1 $2");
}

function defaultTrustedDeviceDisplayName(deviceKind, fingerprint) {
  switch (normalizeDeviceKind(deviceKind)) {
  case "web":
    return `Web Device ${fingerprint}`;
  case "ios":
    return `iPhone ${fingerprint}`;
  case "android":
    return `Android Device ${fingerprint}`;
  default:
    return `Device ${fingerprint}`;
  }
}

function inferTrustedDeviceKind(deviceId) {
  const normalizedDeviceId = normalizeNonEmptyString(deviceId).toLowerCase();
  if (normalizedDeviceId.startsWith("web-")) {
    return "web";
  }
  return "ios";
}

function isTrustedPhoneDisabled(state, deviceId) {
  return Boolean(normalizeDateString(state?.trustedPhoneMetadata?.[deviceId]?.disabledAt));
}

function bridgeStatesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeDisplayName(value) {
  const trimmed = normalizeNonEmptyString(value).replace(/\s+/g, " ");
  return trimmed.slice(0, 80);
}

function normalizeDeviceKind(value) {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  if (normalized === "ios" || normalized === "web" || normalized === "android") {
    return normalized;
  }
  return normalized ? "unknown" : "";
}

function normalizeDateString(value) {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function dateToISOString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function trustedDeviceNotFoundError(deviceRecordId) {
  const error = new Error(`Trusted device not found: ${normalizeNonEmptyString(deviceRecordId) || "unknown"}`);
  error.code = "trusted_device_not_found";
  return error;
}

function corruptedStateError(source, error) {
  const detail = normalizeNonEmptyString(error?.message);
  return new Error(
    `The saved Domaeng pairing state in ${source} is unreadable. `
      + "Run `domaeng reset-pairing` to start fresh."
      + (detail ? ` (${detail})` : "")
  );
}

function warnOnce(message) {
  if (hasLoggedKeychainMismatch) {
    return;
  }
  hasLoggedKeychainMismatch = true;
  console.warn(message);
}

function base64UrlToBase64(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  const padded = `${value}${"=".repeat((4 - (value.length % 4 || 4)) % 4)}`;
  return padded.replace(/-/g, "+").replace(/_/g, "/");
}

module.exports = {
  getEnabledTrustedPhones,
  getTrustedPhonePublicKey,
  loadOrCreateBridgeDeviceState,
  listTrustedDevices,
  readBridgeDeviceState,
  readTrustedDevicesSnapshot,
  rememberLastSeenPhoneAppVersion,
  rememberTrustedPhone,
  renameTrustedDevice,
  revokeTrustedDevice,
  resetBridgeDeviceState,
  resolveBridgeDeviceStateFile,
  resolveBridgeRelaySession,
  setTrustedDeviceEnabled,
};
