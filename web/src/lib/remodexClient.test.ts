import { describe, expect, it } from "vitest";
import { RPCError } from "./jsonRpc";
import { isThreadNotFoundError } from "./remodexClient";

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
