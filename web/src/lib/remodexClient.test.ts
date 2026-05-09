import { describe, expect, it } from "vitest";
import type { JSONObject, JSONValue, RPCMessage, RuntimeSettings } from "../types";
import { RPCError } from "./jsonRpc";
import { isThreadNotFoundError, RemodexClient } from "./remodexClient";

type UnsafeRemodexClient = {
  waitForControl(kind: string, timeoutMs?: number): Promise<string>;
  bufferControl(kind: string, rawText: string): void;
  handleWireText(rawText: string): Promise<void>;
  on(listener: (event: { type: string }) => void): () => void;
};

type CapturedRequest = {
  method: string;
  params?: JSONValue;
  timeoutMs?: number;
};

const defaultSettings: RuntimeSettings = {
  accessMode: "onRequest",
  autoReview: false,
  gitToolbarEnabled: false,
  planMode: false
};

function createRequestCapturingClient(): {
  client: RemodexClient;
  captured: CapturedRequest[];
} {
  const client = new RemodexClient();
  const captured: CapturedRequest[] = [];
  client.request = async (method: string, params?: JSONValue, timeoutMs?: number): Promise<RPCMessage> => {
    captured.push({ method, params, timeoutMs });
    return { result: {} };
  };
  return { client, captured };
}

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

describe("RemodexClient secure relay boundary", () => {
  it("ignores plaintext JSON-RPC messages received from the relay", async () => {
    const client = new RemodexClient() as unknown as UnsafeRemodexClient;
    const events: string[] = [];
    client.on((event) => {
      events.push(event.type);
    });

    await client.handleWireText(JSON.stringify({
      jsonrpc: "2.0",
      method: "thread/list",
      id: 1
    }));

    expect(events).not.toContain("rpc");
    expect(events).not.toContain("serverRequest");
    expect(events).not.toContain("notification");
  });
});

describe("RemodexClient slow-link request budgets", () => {
  it("gives initialize enough time to cross slow relay links", async () => {
    const client = new RemodexClient() as unknown as {
      rpc: { request: (method: string, params?: JSONValue, timeoutMs?: number) => Promise<RPCMessage>; notify: () => Promise<void> };
      initializeSession: () => Promise<void>;
    };
    const captured: CapturedRequest[] = [];
    client.rpc = {
      async request(method, params, timeoutMs) {
        captured.push({ method, params, timeoutMs });
        return { result: {} };
      },
      async notify() {}
    };

    await client.initializeSession();

    expect(captured[0]?.method).toBe("initialize");
    expect(captured[0]?.timeoutMs).toBe(180_000);
  });

  it("uses slow-link timeouts for first thread list and read requests", async () => {
    const { client, captured } = createRequestCapturingClient();

    await client.listThreads();
    await client.readThread("thread-1");

    expect(captured[0]?.method).toBe("thread/list");
    expect(captured[0]?.timeoutMs).toBe(180_000);
    expect(captured[1]?.method).toBe("thread/read");
    expect(captured[1]?.timeoutMs).toBe(180_000);
  });
});

describe("RemodexClient approval responses", () => {
  it("includes route metadata so the bridge can recover desktop approvals after reconnects", async () => {
    const client = new RemodexClient() as unknown as {
      rpc: object;
      approve: RemodexClient["approve"];
      sendApplicationText: (text: string) => Promise<void>;
    };
    const sent: RPCMessage[] = [];
    client.rpc = {};
    client.sendApplicationText = async (text: string) => {
      sent.push(JSON.parse(text) as RPCMessage);
    };

    await client.approve({
      id: "req-command",
      requestID: "req-command",
      method: "item/commandExecution/requestApproval",
      threadId: "thread-live",
      desktopOwnerClientId: "desktop-owner"
    }, "accept");

    expect(sent).toEqual([{
      id: "req-command",
      result: { decision: "accept" },
      remodexRequestMethod: "item/commandExecution/requestApproval",
      remodexThreadId: "thread-live",
      remodexDesktopOwnerClientId: "desktop-owner"
    }]);
  });

  it("surfaces async approval reply failures from the bridge", () => {
    const client = new RemodexClient() as unknown as {
      handleRPCText: (rawText: string) => void;
      on: (listener: (event: { type: string; error?: Error }) => void) => () => void;
    };
    const errors: string[] = [];
    client.on((event) => {
      if (event.type === "error" && event.error) {
        errors.push(event.error.message);
      }
    });

    client.handleRPCText(JSON.stringify({
      id: "req-command",
      error: {
        code: -32000,
        message: "Could not send this action to Codex on the Mac."
      }
    }));

    expect(errors).toEqual(["Could not send this action to Codex on the Mac."]);
  });

  it("answers desktop user-input prompts with the selected option", async () => {
    const client = new RemodexClient() as unknown as {
      rpc: object;
      answerUserInput: RemodexClient["answerUserInput"];
      sendApplicationText: (text: string) => Promise<void>;
    };
    const sent: RPCMessage[] = [];
    client.rpc = {};
    client.sendApplicationText = async (text: string) => {
      sent.push(JSON.parse(text) as RPCMessage);
    };

    await client.answerUserInput({
      id: "req-input",
      requestID: "req-input",
      method: "item/tool/requestUserInput",
      threadId: "thread-live",
      desktopOwnerClientId: "desktop-owner"
    }, "q1", "Yes");

    expect(sent).toEqual([{
      id: "req-input",
      result: {
        answers: {
          q1: {
            answers: ["Yes"]
          }
        }
      },
      remodexRequestMethod: "item/tool/requestUserInput",
      remodexThreadId: "thread-live",
      remodexDesktopOwnerClientId: "desktop-owner"
    }]);
  });

  it("treats desktop user-input prompts as actionable requests", () => {
    const client = new RemodexClient() as unknown as {
      handleRPCText: (rawText: string) => void;
      on: (listener: (event: { type: string; request?: { id: string; method: string } }) => void) => () => void;
    };
    const approvals: Array<{ id: string; method: string }> = [];
    client.on((event) => {
      if (event.type === "approval" && event.request) {
        approvals.push(event.request);
      }
    });

    client.handleRPCText(JSON.stringify({
      id: "req-input",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-live",
        remodexDesktopOwnerClientId: "desktop-owner",
        questions: [{
          id: "q1",
          question: "Approve?",
          options: [{ label: "Yes" }]
        }]
      }
    }));

    expect(approvals).toEqual([
      expect.objectContaining({
        id: "req-input",
        method: "item/tool/requestUserInput",
        desktopOwnerClientId: "desktop-owner"
      })
    ]);
  });
});

describe("RemodexClient approval reviewer params", () => {
  it("sends guardian approvals when auto review is enabled", async () => {
    const { client, captured } = createRequestCapturingClient();

    await client.startTurn({
      threadId: "thread-1",
      text: "hello",
      attachments: [],
      settings: { ...defaultSettings, autoReview: true }
    });

    expect(captured[0]?.method).toBe("turn/start");
    const params = captured[0]?.params as JSONObject;
    expect(params.approvalsReviewer).toBe("guardian_subagent");
    expect(params.approvals_reviewer).toBe("guardian_subagent");
  });

  it("sends user approvals when auto review is disabled", async () => {
    const { client, captured } = createRequestCapturingClient();

    await client.startTurn({
      threadId: "thread-1",
      text: "hello",
      attachments: [],
      settings: { ...defaultSettings, autoReview: false }
    });

    expect(captured[0]?.method).toBe("turn/start");
    const params = captured[0]?.params as JSONObject;
    expect(params.approvalsReviewer).toBe("user");
    expect(params.approvals_reviewer).toBe("user");
  });
});
