import type { PairingQRPayload, RelaySessionState } from "../types";
import { PAIRING_QR_VERSION } from "./secureTransport";

export type RelayEntryMode = "tailscale" | "local";

export interface RelayEntryOption {
  mode: RelayEntryMode;
  label: string;
  relayURL: string;
}

export function parsePairingPayload(rawValue: string): PairingQRPayload {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error("Pairing payload is empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const url = new URL(trimmed);
    const payload = url.searchParams.get("payload") || url.hash.replace(/^#/, "");
    parsed = JSON.parse(decodeURIComponent(payload));
  }

  const payload = parsed as Partial<PairingQRPayload>;
  if (
    payload.v !== PAIRING_QR_VERSION ||
    typeof payload.relay !== "string" ||
    typeof payload.sessionId !== "string" ||
    typeof payload.macDeviceId !== "string" ||
    typeof payload.macIdentityPublicKey !== "string" ||
    typeof payload.expiresAt !== "number"
  ) {
    throw new Error("Invalid Remodex pairing payload");
  }

  return {
    v: payload.v,
    relay: payload.relay.trim(),
    sessionId: payload.sessionId.trim(),
    macDeviceId: payload.macDeviceId.trim(),
    macIdentityPublicKey: payload.macIdentityPublicKey.trim(),
    expiresAt: payload.expiresAt
  };
}

export function relayStateFromPairingPayload(payload: PairingQRPayload): RelaySessionState {
  return {
    relayURL: payload.relay,
    sessionId: payload.sessionId,
    macDeviceId: payload.macDeviceId,
    macIdentityPublicKey: payload.macIdentityPublicKey,
    lastAppliedBridgeOutboundSeq: 0,
    forceQRBootstrap: true
  };
}

export function relayWebSocketURL(relayURL: string, sessionId: string): string {
  const base = new URL(relayURL);
  const path = base.pathname.replace(/\/+$/, "");
  base.pathname = `${path}/${encodeURIComponent(sessionId)}`;
  base.searchParams.set("role", "iphone");
  if (base.protocol === "http:") {
    base.protocol = "ws:";
  } else if (base.protocol === "https:") {
    base.protocol = "wss:";
  }
  return base.toString();
}

export function trustedResolveURL(relayURL: string): string {
  const url = new URL(relayURL);
  url.protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.at(-1) === "relay") {
    parts.pop();
  }
  url.pathname = `/${[...parts, "v1", "trusted", "session", "resolve"].join("/")}`;
  url.search = "";
  return url.toString();
}

export function pairingCodeResolveURL(relayURL: string): string {
  const url = new URL(relayURL);
  url.protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.at(-1) === "relay") {
    parts.pop();
  }
  url.pathname = `/${[...parts, "v1", "pairing", "code", "resolve"].join("/")}`;
  url.search = "";
  return url.toString();
}

export function relayURLFromWebAppLocation(href: string): string {
  const url = new URL(href);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "";
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const appIndex = parts.indexOf("app");
  const prefixParts = appIndex >= 0 ? parts.slice(0, appIndex) : [];
  const tailscaleHost = isTailscaleHost(url.hostname);
  url.protocol = url.protocol === "https:" || tailscaleHost ? "wss:" : "ws:";
  if (tailscaleHost && url.protocol === "wss:") {
    url.port = "";
  }
  url.pathname = `/${[...prefixParts, "relay"].join("/")}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function relayEntryOptionsFromWebAppLocation(href: string): RelayEntryOption[] {
  const url = new URL(href);
  const derivedRelayURL = relayURLFromWebAppLocation(href);
  const tailscaleHost = isTailscaleHost(url.hostname);
  const queryTailscaleRelay = normalizeRelayURLQueryValue(url.searchParams.get("tailscaleRelay"));
  const queryLocalRelay = normalizeRelayURLQueryValue(url.searchParams.get("localRelay"));

  return [
    {
      mode: "tailscale",
      label: "Tailscale",
      relayURL: queryTailscaleRelay || (tailscaleHost ? derivedRelayURL : "")
    },
    {
      mode: "local",
      label: "Local LAN",
      relayURL: queryLocalRelay || (!tailscaleHost ? derivedRelayURL : "")
    }
  ];
}

export function defaultRelayEntryModeFromWebAppLocation(href: string): RelayEntryMode {
  const url = new URL(href);
  const entry = url.searchParams.get("entry")?.trim().toLowerCase();
  if (entry === "tailscale" || entry === "local") {
    return entry;
  }

  return isTailscaleHost(url.hostname) ? "tailscale" : "local";
}

export function canonicalTailscaleWebAppURL(href: string): string | null {
  const url = new URL(href);
  if (!isTailscaleHost(url.hostname)) {
    return null;
  }

  if (url.protocol === "https:" && !url.port) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const appIndex = parts.indexOf("app");
  const prefixParts = appIndex >= 0 ? parts.slice(0, appIndex) : [];
  url.protocol = "https:";
  url.port = "";
  url.pathname = `/${[...prefixParts, "app"].join("/")}/`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function normalizeRelayURLInput(rawValue: string): string {
  const cleaned = rawValue.trim().replace(/[，,。.;；]+$/u, "");
  const url = new URL(cleaned);
  const tailscaleHost = isTailscaleHost(url.hostname);

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  if (tailscaleHost && url.protocol === "wss:") {
    url.port = "";
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.at(-1) === "app") {
    parts.pop();
    parts.push("relay");
  } else if (parts.at(-1) !== "relay") {
    parts.push("relay");
  }

  url.pathname = `/${parts.join("/")}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isTailscaleHost(hostname: string): boolean {
  return hostname.toLowerCase().endsWith(".ts.net");
}

function normalizeRelayURLQueryValue(value: string | null): string {
  if (!value?.trim()) {
    return "";
  }

  try {
    return normalizeRelayURLInput(value);
  } catch {
    return "";
  }
}
