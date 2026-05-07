import { afterEach, describe, expect, it, vi } from "vitest";

describe("storage fallback", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock("idb");
    localStorage.clear();
  });

  it("uses localStorage when IndexedDB cannot be opened", async () => {
    vi.doMock("idb", () => ({
      openDB: vi.fn().mockRejectedValue(new Error("Connection to Indexed Database server lost."))
    }));

    const { readKV, writeKV } = await import("./storage");
    const value = { relayURL: "ws://mac.local:9000/relay", sessionId: "session-1" };

    await expect(writeKV("relayState", value)).resolves.toBeUndefined();

    await expect(readKV("relayState")).resolves.toEqual(value);
  });

  it("keeps a local mirror when IndexedDB writes fail after opening", async () => {
    vi.doMock("idb", () => ({
      openDB: vi.fn().mockResolvedValue({
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockRejectedValue(new Error("Connection to Indexed Database server lost."))
      })
    }));

    const { readKV, writeKV } = await import("./storage");
    const value = { accessMode: "onRequest", planMode: true };

    await expect(writeKV("runtimeSettings", value)).resolves.toBeUndefined();

    await expect(readKV("runtimeSettings")).resolves.toEqual(value);
  });
});
