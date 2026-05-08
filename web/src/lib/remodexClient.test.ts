import { describe, expect, it } from "vitest";
import { RPCError } from "./jsonRpc";
import { isThreadNotFoundError, RemodexClient } from "./remodexClient";

type UnsafeRemodexClient = {
  waitForControl(kind: string, timeoutMs?: number): Promise<string>;
  bufferControl(kind: string, rawText: string): void;
};

describe("isThreadNotFoundError", () => {
  it("detects app-server thread not found failures", () => {
    expect(isThreadNotFoundError(new RPCError({
      code: -32000,
      message: "thread not found: thread-1"
    }))).toBe(true);
  });

  it("ignores unrelated RPC failures", () => {
    expect(isThreadNotFoundError(new RPCError({
      code: -32000,
      message: "model unavailable"
    }))).toBe(false);
  });
});

describe("RemodexClient secure control waits", () => {
  it("rejects a pending handshake wait when the bridge sends a secure error", async () => {
    const client = new RemodexClient() as unknown as UnsafeRemodexClient;
    const pending = client.waitForControl("serverHello", 1_000);

    client.bufferControl("secureError", JSON.stringify({
      kind: "secureError",
      code: "pairing_expired",
      message: "The pairing QR code has expired."
    }));

    await expect(pending).rejects.toThrow("pairing QR code has expired");
  });

  it("times out instead of waiting forever for a missing control message", async () => {
    const client = new RemodexClient() as unknown as UnsafeRemodexClient;

    await expect(client.waitForControl("serverHello", 5)).rejects.toThrow(
      "Secure handshake timed out waiting for serverHello."
    );
  });
});
