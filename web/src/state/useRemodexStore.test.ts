import { afterEach, describe, expect, it, vi } from "vitest";
import { RPCError } from "../lib/jsonRpc";
import { useRemodexStore } from "./useRemodexStore";

const initialState = useRemodexStore.getState();
const client = initialState.client;
const originalClientMethods = {
  resumeThread: client.resumeThread.bind(client),
  startThread: client.startThread.bind(client),
  startTurn: client.startTurn.bind(client),
  refreshDesktopThread: client.refreshDesktopThread.bind(client),
  readRateLimits: client.readRateLimits.bind(client)
};

describe("useRemodexStore sendComposer", () => {
  afterEach(() => {
    client.resumeThread = originalClientMethods.resumeThread;
    client.startThread = originalClientMethods.startThread;
    client.startTurn = originalClientMethods.startTurn;
    client.refreshDesktopThread = originalClientMethods.refreshDesktopThread;
    client.readRateLimits = originalClientMethods.readRateLimits;
    useRemodexStore.setState({
      ...initialState,
      client,
      threads: [],
      activeThreadId: undefined,
      messagesByThread: {},
      runningTurnByThread: {},
      threadRunStateByThread: {},
      inAppNotifications: [],
      pendingApprovals: [],
      rateLimitBuckets: [],
      isLoadingRateLimits: false,
      rateLimitsError: undefined,
      rateLimitsLoadedAt: undefined,
      composerText: "",
      attachments: [],
      queuedDraftsByThread: {},
      lastError: undefined
    }, true);
  });

  it("refreshes the desktop thread after sending to the selected writable thread", async () => {
    client.resumeThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-1",
          title: "Writable",
          cwd: "/repo"
        },
        items: []
      }
    });
    client.startThread = vi.fn();
    client.startTurn = vi.fn().mockResolvedValue({ result: { turnId: "turn-1" } });
    client.refreshDesktopThread = vi.fn().mockResolvedValue({ result: { success: true } });

    useRemodexStore.setState({
      threads: [{ id: "thread-1", title: "Writable", cwd: "/repo" }],
      activeThreadId: "thread-1",
      messagesByThread: { "thread-1": [] },
      composerText: "sync this back",
      attachments: [],
      runtimeSettings: {
        accessMode: "onRequest",
        planMode: false,
        model: "gpt-5.5"
      }
    });

    await useRemodexStore.getState().sendComposer();

    expect(client.resumeThread).toHaveBeenCalledWith("thread-1", "/repo", expect.objectContaining({ model: "gpt-5.5" }));
    expect(client.startThread).not.toHaveBeenCalled();
    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "thread-1",
      text: "sync this back"
    }));
    expect(client.refreshDesktopThread).toHaveBeenCalledWith("thread-1");
  });

  it("keeps the sent turn and surfaces a warning when desktop refresh fails", async () => {
    client.resumeThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-1",
          title: "Writable",
          cwd: "/repo"
        },
        items: []
      }
    });
    client.startThread = vi.fn();
    client.startTurn = vi.fn().mockResolvedValue({ result: { turnId: "turn-1" } });
    client.refreshDesktopThread = vi.fn().mockRejectedValue(new RPCError({
      code: -32601,
      message: "Method not found: desktop/refreshThread"
    }));

    useRemodexStore.setState({
      threads: [{ id: "thread-1", title: "Writable", cwd: "/repo" }],
      activeThreadId: "thread-1",
      messagesByThread: { "thread-1": [] },
      composerText: "sync this back",
      attachments: [],
      runtimeSettings: {
        accessMode: "onRequest",
        planMode: false,
        model: "gpt-5.5"
      }
    });

    await useRemodexStore.getState().sendComposer();
    await Promise.resolve();

    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "thread-1",
      text: "sync this back"
    }));
    expect(useRemodexStore.getState().composerText).toBe("");
    expect(useRemodexStore.getState().lastError).toContain("Sent, but Codex.app refresh failed");
  });

  it("creates a continuation thread when the selected thread is not writable", async () => {
    client.resumeThread = vi.fn().mockRejectedValue(new RPCError({
      code: -32000,
      message: "thread not found: old-thread"
    }));
    client.startThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "new-thread",
          title: "Continuation",
          cwd: "/repo"
        }
      }
    });
    client.startTurn = vi.fn().mockResolvedValue({ result: { turnId: "turn-1" } });
    client.refreshDesktopThread = vi.fn().mockResolvedValue({ result: { success: true } });

    useRemodexStore.setState({
      threads: [{ id: "old-thread", title: "Old", cwd: "/repo" }],
      activeThreadId: "old-thread",
      messagesByThread: { "old-thread": [] },
      composerText: "hello from web",
      attachments: [],
      runtimeSettings: {
        accessMode: "onRequest",
        planMode: false,
        model: "gpt-5.5"
      }
    });

    await useRemodexStore.getState().sendComposer();

    expect(client.startThread).toHaveBeenCalledWith("/repo", expect.objectContaining({ model: "gpt-5.5" }));
    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "new-thread",
      text: "hello from web"
    }));
    expect(client.refreshDesktopThread).toHaveBeenCalledWith("new-thread");
    expect(useRemodexStore.getState().activeThreadId).toBe("new-thread");
    expect(useRemodexStore.getState().messagesByThread["old-thread"]).toEqual([]);
    expect(useRemodexStore.getState().messagesByThread["new-thread"].map((message) => message.role)).toEqual([
      "system",
      "user"
    ]);
    expect(useRemodexStore.getState().composerText).toBe("");
  });

  it("resumes the first turn on a locally created thread before starting it", async () => {
    client.resumeThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "new-thread",
          title: "Conversation",
          cwd: "/repo"
        },
        items: []
      }
    });
    client.startThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "new-thread",
          title: "Conversation",
          cwd: "/repo"
        }
      }
    });
    client.startTurn = vi.fn().mockResolvedValue({ result: { turnId: "turn-1" } });
    client.refreshDesktopThread = vi.fn().mockResolvedValue({ result: { success: true } });

    useRemodexStore.setState({
      runtimeSettings: {
        accessMode: "onRequest",
        planMode: false,
        model: "gpt-5.5"
      }
    });

    await useRemodexStore.getState().newThread("/repo");
    useRemodexStore.setState({
      composerText: "first message from web",
      attachments: []
    });

    await useRemodexStore.getState().sendComposer();

    expect(client.resumeThread).toHaveBeenCalledWith("new-thread", "/repo", expect.objectContaining({ model: "gpt-5.5" }));
    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "new-thread",
      text: "first message from web"
    }));
    expect(useRemodexStore.getState().composerText).toBe("");
    expect(useRemodexStore.getState().locallyStartedThreadIds["new-thread"]).toBeUndefined();
  });

  it("falls back to direct start when a locally created thread has no rollout yet", async () => {
    client.resumeThread = vi.fn().mockRejectedValue(new RPCError({
      code: -32600,
      message: "no rollout found for thread id new-thread"
    }));
    client.startThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "new-thread",
          title: "Conversation",
          cwd: "/repo"
        }
      }
    });
    client.startTurn = vi.fn().mockResolvedValue({ result: { turnId: "turn-1" } });
    client.refreshDesktopThread = vi.fn().mockResolvedValue({ result: { success: true } });

    useRemodexStore.setState({
      runtimeSettings: {
        accessMode: "onRequest",
        planMode: false,
        model: "gpt-5.5"
      }
    });

    await useRemodexStore.getState().newThread("/repo");
    useRemodexStore.setState({
      composerText: "first message from web",
      attachments: []
    });

    await useRemodexStore.getState().sendComposer();

    expect(client.resumeThread).toHaveBeenCalledWith("new-thread", "/repo", expect.objectContaining({ model: "gpt-5.5" }));
    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "new-thread",
      text: "first message from web"
    }));
    expect(useRemodexStore.getState().composerText).toBe("");
    expect(useRemodexStore.getState().locallyStartedThreadIds["new-thread"]).toBeUndefined();
  });
});

