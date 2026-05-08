import { ed25519 } from "@noble/curves/ed25519";
import { x25519 } from "@noble/curves/ed25519";
import { gcm as nobleAesGcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  lengthPrefixedBytes,
  lengthPrefixedUTF8,
  randomBytes,
  randomUUID,
  utf8Bytes,
  utf8String
} from "./base64";
import type { JSONObject, PhoneIdentityState, RelaySessionState } from "../types";

export const SECURE_PROTOCOL_VERSION = 1;
export const PAIRING_QR_VERSION = 2;
export const HANDSHAKE_TAG = "remodex-e2ee-v1";
export const CLIENT_AUTH_LABEL = "client-auth";
export const TRUSTED_SESSION_RESOLVE_TAG = "remodex-trusted-session-resolve-v1";

export type SecureHandshakeMode = "qr_bootstrap" | "trusted_reconnect";

export interface SecureClientHello {
  kind: "clientHello";
  protocolVersion: number;
  sessionId: string;
  handshakeMode: SecureHandshakeMode;
  phoneDeviceId: string;
  phoneIdentityPublicKey: string;
  deviceDisplayName?: string;
  deviceKind?: string;
  phoneEphemeralPublicKey: string;
  clientNonce: string;
}

export interface SecureServerHello {
  kind: "serverHello";
  protocolVersion: number;
  sessionId: string;
  handshakeMode: SecureHandshakeMode;
  macDeviceId: string;
  macIdentityPublicKey: string;
  macEphemeralPublicKey: string;
  serverNonce: string;
  keyEpoch: number;
  expiresAtForTranscript: number;
  macSignature: string;
  clientNonce?: string;
}

export interface SecureClientAuth {
  kind: "clientAuth";
  sessionId: string;
  phoneDeviceId: string;
  keyEpoch: number;
  phoneSignature: string;
}

export interface SecureReadyMessage {
  kind: "secureReady";
  sessionId: string;
  keyEpoch: number;
  macDeviceId: string;
}

export interface SecureResumeState {
  kind: "resumeState";
  sessionId: string;
  keyEpoch: number;
  lastAppliedBridgeOutboundSeq: number;
}

export interface SecureEnvelope {
  kind: "encryptedEnvelope";
  v: number;
  sessionId: string;
  keyEpoch: number;
  sender: "mac" | "iphone";
  counter: number;
  ciphertext: string;
  tag: string;
}

interface SecureApplicationPayload {
  bridgeOutboundSeq: number | null;
  payloadText: string;
}

export interface PendingHandshake {
  mode: SecureHandshakeMode;
  phoneEphemeralPrivateKey: Uint8Array;
  clientNonce: Uint8Array;
  clientHello: SecureClientHello;
}

export class SecureSession {
  readonly sessionId: string;
  readonly keyEpoch: number;
  readonly macDeviceId: string;
  readonly macIdentityPublicKey: string;
  readonly phoneToMacKey: Uint8Array;
  readonly macToPhoneKey: Uint8Array;
  lastInboundBridgeOutboundSeq: number;
  lastInboundCounter = -1;
  nextOutboundCounter = 0;

  constructor({
    sessionId,
    keyEpoch,
    macDeviceId,
    macIdentityPublicKey,
    phoneToMacKey,
    macToPhoneKey,
    lastInboundBridgeOutboundSeq
  }: {
    sessionId: string;
    keyEpoch: number;
    macDeviceId: string;
    macIdentityPublicKey: string;
    phoneToMacKey: Uint8Array;
    macToPhoneKey: Uint8Array;
    lastInboundBridgeOutboundSeq: number;
  }) {
    this.sessionId = sessionId;
    this.keyEpoch = keyEpoch;
    this.macDeviceId = macDeviceId;
    this.macIdentityPublicKey = macIdentityPublicKey;
    this.phoneToMacKey = phoneToMacKey;
    this.macToPhoneKey = macToPhoneKey;
    this.lastInboundBridgeOutboundSeq = lastInboundBridgeOutboundSeq;
  }

  async encryptApplicationMessage(plaintext: string): Promise<string> {
    const counter = this.nextOutboundCounter;
    this.nextOutboundCounter += 1;
    const payload: SecureApplicationPayload = {
      bridgeOutboundSeq: null,
      payloadText: plaintext
    };
    const payloadBytes = utf8Bytes(JSON.stringify(payload));
    const encrypted = await aesGcmEncrypt(
      this.phoneToMacKey,
      nonceForDirection("iphone", counter),
      payloadBytes
    );
    const envelope: SecureEnvelope = {
      kind: "encryptedEnvelope",
      v: SECURE_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      keyEpoch: this.keyEpoch,
      sender: "iphone",
      counter,
      ciphertext: bytesToBase64(encrypted.ciphertext),
      tag: bytesToBase64(encrypted.tag)
    };
    return JSON.stringify(envelope);
  }

