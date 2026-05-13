import { afterEach, describe, expect, it, vi } from "vitest";
import { RPCError } from "../lib/jsonRpc";
import { useRemodexStore } from "./useRemodexStore";

const initialState = useRemodexStore.getState();
const client = initialState.client;
const originalClientMethods = {
  listThreads: client.listThreads.bind(client),
  readThread: client.readThread.bind(client),
  listThreadTurns: client.listThreadTurns.bind(client),
  connectTrusted: client.connectTrusted.bind(client),
  renameThread: client.renameThread.bind(client),
  resumeThread: client.resumeThread.bind(client),
  startThread: client.startThread.bind(client),
  startTurn: client.startTurn.bind(client),
  steerTurn: client.steerTurn.bind(client),
  refreshDesktopThread: client.refreshDesktopThread.bind(client),
  approve: client.approve.bind(client),
  answerUserInput: client.answerUserInput.bind(client),
  listModels: client.listModels.bind(client),
  readContextWindowUsage: client.readContextWindowUsage.bind(client),
  readRateLimits: client.readRateLimits.bind(client),
  gitStatus: client.gitStatus.bind(client),
  gitCommit: client.gitCommit.bind(client),
  gitPush: client.gitPush.bind(client),
  gitPull: client.gitPull.bind(client)
};

function restoreClientMethods() {
  client.listThreads = originalClientMethods.listThreads;
  client.readThread = originalClientMethods.readThread;
  client.listThreadTurns = originalClientMethods.listThreadTurns;
  client.connectTrusted = originalClientMethods.connectTrusted;
  client.renameThread = originalClientMethods.renameThread;
  client.resumeThread = originalClientMethods.resumeThread;
  client.startThread = originalClientMethods.startThread;
  client.startTurn = originalClientMethods.startTurn;
  client.steerTurn = originalClientMethods.steerTurn;
  client.refreshDesktopThread = originalClientMethods.refreshDesktopThread;
  client.approve = originalClientMethods.approve;
  client.answerUserInput = originalClientMethods.answerUserInput;
  client.listModels = originalClientMethods.listModels;
  client.readContextWindowUsage = originalClientMethods.readContextWindowUsage;
  client.readRateLimits = originalClientMethods.readRateLimits;
  client.gitStatus = originalClientMethods.gitStatus;
  client.gitCommit = originalClientMethods.gitCommit;
  client.gitPush = originalClientMethods.gitPush;
  client.gitPull = originalClientMethods.gitPull;
}

describe("useRemodexStore renameThread", () => {
  afterEach(() => {
    restoreClientMethods();
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
      lastError: undefined
    }, true);
  });

  it("renames a thread through the bridge and updates the sidebar list", async () => {
    client.renameThread = vi.fn().mockResolvedValue({
      threadId: "thread-1",
      name: "New name"
    });
    useRemodexStore.setState({
      threads: [{ id: "thread-1", title: "Old name", cwd: "/repo" }],
      activeThreadId: "thread-1"
    });

    await useRemodexStore.getState().renameThread("thread-1", "  New name  ");

    expect(client.renameThread).toHaveBeenCalledWith("thread-1", "New name");
    expect(useRemodexStore.getState().threads[0]).toEqual(expect.objectContaining({
      title: "New name",
      name: "New name"
    }));
    expect(useRemodexStore.getState().lastError).toBeUndefined();
  });
});

