import { describe, expect, it, vi } from "vitest";
import { JSONRPCDispatcher, RPCError } from "./jsonRpc";

describe("JSONRPCDispatcher", () => {
  it("matches responses to pending requests", async () => {
    let sent = "";
    const dispatcher = new JSONRPCDispatcher(async (text) => {
      sent = text;
    });
    const pending = dispatcher.request("thread/list", { limit: 1 });
    const id = JSON.parse(sent).id;
    expect(dispatcher.pendingCount()).toBe(1);
    dispatcher.handleMessage({ id, result: { data: [] } });
    await expect(pending).resolves.toMatchObject({ result: { data: [] } });
    expect(dispatcher.pendingCount()).toBe(0);
  });

  it("rejects error responses", async () => {
    let sent = "";
    const dispatcher = new JSONRPCDispatcher(async (text) => {
      sent = text;
    });
    const pending = dispatcher.request("git/status");
    const id = JSON.parse(sent).id;
    dispatcher.handleMessage({ id, error: { code: -32000, message: "failed" } });
    await expect(pending).rejects.toBeInstanceOf(RPCError);
  });

  it("clears pending requests on disconnect", async () => {
    vi.useFakeTimers();
    const dispatcher = new JSONRPCDispatcher(async () => {});
    const pending = dispatcher.request("turn/start");
    dispatcher.failAll(new Error("closed"));
    await expect(pending).rejects.toThrow("closed");
    expect(dispatcher.pendingCount()).toBe(0);
    vi.useRealTimers();
  });
});