  async decryptEnvelope(envelope: SecureEnvelope): Promise<string | null> {
    if (
      envelope.sessionId !== this.sessionId ||
      envelope.keyEpoch !== this.keyEpoch ||
      envelope.sender !== "mac" ||
      envelope.counter <= this.lastInboundCounter
    ) {
      return null;
    }

    const plaintext = await aesGcmDecrypt(
      this.macToPhoneKey,
      nonceForDirection("mac", envelope.counter),
      base64ToBytes(envelope.ciphertext),
      base64ToBytes(envelope.tag)
    );
    if (envelope.counter <= this.lastInboundCounter) {
      return "";
    }
    const payload = JSON.parse(utf8String(plaintext)) as SecureApplicationPayload;
    this.lastInboundCounter = envelope.counter;
    if (typeof payload.bridgeOutboundSeq === "number") {
      if (payload.bridgeOutboundSeq <= this.lastInboundBridgeOutboundSeq) {
        return "";
      }
      this.lastInboundBridgeOutboundSeq = payload.bridgeOutboundSeq;
    }
    return payload.payloadText;
  }
}

export function createPhoneIdentity(): PhoneIdentityState {
  const privateKey = randomBytes(32);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    phoneDeviceId: `web-${randomUUID()}`,
    phoneIdentityPrivateKey: bytesToBase64(privateKey),
    phoneIdentityPublicKey: bytesToBase64(publicKey),
    deviceDisplayName: browserDeviceDisplayName(),
    deviceKind: "web"
  };
}

export function createClientHello({
  relayState,
  phoneIdentity,
  mode
}: {
  relayState: RelaySessionState;
  phoneIdentity: PhoneIdentityState;
  mode: SecureHandshakeMode;
}): PendingHandshake {
  const phoneEphemeralPrivateKey = randomBytes(32);
  const clientNonce = randomBytes(32);
  const clientHello: SecureClientHello = {
    kind: "clientHello",
    protocolVersion: SECURE_PROTOCOL_VERSION,
    sessionId: relayState.sessionId,
    handshakeMode: mode,
    phoneDeviceId: phoneIdentity.phoneDeviceId,
    phoneIdentityPublicKey: phoneIdentity.phoneIdentityPublicKey,
    deviceDisplayName: phoneIdentity.deviceDisplayName || browserDeviceDisplayName(),
    deviceKind: phoneIdentity.deviceKind || "web",
    phoneEphemeralPublicKey: bytesToBase64(x25519.getPublicKey(phoneEphemeralPrivateKey)),
    clientNonce: bytesToBase64(clientNonce)
  };
  return {
    mode,
    phoneEphemeralPrivateKey,
    clientNonce,
    clientHello
  };
}