describe("useRemodexStore thread activity", () => {
  afterEach(() => {
    client.readRateLimits = originalClientMethods.readRateLimits;
    useRemodexStore.setState({
      ...initialState,
      client,
      threads: [],
      activeThreadId: undefined,
      messagesByThread: {},
      runningTurnByThread: {},
      threadRunStateByThread: {},
      inAppNotifications: [],
      pendingApprovals: [],
      rateLimitBuckets: [],
      isLoadingRateLimits: false,
      rateLimitsError: undefined,
      rateLimitsLoadedAt: undefined,
      lastError: undefined
    }, true);
  });

  it("keeps the active thread from showing a stale running badge after completion", () => {
    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active"
    });

    emitClientEvent({
      type: "notification",
      method: "turn/started",
      params: {
        threadId: "thread-active",
        turnId: "turn-active"
      }
    });
    emitClientEvent({
      type: "notification",
      method: "turn/completed",
      params: {
        threadId: "thread-active",
        turnId: "turn-active"
      }
    });

    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().inAppNotifications).toEqual([]);
  });

  it("marks inactive completions and approval requests as attention states", () => {
    useRemodexStore.setState({
      threads: [
        { id: "thread-active", title: "Active" },
        { id: "thread-bg", title: "Background" }
      ],
      activeThreadId: "thread-active"
    });

    emitClientEvent({
      type: "notification",
      method: "turn/completed",
      params: {
        threadId: "thread-bg",
        turnId: "turn-bg"
      }
    });
    emitClientEvent({
      type: "approval",
      request: {
        id: "approval-1",
        requestID: "approval-1",
        method: "item/commandExecution/requestApproval",
        command: "npm test",
        threadId: "thread-bg",
        turnId: "turn-bg"
      }
    });

    expect(useRemodexStore.getState().threadRunStateByThread["thread-bg"]).toBe("approval");
    expect(useRemodexStore.getState().pendingApprovals).toHaveLength(1);
    expect(useRemodexStore.getState().inAppNotifications.map((entry) => entry.kind)).toEqual([
      "approval",
      "ready"
    ]);
  });

  it("deduplicates repeated ready and approval bubbles for the same thread event", () => {
    useRemodexStore.setState({
      threads: [{ id: "thread-bg", title: "Background" }],
      activeThreadId: "other-thread"
    });

    emitClientEvent({
      type: "notification",
      method: "turn/completed",
      params: {
        threadId: "thread-bg",
        turnId: "turn-bg"
      }
    });
    emitClientEvent({
      type: "notification",
      method: "thread/status/changed",
      params: {
        threadId: "thread-bg",
        status: "idle"
      }
    });
    emitClientEvent({
      type: "approval",
      request: {
        id: "approval-1",
        requestID: "approval-1",
        method: "item/commandExecution/requestApproval",
        command: "npm test",
        threadId: "thread-bg",
        turnId: "turn-bg"
      }
    });
    emitClientEvent({
      type: "approval",
      request: {
        id: "approval-2",
        requestID: "approval-2",
        method: "item/commandExecution/requestApproval",
        command: "npm test",
        threadId: "thread-bg",
        turnId: "turn-bg"
      }
    });

    const state = useRemodexStore.getState();
    expect(state.inAppNotifications.map((entry) => entry.kind)).toEqual(["approval", "ready"]);
    expect(state.pendingApprovals).toHaveLength(1);
    expect(state.pendingApprovals[0]?.id).toBe("approval-2");
  });
});

