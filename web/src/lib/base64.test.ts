import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "./base64";

describe("random helpers", () => {
  it("builds an RFC4122 UUID when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.set([
          0x00, 0x11, 0x22, 0x33,
          0x44, 0x55,
          0x66, 0x77,
          0x88, 0x99,
          0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff
        ]);
        return bytes;
      }
    });

    expect(randomUUID()).toBe("00112233-4455-4677-8899-aabbccddeeff");
    vi.unstubAllGlobals();
  });
});
