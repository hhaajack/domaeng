import { describe, expect, it } from "vitest";
import {
  appendLocalUserMessage,
  applyNotification,
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
});
