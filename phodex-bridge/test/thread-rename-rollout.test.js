// FILE: thread-rename-rollout.test.js
// Purpose: Verifies remote thread renames are mirrored into Codex rollout history.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/thread-rename-rollout

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  appendThreadNameUpdatedRolloutEvent,
} = require("../src/thread-rename-rollout");

test("appendThreadNameUpdatedRolloutEvent appends a desktop-visible rename event", (t) => {
  const { homeDir, sessionsRoot, rolloutPath } = makeTemporarySessionsHome(t, "thread-a", [
    eventLine({
      timestamp: "2026-05-08T00:00:00.000Z",
      type: "session_meta",
      payload: { id: "thread-a" },
    }),
  ]);

  const result = appendThreadNameUpdatedRolloutEvent({
    threadId: " thread-a ",
    name: "  Error debug  ",
    sessionsRoot,
    now: () => new Date("2026-05-08T01:02:03.004Z"),
  });

  assert.deepEqual(result, {
    appended: true,
    rolloutPath,
  });

  const lastLine = readLastJSONLine(rolloutPath);
  assert.deepEqual(lastLine, {
    timestamp: "2026-05-08T01:02:03.004Z",
    type: "event_msg",
    payload: {
      type: "thread_name_updated",
      thread_id: "thread-a",
      thread_name: "Error debug",
    },
  });

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test("appendThreadNameUpdatedRolloutEvent skips an already-current rollout rename", (t) => {
  const { homeDir, sessionsRoot, rolloutPath } = makeTemporarySessionsHome(t, "thread-current", [
    threadRenameLine("thread-current", "Error debug"),
  ]);

  const result = appendThreadNameUpdatedRolloutEvent({
    threadId: "thread-current",
    name: "Error debug",
    sessionsRoot,
    now: () => new Date("2026-05-08T01:02:03.004Z"),
  });

  assert.deepEqual(result, {
    appended: false,
    skippedReason: "already_current",
    rolloutPath,
  });
  assert.equal(readNonEmptyLines(rolloutPath).length, 1);

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test("appendThreadNameUpdatedRolloutEvent appends when rollout history has a stale name", (t) => {
  const { homeDir, sessionsRoot, rolloutPath } = makeTemporarySessionsHome(t, "thread-stale", [
    threadRenameLine("thread-stale", "Pairing & Error debug"),
  ]);

  const result = appendThreadNameUpdatedRolloutEvent({
    threadId: "thread-stale",
    name: "Error debug",
    sessionsRoot,
    now: () => new Date("2026-05-08T01:02:03.004Z"),
  });

  assert.equal(result.appended, true);
  assert.equal(readNonEmptyLines(rolloutPath).length, 2);
  assert.equal(readLastJSONLine(rolloutPath).payload.thread_name, "Error debug");

  fs.rmSync(homeDir, { recursive: true, force: true });
});

function makeTemporarySessionsHome(t, threadId, lines) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-rename-rollout-"));
  const sessionsRoot = path.join(homeDir, "sessions");
  const threadDir = path.join(sessionsRoot, "2026", "05", "08");
  fs.mkdirSync(threadDir, { recursive: true });
  const rolloutPath = path.join(threadDir, `rollout-2026-05-08T00-00-00-${threadId}.jsonl`);
  fs.writeFileSync(rolloutPath, `${lines.join("\n")}\n`, "utf8");
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  return { homeDir, sessionsRoot, rolloutPath };
}

function threadRenameLine(threadId, name) {
  return eventLine({
    timestamp: "2026-05-08T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "thread_name_updated",
      thread_id: threadId,
      thread_name: name,
    },
  });
}

function eventLine(value) {
  return JSON.stringify(value);
}

function readLastJSONLine(filePath) {
  const lines = readNonEmptyLines(filePath);
  return JSON.parse(lines[lines.length - 1]);
}

function readNonEmptyLines(filePath) {
  return fs.readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean);
}
