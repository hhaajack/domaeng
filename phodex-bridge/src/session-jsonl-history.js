// FILE: session-jsonl-history.js
// Purpose: Reconstructs a small thread/turns/list page from local Codex session JSONL files.

const fs = require("fs");

function readThreadTurnsListPageFromSessionJsonl(filePath, {
  threadId = "",
  limit = 5,
  maxLimit = 5,
  cursor = null,
  fsModule = fs,
} = {}) {
  if (!filePath || cursor != null) {
    return null;
  }

  const content = fsModule.readFileSync(filePath, "utf8");
  const turns = parseSessionJsonlTurns(content, { threadId });
  if (turns.length === 0) {
    return null;
  }

  const requestedLimit = Number.isInteger(limit) && limit > 0 ? limit : 5;
  const requestedMaxLimit = Number.isInteger(maxLimit) && maxLimit > 0 ? maxLimit : 5;
  const safeLimit = Math.min(requestedLimit, requestedMaxLimit, 5);
  const pageTurns = turns.slice(-safeLimit).reverse();
  return {
    data: pageTurns,
    nextCursor: turns.length > pageTurns.length ? "remodex-jsonl-fallback-older-unavailable" : null,
    remodexJsonlFallback: true,
  };
}

function parseSessionJsonlTurns(content, { threadId = "" } = {}) {
  const turns = [];
  const turnsById = new Map();
  let activeTurnId = "";
  let sessionThreadId = normalizeString(threadId);

  const lines = String(content || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry?.type === "session_meta") {
      const payload = objectValue(entry.payload);
      sessionThreadId ||= normalizeString(payload?.id)
        || normalizeString(payload?.thread_id)
        || normalizeString(payload?.threadId);
      continue;
    }

    if (entry?.type === "event_msg") {
      const payload = objectValue(entry.payload);
      const eventType = normalizeString(payload?.type);
      if (eventType === "task_started") {
        activeTurnId = normalizeString(payload?.turn_id)
          || normalizeString(payload?.turnId)
          || activeTurnId
          || `turn-line-${index + 1}`;
        ensureTurn(turns, turnsById, activeTurnId, sessionThreadId, entry.timestamp);
        continue;
      }

      if (eventType === "task_complete") {
        const turn = ensureTurn(
          turns,
          turnsById,
          normalizeString(payload?.turn_id) || normalizeString(payload?.turnId) || activeTurnId || `turn-line-${index + 1}`,
          sessionThreadId,
          entry.timestamp
        );
        turn.status = "completed";
        continue;
      }

      if (eventType === "user_message") {
        activeTurnId = normalizeString(payload?.turn_id)
          || normalizeString(payload?.turnId)
          || activeTurnId
          || `turn-line-${index + 1}`;
        const turn = ensureTurn(turns, turnsById, activeTurnId, sessionThreadId, entry.timestamp);
        turn.items.push({
          id: normalizeString(payload?.id) || `user-message-line-${index + 1}`,
          type: "user_message",
          role: "user",
          text: normalizeString(payload?.message) || normalizeString(payload?.text),
        });
        continue;
      }

      if (eventType === "agent_message" && isTerminalAssistantPhase(payload?.phase) && activeTurnId) {
        const turn = ensureTurn(turns, turnsById, activeTurnId, sessionThreadId, entry.timestamp);
        turn.status = "completed";
        activeTurnId = "";
      }

      // The final assistant text is usually present again as a response_item message.
      // Skipping event agent_message avoids double-rendering streaming/final chunks.
      continue;
    }

    if (entry?.type === "response_item") {
      const payload = objectValue(entry.payload);
      if (!payload) {
        continue;
      }
      const explicitTurnId = normalizeString(payload.turn_id) || normalizeString(payload.turnId);
      if (isResponseUserMessage(payload)) {
        activeTurnId = explicitTurnId || activeTurnId || `turn-line-${index + 1}`;
      } else if (!activeTurnId && isResponseActiveItem(payload)) {
        activeTurnId = explicitTurnId || `turn-line-${index + 1}`;
      }
      const turn = ensureTurn(
        turns,
        turnsById,
        explicitTurnId || activeTurnId || `turn-line-${index + 1}`,
        sessionThreadId,
        entry.timestamp
      );
      const item = normalizeResponseItemForHistory(payload, index + 1);
      if (item) {
        turn.items.push(item);
      }
      if (isResponseTerminalAssistantMessage(payload)) {
        turn.status = "completed";
        activeTurnId = "";
      }
    }
  }

  return turns.filter((turn) => turn.items.length > 0);
}