export async function finalizeSecureHandshake({
  pending,
  serverHello,
  relayState,
  phoneIdentity
}: {
  pending: PendingHandshake;
  serverHello: SecureServerHello;
  relayState: RelaySessionState;
  phoneIdentity: PhoneIdentityState;
}): Promise<{ clientAuth: SecureClientAuth; session: SecureSession }> {
  if (serverHello.protocolVersion !== SECURE_PROTOCOL_VERSION) {
    throw new Error("Secure protocol version mismatch");
  }
  if (serverHello.sessionId !== relayState.sessionId) {
    throw new Error("Secure session id mismatch");
  }
  if (serverHello.macDeviceId !== relayState.macDeviceId) {
    throw new Error("Secure Mac device mismatch");
  }
  if (serverHello.macIdentityPublicKey !== relayState.macIdentityPublicKey) {
    throw new Error("Secure Mac identity mismatch");
  }
  if (serverHello.clientNonce && serverHello.clientNonce !== pending.clientHello.clientNonce) {
    throw new Error("Secure client nonce mismatch");
  }

  const transcriptBytes = buildSecureTranscriptBytes({
    sessionId: serverHello.sessionId,
    protocolVersion: serverHello.protocolVersion,
    handshakeMode: serverHello.handshakeMode,
    keyEpoch: serverHello.keyEpoch,
    macDeviceId: serverHello.macDeviceId,
    phoneDeviceId: phoneIdentity.phoneDeviceId,
    macIdentityPublicKey: serverHello.macIdentityPublicKey,
    phoneIdentityPublicKey: phoneIdentity.phoneIdentityPublicKey,
    macEphemeralPublicKey: serverHello.macEphemeralPublicKey,
    phoneEphemeralPublicKey: pending.clientHello.phoneEphemeralPublicKey,
    clientNonce: pending.clientNonce,
    serverNonce: base64ToBytes(serverHello.serverNonce),
    expiresAtForTranscript: serverHello.expiresAtForTranscript
  });

  const macSignatureValid = await ed25519.verify(
    base64ToBytes(serverHello.macSignature),
    transcriptBytes,
    base64ToBytes(serverHello.macIdentityPublicKey)
  );
  if (!macSignatureValid) {
    throw new Error("Secure Mac signature verification failed");
  }

  const phoneSignature = await ed25519.sign(
    concatBytes([transcriptBytes, lengthPrefixedUTF8(CLIENT_AUTH_LABEL)]),
    base64ToBytes(phoneIdentity.phoneIdentityPrivateKey)
  );
  const sharedSecret = x25519.getSharedSecret(
    pending.phoneEphemeralPrivateKey,
    base64ToBytes(serverHello.macEphemeralPublicKey)
  );
  const salt = sha256(transcriptBytes);
  const infoPrefix = [
    HANDSHAKE_TAG,
    serverHello.sessionId,
    serverHello.macDeviceId,
    phoneIdentity.phoneDeviceId,
    String(serverHello.keyEpoch)
  ].join("|");
  const phoneToMacKey = hkdf(sha256, sharedSecret, salt, utf8Bytes(`${infoPrefix}|phoneToMac`), 32);
  const macToPhoneKey = hkdf(sha256, sharedSecret, salt, utf8Bytes(`${infoPrefix}|macToPhone`), 32);

  return {
    clientAuth: {
      kind: "clientAuth",
      sessionId: serverHello.sessionId,
      phoneDeviceId: phoneIdentity.phoneDeviceId,
      keyEpoch: serverHello.keyEpoch,
      phoneSignature: bytesToBase64(phoneSignature)
    },
    session: new SecureSession({
      sessionId: serverHello.sessionId,
      keyEpoch: serverHello.keyEpoch,
      macDeviceId: serverHello.macDeviceId,
      macIdentityPublicKey: serverHello.macIdentityPublicKey,
      phoneToMacKey,
      macToPhoneKey,
      lastInboundBridgeOutboundSeq: relayState.lastAppliedBridgeOutboundSeq
    })
  };
}

export function buildResumeState(session: SecureSession): SecureResumeState {
  return {
    kind: "resumeState",
    sessionId: session.sessionId,
    keyEpoch: session.keyEpoch,
    lastAppliedBridgeOutboundSeq: session.lastInboundBridgeOutboundSeq
  };
}

export function buildSecureTranscriptBytes({
  sessionId,
  protocolVersion,
  handshakeMode,
  keyEpoch,
  macDeviceId,
  phoneDeviceId,
  macIdentityPublicKey,
  phoneIdentityPublicKey,
  macEphemeralPublicKey,
  phoneEphemeralPublicKey,
  clientNonce,
  serverNonce,
  expiresAtForTranscript
}: {
  sessionId: string;
  protocolVersion: number;
  handshakeMode: SecureHandshakeMode;
  keyEpoch: number;
  macDeviceId: string;
  phoneDeviceId: string;
  macIdentityPublicKey: string;
  phoneIdentityPublicKey: string;
  macEphemeralPublicKey: string;
  phoneEphemeralPublicKey: string;
  clientNonce: Uint8Array;
  serverNonce: Uint8Array;
  expiresAtForTranscript: number;
}): Uint8Array {
  return concatBytes([
    lengthPrefixedUTF8(HANDSHAKE_TAG),
    lengthPrefixedUTF8(sessionId),
    lengthPrefixedUTF8(String(protocolVersion)),
    lengthPrefixedUTF8(handshakeMode),
    lengthPrefixedUTF8(String(keyEpoch)),
    lengthPrefixedUTF8(macDeviceId),
    lengthPrefixedUTF8(phoneDeviceId),
    lengthPrefixedBytes(base64ToBytes(macIdentityPublicKey)),
    lengthPrefixedBytes(base64ToBytes(phoneIdentityPublicKey)),
    lengthPrefixedBytes(base64ToBytes(macEphemeralPublicKey)),
    lengthPrefixedBytes(base64ToBytes(phoneEphemeralPublicKey)),
    lengthPrefixedBytes(clientNonce),
    lengthPrefixedBytes(serverNonce),
    lengthPrefixedUTF8(String(expiresAtForTranscript))
  ]);
}