describe("useRemodexStore sendComposer", () => {
  afterEach(() => {
    restoreClientMethods();
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
      contextWindowUsageByThread: {},
      contextWindowUsageLoadedAtByThread: {},
      contextWindowUsageErrorByThread: {},
      isLoadingContextWindowUsageByThread: {},
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

  it("marks the selected thread running while turn start is still pending", async () => {
    let resolveStartTurn: (value: { result: { turn: { id: string } } }) => void = () => {};
    const startTurnPromise = new Promise<{ result: { turn: { id: string } } }>((resolve) => {
      resolveStartTurn = resolve;
    });
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
    client.startTurn = vi.fn().mockReturnValue(startTurnPromise);
    client.refreshDesktopThread = vi.fn().mockResolvedValue({ result: { success: true } });

    useRemodexStore.setState({
      threads: [{ id: "thread-1", title: "Writable", cwd: "/repo" }],
      activeThreadId: "thread-1",
      messagesByThread: { "thread-1": [] },
      composerText: "show running immediately",
      attachments: [],
      runtimeSettings: {
        accessMode: "onRequest",
        planMode: false,
        model: "gpt-5.5"
      }
    });

    const sendPromise = useRemodexStore.getState().sendComposer();

    await vi.waitFor(() => {
      expect(useRemodexStore.getState().runningTurnByThread["thread-1"]).toBe("__running__");
    });
    expect(useRemodexStore.getState().threadRunStateByThread["thread-1"]).toBe("running");
    expect(useRemodexStore.getState().composerText).toBe("");

    resolveStartTurn({ result: { turn: { id: "turn-1" } } });
    await sendPromise;

    expect(useRemodexStore.getState().runningTurnByThread["thread-1"]).toBe("turn-1");
    expect(useRemodexStore.getState().threadRunStateByThread["thread-1"]).toBe("running");
  });

  it("clears the optimistic running state when turn start fails", async () => {
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
    client.startTurn = vi.fn().mockRejectedValue(new Error("turn start failed"));
    client.refreshDesktopThread = vi.fn();

    useRemodexStore.setState({
      threads: [{ id: "thread-1", title: "Writable", cwd: "/repo" }],
      activeThreadId: "thread-1",
      messagesByThread: { "thread-1": [] },
      composerText: "rollback running",
      attachments: [],
      runtimeSettings: {
        accessMode: "onRequest",
        planMode: false,
        model: "gpt-5.5"
      }
    });

    await useRemodexStore.getState().sendComposer();

    expect(useRemodexStore.getState().runningTurnByThread["thread-1"]).toBeUndefined();
    expect(useRemodexStore.getState().threadRunStateByThread["thread-1"]).toBeUndefined();
    expect(useRemodexStore.getState().lastError).toBe("turn start failed");
    expect(client.refreshDesktopThread).not.toHaveBeenCalled();
  });

  it("does not steer when send discovers the thread is already running", async () => {
    client.resumeThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-1",
          title: "Writable",
          cwd: "/repo",
          turns: [{
            id: "turn-live",
            status: "running",
            items: []
          }]
        }
      }
    });
    client.startTurn = vi.fn();
    client.steerTurn = vi.fn().mockResolvedValue({ result: { turnId: "turn-live" } });
    client.refreshDesktopThread = vi.fn().mockResolvedValue({ result: { success: true } });

    useRemodexStore.setState({
      threads: [{ id: "thread-1", title: "Writable", cwd: "/repo" }],
      activeThreadId: "thread-1",
      messagesByThread: { "thread-1": [] },
      composerText: "follow up while running",
      attachments: [],
      runtimeSettings: {
        accessMode: "onRequest",
        planMode: false,
        model: "gpt-5.5"
      }
    });

    await useRemodexStore.getState().sendComposer();

    expect(client.steerTurn).not.toHaveBeenCalled();
    expect(client.startTurn).not.toHaveBeenCalled();
    expect(client.refreshDesktopThread).not.toHaveBeenCalled();
    expect(useRemodexStore.getState().composerText).toBe("follow up while running");
    expect(useRemodexStore.getState().lastError).toContain("Codex is still working");
  });

  it("does not steer when a fallback running marker is rehydrated", async () => {
    client.resumeThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-1",
          title: "Writable",
          cwd: "/repo",
          status: "running",
          turns: []
        }
      }
    });
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-1",
          title: "Writable",
          cwd: "/repo",
          turns: [{
            id: "turn-refreshed",
            status: "running",
            items: []
          }]
        }
      }
    });
    client.startTurn = vi.fn();
    client.steerTurn = vi.fn().mockResolvedValue({ result: { turnId: "turn-refreshed" } });
    client.refreshDesktopThread = vi.fn().mockResolvedValue({ result: { success: true } });

    useRemodexStore.setState({
      threads: [{ id: "thread-1", title: "Writable", cwd: "/repo" }],
      activeThreadId: "thread-1",
      messagesByThread: { "thread-1": [] },
      composerText: "follow up after placeholder",
      attachments: [],
      runtimeSettings: {
        accessMode: "onRequest",
        planMode: false,
        model: "gpt-5.5"
      }
    });

    await useRemodexStore.getState().sendComposer();

    expect(client.readThread).not.toHaveBeenCalled();
    expect(client.steerTurn).not.toHaveBeenCalled();
    expect(client.startTurn).not.toHaveBeenCalled();
    expect(useRemodexStore.getState().composerText).toBe("follow up after placeholder");
    expect(useRemodexStore.getState().lastError).toContain("Codex is still working");
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
    restoreClientMethods();
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
      contextWindowUsageByThread: {},
      contextWindowUsageLoadedAtByThread: {},
      contextWindowUsageErrorByThread: {},
      isLoadingContextWindowUsageByThread: {},
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
    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().inAppNotifications).toEqual([]);
  });

  it("uses desktop thread status updates to drive the active composer stop state", () => {
    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active"
    });

    emitClientEvent({
      type: "notification",
      method: "thread/status/changed",
      params: {
        threadId: "thread-active",
        status: "active"
      }
    });

    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBe("running");
    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBe("__running__");

    emitClientEvent({
      type: "notification",
      method: "thread/status/changed",
      params: {
        threadId: "thread-active",
        status: "idle"
      }
    });

    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBeUndefined();
  });

  it("keeps running state when stale thread reads omit a web-started turn", async () => {
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-active",
          title: "Active",
          turns: []
        }
      }
    });
    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active",
      messagesByThread: {
        "thread-active": [{
          id: "pending-web",
          role: "user",
          kind: "chat",
          threadId: "thread-active",
          text: "web prompt",
          createdAt: Date.now(),
          metadata: { remodexLocalPending: true }
        }]
      },
      runningTurnByThread: { "thread-active": "__running__" },
      threadRunStateByThread: { "thread-active": "running" }
    });

    await useRemodexStore.getState().openThread("thread-active");

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBe("__running__");
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBe("running");
  });

  it("keeps running state when stale thread reads omit a desktop-started turn", async () => {
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-active",
          title: "Active",
          turns: []
        }
      }
    });
    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active"
    });

    emitClientEvent({
      type: "notification",
      method: "thread/status/changed",
      params: {
        threadId: "thread-active",
        status: "active"
      }
    });
    emitClientEvent({
      type: "notification",
      method: "codex/event/user_message",
      params: {
        threadId: "thread-active",
        turnId: "desktop-turn",
        message: "desktop prompt"
      }
    });
    emitClientEvent({
      type: "notification",
      method: "turn/started",
      params: {
        threadId: "thread-active",
        turnId: "desktop-turn"
      }
    });

    await useRemodexStore.getState().openThread("thread-active");

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBe("desktop-turn");
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBe("running");
  });

  it("hydrates the active composer running state from the refreshed thread list", async () => {
    client.listThreads = vi.fn().mockResolvedValue([{ id: "thread-active", title: "Active", status: "active" }]);
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-active",
          title: "Active",
          turns: []
        }
      }
    });
    client.listModels = vi.fn().mockResolvedValue([]);
    client.readRateLimits = vi.fn().mockResolvedValue({});

    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active",
      messagesByThread: { "thread-active": [] },
      runningTurnByThread: {},
      threadRunStateByThread: {}
    });

    await useRemodexStore.getState().refreshAfterConnect();

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBe("__running__");
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBe("running");
  });

  it("ignores turn-less terminal events that arrive after a concrete running turn", () => {
    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active"
    });

    emitClientEvent({
      type: "notification",
      method: "turn/started",
      params: {
        threadId: "thread-active",
        turnId: "turn-new"
      }
    });
    emitClientEvent({
      type: "notification",
      method: "turn/completed",
      params: {
        threadId: "thread-active"
      }
    });

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBe("turn-new");
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBe("running");

    emitClientEvent({
      type: "notification",
      method: "turn/completed",
      params: {
        threadId: "thread-active",
        turnId: "turn-new"
      }
    });

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBeUndefined();
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

  it("keeps approval requests visible until the bridge confirms resolution", async () => {
    client.approve = vi.fn().mockResolvedValue(undefined);
    useRemodexStore.setState({
      pendingApprovals: [{
        id: "approval-1",
        requestID: "approval-1",
        method: "item/commandExecution/requestApproval",
        command: "npm test",
        threadId: "thread-bg",
        turnId: "turn-bg"
      }]
    });

    await useRemodexStore.getState().approve(useRemodexStore.getState().pendingApprovals[0], "accept");

    expect(client.approve).toHaveBeenCalledWith(expect.objectContaining({ id: "approval-1" }), "accept");
    expect(useRemodexStore.getState().pendingApprovals).toHaveLength(1);

    emitClientEvent({
      type: "notification",
      method: "serverRequest/resolved",
      params: {
        requestId: "approval-1"
      }
    });
    expect(useRemodexStore.getState().pendingApprovals).toHaveLength(0);
  });

  it("recovers a broken secure workspace through trusted reconnect", async () => {
    client.connectTrusted = vi.fn().mockImplementation(async () => {
      emitClientEvent({ type: "secureState", state: "encrypted" });
      emitClientEvent({ type: "status", status: "connected" });
    });
    client.listThreads = vi.fn().mockResolvedValue([]);
    client.listModels = vi.fn().mockResolvedValue([]);
    client.readRateLimits = vi.fn().mockResolvedValue({});
    useRemodexStore.setState({
      connectionStatus: "connected",
      secureState: "encrypted",
      lastError: "old warning"
    });

    emitClientEvent({
      type: "error",
      error: new Error("The bridge could not decrypt the Domaeng client secure payload.")
    });

    await vi.waitFor(() => {
      expect(client.connectTrusted).toHaveBeenCalledTimes(1);
    });
    const state = useRemodexStore.getState();
    expect(state.connectionStatus).toBe("connected");
    expect(state.secureState).toBe("encrypted");
    expect(state.lastError).toBeUndefined();
  });

  it("keeps trusted reconnect failures recoverable when the Mac session is offline", async () => {
    client.connectTrusted = vi.fn().mockRejectedValue(Object.assign(
      new Error("The trusted Mac is offline right now."),
      { code: "session_unavailable" }
    ));
    useRemodexStore.setState({
      connectionStatus: "connected",
      secureState: "encrypted",
      lastError: "old warning"
    });

    emitClientEvent({
      type: "error",
      error: new Error("The bridge could not decrypt the Domaeng client secure payload.")
    });

    await vi.waitFor(() => {
      expect(useRemodexStore.getState().secureState).toBe("liveSessionUnresolved");
    });
    const state = useRemodexStore.getState();
    expect(state.connectionStatus).toBe("disconnected");
    expect(state.lastError).toBe("The trusted Mac is offline right now.");
  });

  it("rechecks the active thread after reconnect even when cached messages exist", async () => {
    client.listThreads = vi.fn().mockResolvedValue([{ id: "thread-active", title: "Active" }]);
    client.listThreadTurns = vi.fn().mockResolvedValue({
      result: {
        data: [{
          id: "turn-active",
          status: "completed",
          items: [{
            id: "assistant-item",
            type: "agentMessage",
            text: "done"
          }]
        }]
      }
    });
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-active",
          title: "Active",
          turns: [{
            id: "turn-active",
            status: "completed",
            items: [{
              id: "assistant-item",
              type: "agentMessage",
              text: "done"
            }]
          }]
        }
      }
    });
    client.listModels = vi.fn().mockResolvedValue([]);
    client.readRateLimits = vi.fn().mockResolvedValue({});

    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active",
      messagesByThread: {
        "thread-active": [{
          id: "cached",
          role: "assistant",
          kind: "chat",
          threadId: "thread-active",
          turnId: "turn-active",
          text: "cached",
          createdAt: 1
        }]
      },
      runningTurnByThread: { "thread-active": "turn-active" },
      threadRunStateByThread: { "thread-active": "running" }
    });

    await useRemodexStore.getState().refreshAfterConnect();

    expect(client.listThreadTurns).toHaveBeenCalledWith("thread-active", 4);
    expect(client.readThread).not.toHaveBeenCalled();
    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBeUndefined();
  });

  it("keeps reconnect state running when thread/read reports an in-progress turn", async () => {
    client.listThreads = vi.fn().mockResolvedValue([{ id: "thread-active", title: "Active" }]);
    client.listThreadTurns = vi.fn().mockRejectedValue(new Error("turns list unavailable"));
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-active",
          title: "Active",
          turns: [{
            id: "turn-live",
            status: { type: "in_progress" },
            items: []
          }]
        }
      }
    });
    client.listModels = vi.fn().mockResolvedValue([]);
    client.readRateLimits = vi.fn().mockResolvedValue({});

    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active",
      messagesByThread: { "thread-active": [] },
      runningTurnByThread: {},
      threadRunStateByThread: {}
    });

    await useRemodexStore.getState().refreshAfterConnect();

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBe("turn-live");
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBe("running");
  });
});

