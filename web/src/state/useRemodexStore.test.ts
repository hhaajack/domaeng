import { afterEach, describe, expect, it, vi } from "vitest";
import { RPCError } from "../lib/jsonRpc";
import { useRemodexStore } from "./useRemodexStore";

const initialState = useRemodexStore.getState();
const client = initialState.client;
const LAST_ACTIVE_THREAD_STORAGE_KEY = "remodex-web:lastActiveThreadId";
const THREAD_TITLE_CACHE_STORAGE_KEY = "remodex-web:threadTitles";
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
  interruptTurn: client.interruptTurn.bind(client),
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
  client.interruptTurn = originalClientMethods.interruptTurn;
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

afterEach(() => {
  localStorage.removeItem(LAST_ACTIVE_THREAD_STORAGE_KEY);
  localStorage.removeItem(THREAD_TITLE_CACHE_STORAGE_KEY);
});

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

  it("asks Codex.app to refresh as soon as a web-created thread exists", async () => {
    client.startThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "new-thread",
          title: "Conversation",
          cwd: "/repo"
        }
      }
    });
    client.refreshDesktopThread = vi.fn().mockResolvedValue({ result: { success: true } });

    useRemodexStore.setState({
      runtimeSettings: {
        accessMode: "onRequest",
        planMode: false,
        model: "gpt-5.5"
      }
    });

    await useRemodexStore.getState().newThread("/repo");

    expect(client.refreshDesktopThread).toHaveBeenCalledWith("new-thread");
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

  it("nudges Codex.app refresh after an assistant response completes on the phone", async () => {
    client.refreshDesktopThread = vi.fn().mockResolvedValue({ result: { success: true } });
    client.readContextWindowUsage = vi.fn().mockResolvedValue({ usage: { tokensUsed: 12, tokenLimit: 100 } });
    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active",
      runningTurnByThread: { "thread-active": "turn-active" }
    });

    emitClientEvent({
      type: "notification",
      method: "turn/completed",
      params: {
        threadId: "thread-active",
        turnId: "turn-active"
      }
    });

    await vi.waitFor(() => {
      expect(client.refreshDesktopThread).toHaveBeenCalledWith("thread-active");
    });
  });

  it("lets the user dismiss the global error banner", () => {
    useRemodexStore.setState({ lastError: "no rollout found for thread id thread-active" });

    useRemodexStore.getState().dismissLastError();

    expect(useRemodexStore.getState().lastError).toBeUndefined();
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

  it("settles local stop state and ignores stale active refreshes for the interrupted turn", async () => {
    client.interruptTurn = vi.fn().mockResolvedValue({ result: { success: true } });
    client.listThreads = vi.fn().mockResolvedValue([
      { id: "thread-active", title: "Active", status: "active" }
    ]);
    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active",
      messagesByThread: {
        "thread-active": [
          {
            id: "thinking",
            role: "reasoning",
            kind: "reasoning",
            threadId: "thread-active",
            turnId: "turn-stop",
            text: "Thinking...",
            createdAt: 1,
            streaming: true
          },
          {
            id: "assistant",
            role: "assistant",
            kind: "chat",
            threadId: "thread-active",
            turnId: "turn-stop",
            text: "partial",
            createdAt: 2,
            streaming: true
          }
        ]
      },
      runningTurnByThread: { "thread-active": "turn-stop" },
      threadRunStateByThread: { "thread-active": "running" }
    });

    await useRemodexStore.getState().stopActiveTurn();

    expect(client.interruptTurn).toHaveBeenCalledWith("thread-active", "turn-stop");
    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().messagesByThread["thread-active"]).toEqual([
      expect.objectContaining({ id: "assistant", streaming: false })
    ]);

    emitClientEvent({
      type: "notification",
      method: "thread/status/changed",
      params: {
        threadId: "thread-active",
        status: "active"
      }
    });
    await useRemodexStore.getState().refreshThreads();

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBeUndefined();

    emitClientEvent({
      type: "notification",
      method: "turn/completed",
      params: {
        threadId: "thread-active",
        turnId: "turn-stop",
        status: "cancelled"
      }
    });

    expect(useRemodexStore.getState().locallyInterruptedTurnByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().inAppNotifications).toEqual([]);
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

  it("keeps fallback running state when a stale thread read only contains older completed turns", async () => {
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-active",
          title: "Active",
          turns: [{
            id: "older-turn",
            status: "completed",
            items: [{
              id: "older-answer",
              type: "assistant_message",
              text: "already rendered"
            }]
          }]
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

    await useRemodexStore.getState().openThread("thread-active");

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBe("__running__");
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

  it("restores the last active thread after reconnect when it is still listed", async () => {
    localStorage.setItem(LAST_ACTIVE_THREAD_STORAGE_KEY, JSON.stringify("thread-old"));
    client.listThreads = vi.fn().mockResolvedValue([
      { id: "thread-new", title: "Newest", updatedAt: 2 },
      { id: "thread-old", title: "Previous", updatedAt: 1 }
    ]);
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-old",
          title: "Previous",
          turns: []
        }
      }
    });

    useRemodexStore.setState({
      threads: [],
      activeThreadId: undefined,
      messagesByThread: {},
      runningTurnByThread: {},
      threadRunStateByThread: {}
    });

    await useRemodexStore.getState().refreshThreads();

    expect(useRemodexStore.getState().activeThreadId).toBe("thread-old");
    expect(client.readThread).toHaveBeenCalledWith("thread-old");
  });

  it("does not downgrade a resolved thread title when list refresh returns the default title", async () => {
    client.listThreads = vi.fn().mockResolvedValue([
      { id: "thread-active", title: "Conversation", cwd: "/repo", status: "idle" }
    ]);

    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "测试", cwd: "/repo", status: "idle" }],
      activeThreadId: "thread-active",
      messagesByThread: { "thread-active": [{ id: "message-1", role: "user", kind: "chat", threadId: "thread-active", text: "测试", createdAt: 1 }] },
      runningTurnByThread: {},
      threadRunStateByThread: {}
    });

    await useRemodexStore.getState().refreshThreads();

    expect(useRemodexStore.getState().threads[0]).toEqual(expect.objectContaining({
      id: "thread-active",
      title: "测试"
    }));
  });

  it("uses the cached resolved thread title before the active thread read returns", async () => {
    localStorage.setItem(THREAD_TITLE_CACHE_STORAGE_KEY, JSON.stringify({
      "thread-active": "测试"
    }));
    client.listThreads = vi.fn().mockResolvedValue([
      { id: "thread-active", title: "Conversation", cwd: "/repo", status: "idle" }
    ]);
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-active",
          title: "Conversation",
          cwd: "/repo",
          turns: []
        }
      }
    });

    useRemodexStore.setState({
      threads: [],
      activeThreadId: undefined,
      messagesByThread: {},
      runningTurnByThread: {},
      threadRunStateByThread: {}
    });

    await useRemodexStore.getState().refreshThreads();

    expect(useRemodexStore.getState().threads[0]).toEqual(expect.objectContaining({
      id: "thread-active",
      title: "测试"
    }));
  });

  it("falls back to the newest thread when the last active thread is not listed", async () => {
    localStorage.setItem(LAST_ACTIVE_THREAD_STORAGE_KEY, JSON.stringify("missing-thread"));
    client.listThreads = vi.fn().mockResolvedValue([
      { id: "thread-new", title: "Newest", updatedAt: 2 },
      { id: "thread-old", title: "Previous", updatedAt: 1 }
    ]);
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-new",
          title: "Newest",
          turns: []
        }
      }
    });

    useRemodexStore.setState({
      threads: [],
      activeThreadId: undefined,
      messagesByThread: {},
      runningTurnByThread: {},
      threadRunStateByThread: {}
    });

    await useRemodexStore.getState().refreshThreads();

    expect(useRemodexStore.getState().activeThreadId).toBe("thread-new");
    expect(client.readThread).toHaveBeenCalledWith("thread-new");
  });

  it("keeps an unlisted locally created active thread during background refresh", async () => {
    client.listThreads = vi.fn().mockResolvedValue([
      { id: "standup-thread", title: "Standup summary", updatedAt: 2 }
    ]);
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "standup-thread",
          title: "Standup summary",
          turns: []
        }
      }
    });

    useRemodexStore.setState({
      threads: [
        { id: "new-thread", title: "New chat", cwd: "/repo" },
        { id: "standup-thread", title: "Standup summary", updatedAt: 2 }
      ],
      activeThreadId: "new-thread",
      locallyStartedThreadIds: { "new-thread": true },
      messagesByThread: {},
      runningTurnByThread: {},
      threadRunStateByThread: {}
    });

    await useRemodexStore.getState().refreshThreads();

    expect(useRemodexStore.getState().activeThreadId).toBe("new-thread");
    expect(useRemodexStore.getState().threads.map((thread) => thread.id)).toEqual([
      "new-thread",
      "standup-thread"
    ]);
    expect(client.readThread).not.toHaveBeenCalled();
  });

  it("clears list-derived running state when the refreshed thread list reports idle", async () => {
    client.listThreads = vi.fn().mockResolvedValue([{ id: "thread-active", title: "Active", status: "idle" }]);

    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active", status: "active" }],
      activeThreadId: "thread-active",
      messagesByThread: { "thread-active": [] },
      runningTurnByThread: { "thread-active": "__running__" },
      threadRunStateByThread: { "thread-active": "running" }
    });

    await useRemodexStore.getState().refreshThreads();

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBeUndefined();
  });

  it("keeps live mirrored fallback running state when the refreshed thread list reports idle", async () => {
    client.listThreads = vi.fn().mockResolvedValue([{ id: "thread-active", title: "Active", status: "idle" }]);

    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active", status: "active" }],
      activeThreadId: "thread-active",
      messagesByThread: {
        "thread-active": [{
          id: "tool-live",
          role: "tool",
          kind: "tool",
          threadId: "thread-active",
          turnId: "__running__",
          itemId: "tool-live",
          text: "sleep 20",
          createdAt: Date.now()
        }]
      },
      runningTurnByThread: { "thread-active": "__running__" },
      threadRunStateByThread: { "thread-active": "running" }
    });

    await useRemodexStore.getState().refreshThreads();

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

  it("keeps fallback running state until a terminal thread status arrives", () => {
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
      method: "turn/completed",
      params: {
        threadId: "thread-active"
      }
    });

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBe("__running__");
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBe("running");

    emitClientEvent({
      type: "notification",
      method: "thread/status/changed",
      params: {
        threadId: "thread-active",
        status: "idle"
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
    expect(useRemodexStore.getState().runningTurnByThread["thread-bg"]).toBe("turn-bg");
    expect(useRemodexStore.getState().pendingApprovals).toHaveLength(1);
    expect(useRemodexStore.getState().inAppNotifications.map((entry) => entry.kind)).toEqual([
      "approval",
      "ready"
    ]);
  });

  it("keeps the active composer in stop mode while an approval is pending", () => {
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
      method: "item/completed",
      params: {
        threadId: "thread-active",
        turnId: "turn-active",
        item: {
          id: "assistant-item",
          type: "assistant_message",
          text: "I need to run a command."
        }
      }
    });
    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBeUndefined();

    emitClientEvent({
      type: "approval",
      request: {
        id: "approval-active",
        requestID: "approval-active",
        method: "item/commandExecution/requestApproval",
        command: "npm test",
        threadId: "thread-active",
        turnId: "turn-active"
      }
    });

    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBe("turn-active");
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBe("approval");
    expect(useRemodexStore.getState().pendingApprovals).toHaveLength(1);
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

    expect(client.readThread).toHaveBeenCalledWith("thread-active");
    expect(useRemodexStore.getState().runningTurnByThread["thread-active"]).toBeUndefined();
    expect(useRemodexStore.getState().threadRunStateByThread["thread-active"]).toBeUndefined();
  });

  it("keeps reconnect state running when thread/read reports an in-progress turn", async () => {
    client.listThreads = vi.fn().mockResolvedValue([{ id: "thread-active", title: "Active" }]);
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

  it("keeps a live turn running when thread/read only contains assistant commentary", async () => {
    client.readThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          id: "thread-active",
          title: "Active",
          turns: [{
            id: "turn-live",
            items: [{
              id: "user-item",
              type: "user_message",
              content: [{ type: "input_text", text: "run a slow command" }]
            }, {
              id: "assistant-commentary",
              type: "message",
              role: "assistant",
              phase: "commentary",
              content: [{ type: "output_text", text: "Still working." }]
            }]
          }]
        }
      }
    });

    useRemodexStore.setState({
      threads: [{ id: "thread-active", title: "Active" }],
      activeThreadId: "thread-active",
      messagesByThread: { "thread-active": [] },
      runningTurnByThread: { "thread-active": "turn-live" },
      threadRunStateByThread: { "thread-active": "running" }
    });

    await useRemodexStore.getState().refreshThreadSnapshot("thread-active");

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