describe("useRemodexStore rate limits", () => {
  afterEach(() => {
    client.readRateLimits = originalClientMethods.readRateLimits;
    useRemodexStore.setState({
      ...initialState,
      client,
      rateLimitBuckets: [],
      isLoadingRateLimits: false,
      rateLimitsError: undefined,
      rateLimitsLoadedAt: undefined
    }, true);
  });

  it("decodes 5h and weekly buckets from the read response", async () => {
    client.readRateLimits = vi.fn().mockResolvedValue({
      rateLimitsByLimitId: {
        codex_5h: {
          limitId: "codex_5h",
          primary: {
            usedPercent: 3,
            windowDurationMins: 300,
            resetsAt: 1_742_000_000
          }
        },
        codex_7d: {
          limitId: "codex_7d",
          primary: {
            usedPercent: 6,
            windowDurationMins: 10_080,
            resetsAt: 1_742_500_000
          }
        }
      }
    });

    await useRemodexStore.getState().refreshRateLimits();

    const buckets = useRemodexStore.getState().rateLimitBuckets;
    expect(buckets.map((bucket) => bucket.limitId)).toEqual(["codex_5h", "codex_7d"]);
    expect(buckets[0]?.primary?.windowDurationMins).toBe(300);
    expect(buckets[0]?.primary?.resetsAt).toBe(1_742_000_000_000);
    expect(buckets[1]?.primary?.windowDurationMins).toBe(10_080);
    expect(useRemodexStore.getState().rateLimitsError).toBeUndefined();
  });

  it("merges incoming snake case rate limit updates", () => {
    useRemodexStore.setState({
      rateLimitBuckets: [{
        limitId: "codex_weekly",
        primary: {
          usedPercent: 10,
          windowDurationMins: 10_080
        }
      }]
    });

    emitClientEvent({
      type: "notification",
      method: "account/rateLimits/updated",
      params: {
        rateLimitsByLimitId: {
          codex_weekly: {
            limit_id: "codex_weekly",
            secondary_window: {
              used_percent: 12,
              window_duration_mins: 10_080
            }
          }
        }
      }
    });

    const bucket = useRemodexStore.getState().rateLimitBuckets[0];
    expect(bucket.limitId).toBe("codex_weekly");
    expect(bucket.primary?.usedPercent).toBe(10);
    expect(bucket.secondary?.usedPercent).toBe(12);
    expect(useRemodexStore.getState().rateLimitsLoadedAt).toEqual(expect.any(Number));
  });
});

function emitClientEvent(event: unknown) {
  (client as unknown as { emit(event: unknown): void }).emit(event);
}