describe("useRemodexStore rate limits", () => {
  afterEach(() => {
    restoreClientMethods();
    useRemodexStore.setState({
      ...initialState,
      client,
      rateLimitBuckets: [],
      isLoadingRateLimits: false,
      rateLimitsError: undefined,
      rateLimitsLoadedAt: undefined,
      contextWindowUsageByThread: {},
      contextWindowUsageLoadedAtByThread: {},
      contextWindowUsageErrorByThread: {},
      isLoadingContextWindowUsageByThread: {}
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

  it("clears stale usage and refreshes when the Codex account changes", async () => {
    client.readRateLimits = vi.fn().mockResolvedValue({
      rateLimitsByLimitId: {
        codex_5h: {
          limitId: "codex_5h",
          primary: {
            usedPercent: 9,
            windowDurationMins: 300
          }
        }
      }
    });
    useRemodexStore.setState({
      rateLimitBuckets: [{
        limitId: "old_account",
        primary: {
          usedPercent: 92,
          windowDurationMins: 300
        }
      }],
      rateLimitsLoadedAt: 1_742_000_000_000
    });

    emitClientEvent({
      type: "notification",
      method: "account/updated",
      params: {
        account: {
          email: "new@example.com"
        }
      }
    });

    await vi.waitFor(() => {
      expect(client.readRateLimits).toHaveBeenCalledTimes(1);
      expect(useRemodexStore.getState().rateLimitBuckets[0]?.limitId).toBe("codex_5h");
    });
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

describe("useRemodexStore context window usage", () => {
  afterEach(() => {
    restoreClientMethods();
    useRemodexStore.setState({
      ...initialState,
      client,
      contextWindowUsageByThread: {},
      contextWindowUsageLoadedAtByThread: {},
      contextWindowUsageErrorByThread: {},
      isLoadingContextWindowUsageByThread: {},
      runningTurnByThread: {}
    }, true);
  });

  it("refreshes context usage for the active running turn", async () => {
    client.readContextWindowUsage = vi.fn().mockResolvedValue({
      threadId: "thread-ctx",
      usage: {
        tokens_used: 173_033,
        token_limit: 258_400
      }
    });
    useRemodexStore.setState({
      runningTurnByThread: { "thread-ctx": "turn-ctx" }
    });

    await useRemodexStore.getState().refreshContextWindowUsage("thread-ctx");

    expect(client.readContextWindowUsage).toHaveBeenCalledWith("thread-ctx", "turn-ctx");
    expect(useRemodexStore.getState().contextWindowUsageByThread["thread-ctx"]).toEqual({
      tokensUsed: 173_033,
      tokenLimit: 258_400
    });
    expect(useRemodexStore.getState().contextWindowUsageErrorByThread["thread-ctx"]).toBeUndefined();
    expect(useRemodexStore.getState().isLoadingContextWindowUsageByThread["thread-ctx"]).toBe(false);
  });

  it("applies live context usage notifications", () => {
    emitClientEvent({
      type: "notification",
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-ctx",
        usage: {
          tokensUsed: 95,
          tokenLimit: 100
        }
      }
    });

    expect(useRemodexStore.getState().contextWindowUsageByThread["thread-ctx"]).toEqual({
      tokensUsed: 95,
      tokenLimit: 100
    });
    expect(useRemodexStore.getState().contextWindowUsageLoadedAtByThread["thread-ctx"]).toEqual(expect.any(Number));
  });
});

describe("useRemodexStore git actions", () => {
  afterEach(() => {
    restoreClientMethods();
    useRemodexStore.setState({
      ...initialState,
      client,
      threads: [],
      activeThreadId: undefined,
      gitStatus: undefined,
      lastError: undefined
    }, true);
  });

  it("uses the active thread cwd for push when status has not returned a cwd", async () => {
    client.gitPush = vi.fn().mockResolvedValue({ result: { ok: true } });
    client.gitStatus = vi.fn().mockResolvedValue({
      branch: "main",
      state: "up_to_date"
    });
    useRemodexStore.setState({
      threads: [{ id: "thread-1", title: "Repo", cwd: "/repo" }],
      activeThreadId: "thread-1",
      gitStatus: { branch: "main", state: "ahead_only" }
    });

    await useRemodexStore.getState().push();

    expect(client.gitPush).toHaveBeenCalledWith("/repo");
    expect(client.gitStatus).toHaveBeenCalledWith("/repo");
  });

  it("uses the active thread cwd for pull when status has not returned a cwd", async () => {
    client.gitPull = vi.fn().mockResolvedValue({ result: { ok: true } });
    client.gitStatus = vi.fn().mockResolvedValue({
      branch: "main",
      state: "up_to_date"
    });
    useRemodexStore.setState({
      threads: [{ id: "thread-1", title: "Repo", cwd: "/repo" }],
      activeThreadId: "thread-1",
      gitStatus: { branch: "main", state: "behind_only" }
    });

    await useRemodexStore.getState().pull();

    expect(client.gitPull).toHaveBeenCalledWith("/repo");
    expect(client.gitStatus).toHaveBeenCalledWith("/repo");
  });

  it("does not surface git status timeouts as a composer error", async () => {
    client.gitStatus = vi.fn().mockRejectedValue(new Error("RPC request timed out: git/status"));
    useRemodexStore.setState({
      threads: [{ id: "thread-1", title: "Repo", cwd: "/repo" }],
      activeThreadId: "thread-1",
      gitStatus: { branch: "main", state: "up_to_date" },
      lastError: undefined
    });

    await useRemodexStore.getState().refreshGitStatus();

    expect(client.gitStatus).toHaveBeenCalledWith("/repo");
    expect(useRemodexStore.getState().gitStatus).toBeUndefined();
    expect(useRemodexStore.getState().lastError).toBeUndefined();
  });
});

function emitClientEvent(event: unknown) {
  (client as unknown as { emit(event: unknown): void }).emit(event);
}
