// FILE: local-relay-url.js
// Purpose: Resolves the LAN-advertised local relay URL used by the bridge and CLI.
// Layer: CLI helper
// Exports: local relay URL defaults and LAN host detection helpers.
// Depends on: os

const os = require("os");

const DEFAULT_LOCAL_RELAY_PORT = 9000;
const DEFAULT_LOCAL_RELAY_PATH = "/relay";
const DEFAULT_LOOPBACK_RELAY_HOST = "127.0.0.1";

function resolveDefaultLocalRelayUrl({
  env = process.env,
  osImpl = os,
} = {}) {
  const host = resolveAdvertisedLocalRelayHost({ env, osImpl });
  const port = parseInteger(env.DOMAENG_LOCAL_RELAY_PORT || env.RELAY_PORT || env.PORT, DEFAULT_LOCAL_RELAY_PORT);
  return `ws://${formatHostForUrl(host)}:${port}${DEFAULT_LOCAL_RELAY_PATH}`;
}

function resolveAdvertisedLocalRelayHost({
  env = process.env,
  osImpl = os,
} = {}) {
  const explicitHost = firstNonEmptyString([
    env.DOMAENG_LOCAL_RELAY_ADVERTISE_HOST,
    env.REMODEX_LOCAL_RELAY_ADVERTISE_HOST,
  ]);
  if (explicitHost) {
    return normalizeHostOverride(explicitHost);
  }

  const hosts = localIPv4Hosts(osImpl);
  return hosts.find(isPrivateIPv4Host)
    || hosts.find(isSharedIPv4Host)
    || hosts[0]
    || DEFAULT_LOOPBACK_RELAY_HOST;
}

function isLocalRelayHost(hostname) {
  const host = normalizeHost(hostname);
  return host === "localhost"
    || host === "127.0.0.1"
    || host === "::1"
    || host.endsWith(".local")
    || host.endsWith(".ts.net")
    || isPrivateIPv4Host(host)
    || isSharedIPv4Host(host);
}

function localIPv4Hosts(osImpl = os) {
  const interfaces = typeof osImpl.networkInterfaces === "function"
    ? osImpl.networkInterfaces()
    : {};
  const hosts = [];
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) {
        continue;
      }
      if (entry.family !== "IPv4" && entry.family !== 4) {
        continue;
      }
      const address = normalizeHost(entry.address);
      if (isIPv4Host(address)) {
        hosts.push(address);
      }
    }
  }
  return Array.from(new Set(hosts));
}

function isPrivateIPv4Host(hostname) {
  const parts = ipv4Parts(hostname);
  if (!parts) {
    return false;
  }
  const [a, b] = parts;
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function isSharedIPv4Host(hostname) {
  const parts = ipv4Parts(hostname);
  if (!parts) {
    return false;
  }
  const [a, b] = parts;
  return a === 100 && b >= 64 && b <= 127;
}

function normalizeHostOverride(value) {
  const raw = String(value || "").trim();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      return normalizeHost(new URL(raw).hostname);
    }
  } catch {
    return raw;
  }
  return normalizeHost(raw.replace(/^\[|\]$/g, ""));
}

function formatHostForUrl(hostname) {
  const host = normalizeHost(hostname) || DEFAULT_LOOPBACK_RELAY_HOST;
  return host.includes(":") ? `[${host}]` : host;
}

function normalizeHost(value) {
  return String(value || "").trim().toLowerCase();
}

function isIPv4Host(hostname) {
  return Boolean(ipv4Parts(hostname));
}

function ipv4Parts(hostname) {
  const parts = normalizeHost(hostname).split(".");
  if (parts.length !== 4) {
    return null;
  }
  const numbers = parts.map((part) => Number.parseInt(part, 10));
  if (numbers.some((part, index) => String(part) !== parts[index] || part < 0 || part > 255)) {
    return null;
  }
  return numbers;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

module.exports = {
  DEFAULT_LOCAL_RELAY_PORT,
  DEFAULT_LOOPBACK_RELAY_HOST,
  isLocalRelayHost,
  resolveAdvertisedLocalRelayHost,
  resolveDefaultLocalRelayUrl,
};
