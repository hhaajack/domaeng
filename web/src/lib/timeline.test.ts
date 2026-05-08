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