export function buildTrustedSessionResolveTranscriptBytes({
  macDeviceId,
  phoneDeviceId,
  phoneIdentityPublicKey,
  nonce,
  timestamp
}: {
  macDeviceId: string;
  phoneDeviceId: string;
  phoneIdentityPublicKey: string;
  nonce: string;
  timestamp: number;
}): Uint8Array {
  return concatBytes([
    lengthPrefixedUTF8(TRUSTED_SESSION_RESOLVE_TAG),
    lengthPrefixedUTF8(macDeviceId),
    lengthPrefixedUTF8(phoneDeviceId),
    lengthPrefixedBytes(base64ToBytes(phoneIdentityPublicKey)),
    lengthPrefixedUTF8(nonce),
    lengthPrefixedUTF8(String(timestamp))
  ]);
}

export async function signTrustedSessionResolve({
  macDeviceId,
  phoneIdentity,
  nonce,
  timestamp
}: {
  macDeviceId: string;
  phoneIdentity: PhoneIdentityState;
  nonce: string;
  timestamp: number;
}): Promise<JSONObject> {
  const transcript = buildTrustedSessionResolveTranscriptBytes({
    macDeviceId,
    phoneDeviceId: phoneIdentity.phoneDeviceId,
    phoneIdentityPublicKey: phoneIdentity.phoneIdentityPublicKey,
    nonce,
    timestamp
  });
  const signature = await ed25519.sign(transcript, base64ToBytes(phoneIdentity.phoneIdentityPrivateKey));
  return {
    macDeviceId,
    phoneDeviceId: phoneIdentity.phoneDeviceId,
    phoneIdentityPublicKey: phoneIdentity.phoneIdentityPublicKey,
    nonce,
    timestamp,
    signature: bytesToBase64(signature)
  };
}

export function browserDeviceDisplayName(): string {
  const nav = globalThis.navigator as
    | (Navigator & { standalone?: boolean; userAgentData?: { platform?: string } })
    | undefined;
  const browser = browserName(nav?.userAgent || "");
  const platform = nav?.userAgentData?.platform || nav?.platform || "";
  const base = [browser, platform].filter(Boolean).join(" on ") || "Web Browser";
  if (!isStandaloneWebApp(nav)) {
    return base;
  }
  if (browser === "Safari") {
    return ["Home Screen", platform].filter(Boolean).join(" on ") || "Home Screen Web App";
  }
  return `${base} (Home Screen)`;
}

function browserName(userAgent: string): string {
  if (userAgent.includes("Edg/")) {
    return "Edge";
  }
  if (userAgent.includes("Chrome/") || userAgent.includes("CriOS/")) {
    return "Chrome";
  }
  if (userAgent.includes("Firefox/") || userAgent.includes("FxiOS/")) {
    return "Firefox";
  }
  if (userAgent.includes("Safari/")) {
    return "Safari";
  }
  return "Web Browser";
}

function isStandaloneWebApp(nav?: Navigator & { standalone?: boolean }): boolean {
  const displayModeStandalone =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(display-mode: standalone)").matches;
  return displayModeStandalone || nav?.standalone === true;
}

export function nonceForDirection(sender: "mac" | "iphone", counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce[0] = sender === "mac" ? 1 : 2;
  let value = BigInt(counter);
  for (let index = 11; index >= 1; index -= 1) {
    nonce[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return nonce;
}

export function wireMessageKind(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText) as { kind?: string };
    return typeof parsed.kind === "string" ? parsed.kind : "";
  } catch {
    return "";
  }
}

async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array
): Promise<{ ciphertext: Uint8Array; tag: Uint8Array }> {
  const subtle = globalThis.crypto?.subtle;
  const sealed = subtle
    ? new Uint8Array(await subtle.encrypt(
      { name: "AES-GCM", iv: copyBytes(nonce), tagLength: 128 },
      await subtle.importKey("raw", copyBytes(keyBytes), "AES-GCM", false, ["encrypt"]),
      copyBytes(plaintext)
    ))
    : nobleAesGcm(copyBytes(keyBytes), copyBytes(nonce)).encrypt(copyBytes(plaintext));
  return {
    ciphertext: sealed.slice(0, sealed.length - 16),
    tag: sealed.slice(sealed.length - 16)
  };
}

async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array
): Promise<Uint8Array> {
  const sealed = copyBytes(concatBytes([ciphertext, tag]));
  const subtle = globalThis.crypto?.subtle;
  return subtle
    ? new Uint8Array(await subtle.decrypt(
      { name: "AES-GCM", iv: copyBytes(nonce), tagLength: 128 },
      await subtle.importKey("raw", copyBytes(keyBytes), "AES-GCM", false, ["decrypt"]),
      sealed
    ))
    : nobleAesGcm(copyBytes(keyBytes), copyBytes(nonce)).decrypt(sealed);
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;
}
