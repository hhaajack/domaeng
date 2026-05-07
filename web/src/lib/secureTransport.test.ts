import { describe, expect, it } from "vitest";
import { bytesToBase64, randomBytes } from "./base64";
import {
  buildSecureTranscriptBytes,
  buildTrustedSessionResolveTranscriptBytes,
  nonceForDirection,
  SecureSession
} from "./secureTransport";

describe("secure transport helpers", () => {
  it("matches bridge nonce direction encoding", () => {
    expect(Array.from(nonceForDirection("mac", 1))).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(nonceForDirection("iphone", 1))).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("builds stable length-prefixed secure transcript bytes", () => {
    const transcript = buildSecureTranscriptBytes({
      sessionId: "session",
      protocolVersion: 1,
      handshakeMode: "qr_bootstrap",
      keyEpoch: 7,
      macDeviceId: "mac",
      phoneDeviceId: "phone",
      macIdentityPublicKey: bytesToBase64(new Uint8Array(32).fill(1)),
      phoneIdentityPublicKey: bytesToBase64(new Uint8Array(32).fill(2)),
      macEphemeralPublicKey: bytesToBase64(new Uint8Array(32).fill(3)),
      phoneEphemeralPublicKey: bytesToBase64(new Uint8Array(32).fill(4)),
      clientNonce: new Uint8Array(32).fill(5),
      serverNonce: new Uint8Array(32).fill(6),
      expiresAtForTranscript: 1234
    });

    expect(transcript.length).toBeGreaterThan(180);
    expect(readFirstLengthPrefixedString(transcript)).toBe("remodex-e2ee-v1");
  });

  it("builds trusted resolve transcript bytes", () => {
    const transcript = buildTrustedSessionResolveTranscriptBytes({
      macDeviceId: "mac",
      phoneDeviceId: "phone",
      phoneIdentityPublicKey: bytesToBase64(new Uint8Array(32).fill(9)),
      nonce: "nonce",
      timestamp: 123
    });
    expect(transcript.length).toBeGreaterThan(70);
    expect(readFirstLengthPrefixedString(transcript)).toBe("remodex-trusted-session-resolve-v1");
  });

  it("encrypts outbound application envelopes", async () => {
    const keyA = randomBytes(32);
    const sender = new SecureSession({
      sessionId: "session",
      keyEpoch: 1,
      macDeviceId: "mac",
      macIdentityPublicKey: "mac-key",
      phoneToMacKey: keyA,
      macToPhoneKey: randomBytes(32),
      lastInboundBridgeOutboundSeq: 0
    });
    const envelope = JSON.parse(await sender.encryptApplicationMessage("{\"ok\":true}"));
    expect(envelope).toMatchObject({
      kind: "encryptedEnvelope",
      v: 1,
      sessionId: "session",
      keyEpoch: 1,
      sender: "iphone",
      counter: 0
    });
    expect(typeof envelope.ciphertext).toBe("string");
    expect(typeof envelope.tag).toBe("string");
  });

  it("falls back to JS AES-GCM when WebCrypto subtle is unavailable", async () => {
    const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const keyA = randomBytes(32);
    const sender = new SecureSession({
      sessionId: "session",
      keyEpoch: 1,
      macDeviceId: "mac",
      macIdentityPublicKey: "mac-key",
      phoneToMacKey: keyA,
      macToPhoneKey: randomBytes(32),
      lastInboundBridgeOutboundSeq: 0
    });

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {}
    });
    try {
      const envelope = JSON.parse(await sender.encryptApplicationMessage("{\"ok\":true}"));
      expect(envelope).toMatchObject({
        kind: "encryptedEnvelope",
        sender: "iphone",
        counter: 0
      });
      expect(typeof envelope.ciphertext).toBe("string");
      expect(typeof envelope.tag).toBe("string");
    } finally {
      if (originalCryptoDescriptor) {
        Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
      }
    }
  });
});

function readFirstLengthPrefixedString(bytes: Uint8Array): string {
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  return new TextDecoder().decode(bytes.slice(4, 4 + length));
}
