import { describe, expect, it } from "vitest";
import {
  appendLocalUserMessage,
  applyNotification,
  decodeThreadRead,
  type TimelineState
} from "./timeline";

function state(): TimelineState {
  return {
    threads: [],
    messagesByThread: {},
    runningTurnByThread: {}
  };
}

describe("timeline item reconciliation", () => {
  it("merges completed user items into the local user row instead of echoing as Codex", () => {
    const initial = appendLocalUserMessage(state(), "thread-1", "hello from web", []);
    const next = applyNotification(initial, "item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "user-item-1",
        type: "user_message",
        content: [{ type: "input_text", text: "hello from web" }]
      }
    });

    expect(next.messagesByThread["thread-1"]).toHaveLength(1);
    expect(next.messagesByThread["thread-1"][0]).toMatchObject({
      role: "user",
      text: "hello from web",
      turnId: "turn-1",
      itemId: "user-item-1",
      streaming: false
    });
  });

  it("finalizes an assistant streaming row with the canonical completed item body", () => {
    let next = state();
    next = applyNotification(next, "item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "assistant-item-1",
      delta: "partial"
    });
    next = applyNotification(next, "item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "assistant-item-1",
        type: "assistant_message",
        content: [{ type: "output_text", text: "final answer" }]
      }
    });

    expect(next.messagesByThread["thread-1"]).toHaveLength(1);
    expect(next.messagesByThread["thread-1"][0]).toMatchObject({
      role: "assistant",
      text: "final answer",
      itemId: "assistant-item-1",
      streaming: false
    });
  });

  it("clears running state when the assistant completed item is the only terminal signal", () => {
    let next = state();
    next = applyNotification(next, "item/reasoning/textDelta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "thinking-thread-1-turn-1",
      delta: "Thinking..."
    });
    next = applyNotification(next, "item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "assistant-item-1",
        type: "assistant_message",
        text: "final answer"
      }
    });

    expect(next.runningTurnByThread["thread-1"]).toBeUndefined();
    expect(next.messagesByThread["thread-1"]).toHaveLength(1);
    expect(next.messagesByThread["thread-1"][0]).toMatchObject({
      role: "assistant",
      text: "final answer",
      streaming: false
    });
  });

  it("reconciles assistant completion by turn when the streaming delta lacks item identity", () => {
    let next = state();
    next = applyNotification(next, "item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      delta: "final"
    });
    next = applyNotification(next, "item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "assistant-item-1",
        type: "assistant_message",
        text: "final answer"
      }
    });
    next = applyNotification(next, "item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "assistant-item-1",
        type: "assistant_message",
        text: "final answer"
      }
    });

    expect(next.messagesByThread["thread-1"]).toHaveLength(1);
    expect(next.messagesByThread["thread-1"][0]).toMatchObject({
      role: "assistant",
      text: "final answer",
      itemId: "assistant-item-1",
      streaming: false
    });
  });

  it("renders legacy mirrored user messages as user rows", () => {
    const next = applyNotification(state(), "codex/event/user_message", {
      threadId: "thread-1",
      turnId: "turn-1",
      message: "desktop prompt"
    });

    expect(next.messagesByThread["thread-1"]).toHaveLength(1);
    expect(next.messagesByThread["thread-1"][0]).toMatchObject({
      role: "user",
      text: "desktop prompt",
      turnId: "turn-1"
    });
  });

  it("infers running state from live streamed thread activity", () => {
    const next = applyNotification(state(), "item/reasoning/textDelta", {
      threadId: "thread-1",
      turnId: "turn-1",
      delta: "thinking"
    });

    expect(next.runningTurnByThread["thread-1"]).toBe("turn-1");
  });

  it("keeps a local user row when a stale thread read omits it", () => {
    const initial = appendLocalUserMessage(state(), "thread-1", "web prompt still pending", []);
    const next = decodeThreadRead(initial, {
      thread: {
        id: "thread-1",
        turns: []
      }
    });

    expect(next.messagesByThread["thread-1"]).toHaveLength(1);
    expect(next.messagesByThread["thread-1"][0]).toMatchObject({
      role: "user",
      text: "web prompt still pending"
    });
  });

  it("keeps live mirrored rows when a stale thread read omits them", () => {
    let initial = applyNotification(state(), "codex/event/user_message", {
      threadId: "thread-1",
      turnId: "turn-live",
      message: "desktop prompt"
    });
    initial = applyNotification(initial, "codex/event/agent_message", {
      threadId: "thread-1",
      turnId: "turn-live",
      itemId: "desktop-agent-live",
      message: "desktop answer"
    });

    const next = decodeThreadRead(initial, {
      thread: {
        id: "thread-1",
        turns: []
      }
    });

    expect(next.messagesByThread["thread-1"]).toHaveLength(2);
    expect(next.messagesByThread["thread-1"][0]).toMatchObject({
      role: "user",
      text: "desktop prompt"
    });
    expect(next.messagesByThread["thread-1"][1]).toMatchObject({
      role: "assistant",
      text: "desktop answer"
    });
  });

  it("does not duplicate a live assistant row after thread read catches up", () => {
    const initial = applyNotification(state(), "codex/event/agent_message", {
      threadId: "thread-1",
      turnId: "turn-live",
      itemId: "desktop-agent-live",
      message: "desktop answer"
    });

    const next = decodeThreadRead(initial, {
      thread: {
        id: "thread-1",
        turns: [{
          id: "turn-live",
          items: [{
            id: "assistant-item-1",
            type: "assistant_message",
            text: "desktop answer"
          }]
        }]
      }
    });

    expect(next.messagesByThread["thread-1"]).toHaveLength(1);
    expect(next.messagesByThread["thread-1"][0]).toMatchObject({
      role: "assistant",
      text: "desktop answer",
      itemId: "assistant-item-1"
    });
  });

  it("keeps web-authored live rows when a stale desktop refresh read omits them", () => {
    let initial = appendLocalUserMessage(state(), "thread-1", "web prompt", []);
    const localCreatedAt = initial.messagesByThread["thread-1"][0].createdAt;
    initial = applyNotification(initial, "item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-web",
      delta: "web answer"
    });

    const staleRead = decodeThreadRead(initial, {
      thread: {
        id: "thread-1",
        turns: []
      }
    });

    expect(staleRead.messagesByThread["thread-1"]).toHaveLength(2);
    expect(staleRead.messagesByThread["thread-1"].map((message) => message.text)).toEqual([
      "web prompt",
      "web answer"
    ]);

    const caughtUpRead = decodeThreadRead(staleRead, {
      thread: {
        id: "thread-1",
        turns: [{
          id: "turn-web",
          createdAt: localCreatedAt,
          items: [{
            id: "user-item-web",
            type: "user_message",
            createdAt: localCreatedAt,
            content: [{ type: "input_text", text: "web prompt" }]
          }, {
            id: "assistant-item-web",
            type: "assistant_message",
            text: "web answer"
          }]
        }]
      }
    });

    expect(caughtUpRead.messagesByThread["thread-1"]).toHaveLength(2);
    expect(caughtUpRead.messagesByThread["thread-1"][0]).toMatchObject({
      role: "user",
      itemId: "user-item-web",
      text: "web prompt"
    });
    expect(caughtUpRead.messagesByThread["thread-1"][1]).toMatchObject({
      role: "assistant",
      itemId: "assistant-item-web",
      text: "web answer"
    });
  });

  it("keeps completed live tool rows when a stale thread read omits them", () => {
    let initial = applyNotification(state(), "item/commandExecution/outputDelta", {
      threadId: "thread-1",
      turnId: "turn-tools",
      itemId: "command-live",
      delta: "npm test passed"
    });
    initial = applyNotification(initial, "turn/completed", {
      threadId: "thread-1",
      turnId: "turn-tools"
    });

    const next = decodeThreadRead(initial, {
      thread: {
        id: "thread-1",
        turns: []
      }
    });

    expect(next.messagesByThread["thread-1"]).toHaveLength(1);
    expect(next.messagesByThread["thread-1"][0]).toMatchObject({
      role: "tool",
      kind: "command",
      text: "npm test passed",
      streaming: false
    });
  });

  it("keeps running state when a stale thread read omits the live turn", () => {
    let initial = applyNotification(state(), "turn/started", {
      threadId: "thread-1",
      turnId: "turn-live"
    });
    initial = applyNotification(initial, "item/reasoning/textDelta", {
      threadId: "thread-1",
      turnId: "turn-live",
      itemId: "thinking-live",
      delta: "thinking"
    });

    const next = decodeThreadRead(initial, {
      thread: {
        id: "thread-1",
        turns: []
      }
    });

    expect(next.runningTurnByThread["thread-1"]).toBe("turn-live");
  });

  it("keeps optimistic running state when a stale thread read omits the pending web prompt", () => {
    const initial = appendLocalUserMessage({
      ...state(),
      runningTurnByThread: { "thread-1": "__running__" }
    }, "thread-1", "web prompt", []);

    const next = decodeThreadRead(initial, {
      thread: {
        id: "thread-1",
        turns: []
      }
    });

    expect(next.runningTurnByThread["thread-1"]).toBe("__running__");
  });

  it("clears running state when thread read reports the running turn completed", () => {
    const initial = {
      ...state(),
      messagesByThread: {
        "thread-1": [{
          id: "live-assistant",
          role: "assistant" as const,
          kind: "chat" as const,
          threadId: "thread-1",
          turnId: "turn-live",
          text: "live answer",
          createdAt: Date.now()
        }]
      },
      runningTurnByThread: { "thread-1": "turn-live" }
    };

    const next = decodeThreadRead(initial, {
      thread: {
        id: "thread-1",
        turns: [{
          id: "turn-live",
          status: "completed",
          items: [{
            id: "assistant-canonical",
            type: "assistant_message",
            text: "live answer"
          }]
        }]
      }
    });

    expect(next.runningTurnByThread["thread-1"]).toBeUndefined();
  });

  it("ignores stale terminal notifications for a different running turn", () => {
    let next = applyNotification(state(), "turn/started", {
      threadId: "thread-1",
      turnId: "turn-new"
    });
    next = applyNotification(next, "turn/completed", {
      threadId: "thread-1",
      turnId: "turn-old"
    });
    next = applyNotification(next, "turn/completed", {
      threadId: "thread-1"
    });

    expect(next.runningTurnByThread["thread-1"]).toBe("turn-new");
  });

  it("does not duplicate a local user row after the canonical item appears", () => {
    const initial = appendLocalUserMessage(state(), "thread-1", "web prompt confirmed", []);
    const createdAt = initial.messagesByThread["thread-1"][0].createdAt;
    const next = decodeThreadRead(initial, {
      thread: {
        id: "thread-1",
        turns: [{
          id: "turn-1",
          createdAt,
          items: [{
            id: "user-item-1",
            type: "user_message",
            createdAt,
            content: [{ type: "input_text", text: "web prompt confirmed" }]
          }]
        }]
      }
    });

    expect(next.messagesByThread["thread-1"]).toHaveLength(1);
    expect(next.messagesByThread["thread-1"][0]).toMatchObject({
      role: "user",
      text: "web prompt confirmed",
      turnId: "turn-1",
      itemId: "user-item-1"
    });
  });

  it("decodes user image attachments from nested history image_url objects", () => {
    const next = decodeThreadRead(state(), {
      thread: {
        id: "thread-1",
        turns: [{
          id: "turn-1",
          items: [{
            id: "user-item-1",
            type: "user_message",
            content: [{
              type: "input_image",
              image_url: {
                url: "data:image/png;base64,AAAA"
              }
            }, {
              type: "input_text",
              text: "photo"
            }]
          }]
        }]
      }
    });

    expect(next.messagesByThread["thread-1"][0].attachments?.[0]).toMatchObject({
      thumbnailBase64JPEG: "AAAA",
      payloadDataURL: "data:image/png;base64,AAAA"
    });
  });

  it("keeps an attachment placeholder when relay history elides image data", () => {
    const next = decodeThreadRead(state(), {
      thread: {
        id: "thread-1",
        turns: [{
          id: "turn-1",
          items: [{
            id: "user-item-1",
            type: "user_message",
            content: [{
              type: "input_image",
              url: "remodex://history-image-elided"
            }]
          }]
        }]
      }
    });

    expect(next.messagesByThread["thread-1"][0].attachments?.[0]).toMatchObject({
      sourceURL: "remodex://history-image-elided"
    });
  });
});