function ensureTurn(turns, turnsById, turnId, threadId, timestamp) {
  const normalizedTurnId = normalizeString(turnId) || `turn-${turns.length + 1}`;
  let turn = turnsById.get(normalizedTurnId);
  if (!turn) {
    turn = {
      id: normalizedTurnId,
      threadId: normalizeString(threadId) || undefined,
      createdAt: normalizeString(timestamp) || undefined,
      status: "running",
      items: [],
    };
    turnsById.set(normalizedTurnId, turn);
    turns.push(turn);
  }
  if (!turn.createdAt && timestamp) {
    turn.createdAt = normalizeString(timestamp);
  }
  return turn;
}

function normalizeResponseItemForHistory(payload, lineNumber) {
  const type = normalizeHistoryItemType(payload.type);
  if (!type) {
    return null;
  }
  if (type === "reasoning" && !readHistoryItemText(payload)) {
    return null;
  }

  const item = {
    ...payload,
    id: normalizeString(payload.id)
      || normalizeString(payload.item_id)
      || normalizeString(payload.itemId)
      || `response-item-line-${lineNumber}`,
    type,
  };

  if (type === "message" && !normalizeString(item.role)) {
    item.role = "assistant";
  }

  return item;
}

function normalizeHistoryItemType(rawType) {
  const normalized = normalizeString(rawType).toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) {
    return "";
  }
  if (normalized === "functioncall") {
    return "tool_call";
  }
  if (normalized === "functioncalloutput") {
    return "tool_call_output";
  }
  return rawType;
}

function readHistoryItemText(item) {
  const object = objectValue(item);
  if (!object) {
    return normalizeString(item);
  }

  for (const key of ["content", "output", "summary"]) {
    if (Array.isArray(object[key])) {
      const text = object[key]
        .map((part) => readHistoryItemText(part))
        .filter(Boolean)
        .join("\n");
      if (text) {
        return text;
      }
    }
  }

  return normalizeString(object.text)
    || normalizeString(object.content)
    || normalizeString(object.summary)
    || normalizeString(object.message)
    || normalizeString(object.result)
    || "";
}

function isResponseUserMessage(payload) {
  return normalizeHistoryItemType(payload?.type) === "message"
    && normalizeString(payload?.role).toLowerCase() === "user";
}

function isResponseActiveItem(payload) {
  const type = normalizeHistoryItemType(payload?.type);
  if (type === "message") {
    return normalizeString(payload?.role).toLowerCase() === "assistant";
  }
  return type === "reasoning"
    || type === "tool_call"
    || type === "function_call_output"
    || type === "image_generation"
    || type === "image_generation_call";
}

function isResponseTerminalAssistantMessage(payload) {
  if (normalizeHistoryItemType(payload?.type) !== "message") {
    return false;
  }
  if (normalizeString(payload?.role).toLowerCase() !== "assistant") {
    return false;
  }
  const phase = normalizeString(payload?.phase);
  return !phase || isTerminalAssistantPhase(phase);
}

function isTerminalAssistantPhase(phase) {
  const normalized = normalizeString(phase).replace(/[_-]/g, "").toLowerCase();
  return normalized === "final" || normalized === "finalanswer";
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  parseSessionJsonlTurns,
  readThreadTurnsListPageFromSessionJsonl,
};
