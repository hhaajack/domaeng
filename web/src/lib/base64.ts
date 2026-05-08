export function bytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (globalThis as unknown as { Buffer?: any }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim();
  const bufferCtor = (globalThis as unknown as { Buffer?: any }).Buffer;
  if (bufferCtor) {
    return new Uint8Array(bufferCtor.from(normalized, "base64"));
  }
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function base64UrlToBase64(value: string): string {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const remainder = normalized.length % 4;
  return remainder === 0 ? normalized : normalized + "=".repeat(4 - remainder);
}

export function base64ToBase64Url(value: string): string {
  return String(value || "").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function utf8String(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function lengthPrefixedBytes(bytes: Uint8Array): Uint8Array {
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, bytes.length, false);
  return concatBytes([prefix, bytes]);
}

export function lengthPrefixedUTF8(value: string): Uint8Array {
  return lengthPrefixedBytes(utf8Bytes(String(value)));
}

export function randomBytes(length: number): Uint8Array {
  const cryptoSource = globalThis.crypto;
  if (!cryptoSource?.getRandomValues) {
    throw new Error("Secure random source is not available. Reopen Domaeng over HTTPS or localhost.");
  }

  const bytes = new Uint8Array(length);
  cryptoSource.getRandomValues(bytes);
  return bytes;
}

export function randomUUID(): string {
  const cryptoSource = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoSource?.randomUUID === "function") {
    return cryptoSource.randomUUID();
  }

  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

export function idKey(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}
