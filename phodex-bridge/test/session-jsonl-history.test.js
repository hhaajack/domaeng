// FILE: session-jsonl-history.test.js
// Purpose: Verifies local JSONL history reconstruction for current Codex rollout formats.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/session-jsonl-history

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseSessionJsonlTurns,
} = require("../src/session-jsonl-history");

test("response-item-only activity is reconstructed as one running turn", () => {
  const turns = parseSessionJsonlTurns([
    jsonl({ type: "session_meta", payload: { id: "thread-1", originator: "remodex_web", source: "vscode" } }),
    jsonl({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "sleep 20" }],
      },
    }),
    jsonl({ type: "response_item", payload: { type: "reasoning", id: "reasoning-1" } }),
    jsonl({
      type: "response_item",
      payload: {
        type: "function_call",
        id: "call-item-1",
        call_id: "call-1",
        name: "exec_command",
        arguments: "{\"cmd\":\"sleep 20\"}",
      },
    }),
  ].join("\n"));

  assert.equal(turns.length, 1);
  assert.equal(turns[0].status, "running");
  assert.equal(turns[0].threadId, "thread-1");
  assert.deepEqual(
    turns[0].items.map((item) => item.type),
    ["message", "tool_call"]
  );
});

test("response-item reasoning is kept only when it has displayable text", () => {
  const turns = parseSessionJsonlTurns([
    jsonl({ type: "session_meta", payload: { id: "thread-1" } }),
    jsonl({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "think visibly" }],
      },
    }),
    jsonl({ type: "response_item", payload: { type: "reasoning", id: "reasoning-empty" } }),
    jsonl({
      type: "response_item",
      payload: {
        type: "reasoning",
        id: "reasoning-visible",
        summary: [{ type: "summary_text", text: "visible thought summary" }],
      },
    }),
  ].join("\n"));

  assert.deepEqual(
    turns[0].items.map((item) => item.id),
    ["response-item-line-2", "reasoning-visible"]
  );
});

test("response-item final answers complete the active reconstructed turn", () => {
  const turns = parseSessionJsonlTurns([
    jsonl({ type: "session_meta", payload: { id: "thread-1" } }),
    jsonl({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        turn_id: "turn-live",
        content: [{ type: "input_text", text: "say done" }],
      },
    }),
    jsonl({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text: "done" }],
      },
    }),
  ].join("\n"));

  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "turn-live");
  assert.equal(turns[0].status, "completed");
  assert.equal(turns[0].items.length, 2);
});

function jsonl(entry) {
  return JSON.stringify({
    timestamp: "2026-05-14T00:00:00.000Z",
    ...entry,
  });
}
