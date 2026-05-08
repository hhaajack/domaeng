// FILE: thread-rename-rollout.js
// Purpose: Mirrors accepted remote thread renames into Codex rollout history for desktop views.
// Layer: Bridge helper
// Exports: appendThreadNameUpdatedRolloutEvent
// Depends on: fs, ./rollout-watch

const fs = require("fs");
const {
  findRecentRolloutFileForContextRead,
  resolveSessionsRoot,
} = require("./rollout-watch");

const DEFAULT_DUPLICATE_SCAN_BYTES = 64 * 1024;

function appendThreadNameUpdatedRolloutEvent({
  threadId,
  name,
  sessionsRoot = resolveSessionsRoot(),
  fsModule = fs,
  now = () => new Date(),
} = {}) {
  const normalizedThreadId = normalizeNonEmptyString(threadId);
  const normalizedName = normalizeNonEmptyString(name);
  if (!normalizedThreadId || !normalizedName) {
    return {
      appended: false,
      skippedReason: "missing_thread_rename",
    };
  }

  const rolloutPath = findRecentRolloutFileForContextRead(sessionsRoot, {
    threadId: normalizedThreadId,
    fsModule,
  });
  if (!rolloutPath) {
    return {
      appended: false,
      skippedReason: "rollout_not_found",
    };
  }

  const latestRolloutName = readLatestThreadRenameFromTail(rolloutPath, normalizedThreadId, {
    fsModule,
  });
  if (latestRolloutName === normalizedName) {
    return {
      appended: false,
      skippedReason: "already_current",
      rolloutPath,
    };
  }

  const event = {
    timestamp: toIsoTimestamp(now()),
    type: "event_msg",
    payload: {
      type: "thread_name_updated",
      thread_id: normalizedThreadId,
      thread_name: normalizedName,
    },
  };
  fsModule.appendFileSync(rolloutPath, `${JSON.stringify(event)}\n`, "utf8");

  return {
    appended: true,
    rolloutPath,
  };
}

function readLatestThreadRenameFromTail(
  rolloutPath,
  threadId,
  {
    fsModule = fs,
    scanBytes = DEFAULT_DUPLICATE_SCAN_BYTES,
  } = {}
) {
  const chunk = readFileTail(rolloutPath, { fsModule, scanBytes });
  if (!chunk) {
    return "";
  }

  const lines = chunk.split("\n").reverse();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const parsed = safeParseJSON(line);
    const payload = parsed?.type === "event_msg" ? parsed.payload : null;
    if (payload?.type !== "thread_name_updated") {
      continue;
    }

    const eventThreadId = normalizeNonEmptyString(payload.thread_id || payload.threadId);
    if (eventThreadId !== threadId) {
      continue;
    }

    return normalizeNonEmptyString(payload.thread_name || payload.threadName || payload.name || payload.title);
  }

  return "";
}

function readFileTail(filePath, { fsModule = fs, scanBytes = DEFAULT_DUPLICATE_SCAN_BYTES } = {}) {
  const stat = fsModule.statSync(filePath);
  if (!stat.size) {
    return "";
  }

  const bytesToRead = Math.min(stat.size, scanBytes);
  const buffer = Buffer.alloc(bytesToRead);
  const fd = fsModule.openSync(filePath, "r");
  try {
    fsModule.readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead);
  } finally {
    fsModule.closeSync(fd);
  }
  return buffer.toString("utf8");
}

function toIsoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

module.exports = {
  appendThreadNameUpdatedRolloutEvent,
  __test: {
    readLatestThreadRenameFromTail,
  },
};
