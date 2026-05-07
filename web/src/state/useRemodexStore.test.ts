import { afterEach, describe, expect, it, vi } from "vitest";
import { RPCError } from "../lib/jsonRpc";
import { useRemodexStore } from "./useRemodexStore";

const initialState = useRemodexStore.getState();
const client = initialState.client;
const originalClientMethods = {
  resumeThread: client.resumeThread.bind(client),
  startThread: client.startThread.bind(client),
  startTurn: client.startTurn.bind(client),
  refreshDesktopThread: client.refreshDesktopThread.bind(client)
};

describe("useRemodexStore sendComposer", () => {
  afterEach(() => {
    client.resumeThread = originalClientMethods.resumeThread;
    client.startThread = originalClientMethods.startThread;
    client.startTurn = originalClientMethods.startTurn;
    client.refreshDesktopThread = originalClientMethods.refreshDesktopThread;
    useRemodexStore.setState({
      ...initialState,
      client,
      threads: [],
      activeThreadId: undefined,
      messagesByThread: {},
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

  it("sends the first turn on a locally created thread without requiring a rollout-backed resume", async () => {
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

    expect(client.resumeThread).not.toHaveBeenCalled();
    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "new-thread",
      text: "first message from web"
    }));
    expect(useRemodexStore.getState().composerText).toBe("");
    expect(useRemodexStore.getState().locallyStartedThreadIds["new-thread"]).toBeUndefined();
  });
});
