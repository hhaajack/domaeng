import type {
  CodexThread,
  ImageAttachment,
  JSONObject,
  JSONValue,
  TimelineMessage
} from "../types";
import { randomUUID } from "./base64";

export interface TimelineState {
  threads: CodexThread[];
  messagesByThread: Record<string, TimelineMessage[]>;
  runningTurnByThread: Record<string, string | undefined>;
}

export function applyNotification(
  state: TimelineState,
  method: string,
  params: JSONValue | undefined
): TimelineState {
  const object = asObject(params);
  switch (method) {
    case "thread/started":
      return upsertThreadFromPayload(state, object);
    case "thread/name/updated":
      return renameThread(state, object);
    case "turn/started":
      return markTurnStarted(state, object);
    case "turn/completed":
    case "turn/failed":
      return markTurnCompleted(state, object);
    case "item/agentMessage/delta":
    case "codex/event/agent_message_content_delta":
    case "codex/event/agent_message_delta":
      return appendStreamingText(state, object, "assistant", "chat", readDeltaText(object));
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
      return appendStreamingText(state, object, "reasoning", "reasoning", readDeltaText(object));
    case "item/toolCall/outputDelta":
    case "item/toolCall/output_delta":
    case "item/tool_call/outputDelta":
    case "item/tool_call/output_delta":
      return appendStreamingText(state, object, "tool", "tool", readDeltaText(object));
    case "item/commandExecution/outputDelta":
    case "item/command_execution/outputDelta":
      return appendStreamingText(state, object, "tool", "command", readDeltaText(object));
    case "item/fileChange/outputDelta":
      return appendStreamingText(state, object, "tool", "fileChange", readDeltaText(object));
    case "turn/plan/updated":
    case "item/plan/delta":
      return appendStreamingText(state, object, "plan", "plan", readDeltaText(object) || readPlanText(object));
    case "turn/diff/updated":
    case "codex/event/turn_diff_updated":
    case "codex/event/turn_diff":
      return appendStreamingText(state, object, "tool", "diff", readDeltaText(object) || readString(object.diff) || "");
    case "item/completed":
    case "codex/event/item_completed":
    case "codex/event/agent_message":
      return appendCompletedItem(state, object);
    case "codex/event/user_message":
      return appendMirroredUserMessage(state, object);
    case "codex/event/image_generation_end":
    case "image_generation_end":
      return appendGeneratedImage(state, object);
    case "error":
    case "codex/event/error":
      return appendSystemMessage(state, resolveThreadId(object) ?? "local", readString(object.message) || "Runtime error", "error");
    default:
      if (method.startsWith("codex/event/")) {
        return appendLegacyEvent(state, method, object);
      }
      return state;
  }
}

export function decodeThreadRead(state: TimelineState, result: JSONValue | undefined): TimelineState {
  const threadObject = asObject(asObject(result).thread ?? result);
  const thread = decodeThread(threadObject);
  if (!thread?.id) {
    return state;
  }
  const messages: TimelineMessage[] = [];
  const turns = asArray(threadObject.turns) ?? [];
  for (const turnValue of turns) {
    const turn = asObject(turnValue);
    const turnId = readString(turn.id) ?? readString(turn.turnId) ?? readString(turn.turn_id);
    const items = asArray(turn.items) ?? [];
    for (const itemValue of items) {
      const item = asObject(itemValue);
      const text = readItemText(item);
      const itemType = readString(item.type)?.toLowerCase() ?? "";
      const itemId = readString(item.id);
      const timestamp = decodeTimestamp(item.createdAt ?? item.timestamp ?? turn.createdAt ?? turn.timestamp);
      if (itemType.includes("user") || readString(item.role) === "user") {
        messages.push(message({
          role: "user",
          kind: "chat",
          threadId: thread.id,
          turnId,
          itemId,
          text,
          attachments: decodeImageAttachments(item),
          createdAt: timestamp
        }));
      } else if (isGeneratedImageItem(item)) {
        messages.push(message({
          role: "assistant",
          kind: "image",
          threadId: thread.id,
          turnId,
          itemId,
          text: generatedImageMarkdown(item),
          createdAt: timestamp
        }));
      } else if (itemType.includes("reasoning")) {
        messages.push(message({ role: "reasoning", kind: "reasoning", threadId: thread.id, turnId, itemId, text, createdAt: timestamp }));
      } else if (text) {
        messages.push(message({ role: "assistant", kind: "chat", threadId: thread.id, turnId, itemId, text, createdAt: timestamp }));
      }
    }
  }
  const runningTurnId = runningTurnIdFromThreadObject(threadObject, turns);
  const runningTurnByThread = { ...state.runningTurnByThread };
  if (runningTurnId) {
    runningTurnByThread[thread.id] = runningTurnId;
  } else {
    delete runningTurnByThread[thread.id];
  }

  return {
    ...state,
    threads: sortThreads(upsertThread(state.threads, thread)),
    messagesByThread: {
      ...state.messagesByThread,
      [thread.id]: mergePendingLocalUserMessages(state.messagesByThread[thread.id] ?? [], messages)
    },
    runningTurnByThread
  };
}

export function appendLocalUserMessage(
  state: TimelineState,
  threadId: string,
  text: string,
  attachments: ImageAttachment[]
): TimelineState {
  return appendMessage(state, message({
    role: "user",
    kind: "chat",
    threadId,
    text,
    attachments,
    createdAt: Date.now(),
    metadata: {
      remodexLocalPending: true
    }
  }));
}

function upsertThreadFromPayload(state: TimelineState, object: JSONObject): TimelineState {
  const thread = decodeThread(asObject(object.thread));
  if (!thread) {
    return state;
  }
  return {
    ...state,
    threads: sortThreads(upsertThread(state.threads, thread))
  };
}

function renameThread(state: TimelineState, object: JSONObject): TimelineState {
  const threadId = resolveThreadId(object);
  const title = readString(object.name) || readString(object.title) || readString(object.threadName);
  if (!threadId || !title) {
    return state;
  }
  return {
    ...state,
    threads: state.threads.map((thread) => thread.id === threadId ? { ...thread, title, name: title } : thread)
  };
}

function markTurnStarted(state: TimelineState, object: JSONObject): TimelineState {
  const threadId = resolveThreadId(object);
  const turnId = resolveTurnId(object);
  if (!threadId) {
    return state;
  }
  return {
    ...state,
    runningTurnByThread: {
      ...state.runningTurnByThread,
      [threadId]: turnId || state.runningTurnByThread[threadId] || "__running__"
    }
  };
}

function markTurnCompleted(state: TimelineState, object: JSONObject): TimelineState {
  const threadId = resolveThreadId(object);
  if (!threadId) {
    return state;
  }
  const next = { ...state.runningTurnByThread };
  delete next[threadId];
  return {
    ...state,
    runningTurnByThread: next,
    messagesByThread: {
      ...state.messagesByThread,
      [threadId]: finalizeMessagesForCompletedTurn(state.messagesByThread[threadId] ?? [], resolveTurnId(object))
    }
  };
}

function appendCompletedItem(state: TimelineState, object: JSONObject): TimelineState {
  const item = incomingItemObject(object);
  if (item && isGeneratedImageItem(item)) {
    return appendGeneratedImage(state, { ...object, ...item });
  }
  const text = item
    ? readItemText(item)
    : readString(object.message) || readString(asObject(object.event).message) || "";
  if (!text) {
    return state;
  }
  const role = inferCompletedItemRole(item);
  if (!role) {
    return state;
  }
  const threadId = resolveThreadId(object) ?? (item ? resolveThreadIdFromItem(item) : undefined) ?? "local";
  const turnId = resolveTurnId(object) ?? (item ? resolveTurnIdFromItem(item) : undefined);
  const next = reconcileOrAppendMessage(state, message({
    role,
    kind: role === "reasoning" ? "reasoning" : "chat",
    threadId,
    turnId,
    itemId: resolveItemId(object, item),
    text,
    createdAt: Date.now()
  }));
  if (role !== "assistant") {
    return next;
  }
  return markTurnCompleted(next, turnId ? { threadId, turnId } : { threadId });
}

function appendMirroredUserMessage(state: TimelineState, object: JSONObject): TimelineState {
  const text = readString(object.message)
    || readString(object.text)
    || readString(asObject(object.event).message)
    || readString(asObject(object.event).text)
    || "";
  const threadId = resolveThreadId(object);
  if (!threadId || !text) {
    return state;
  }
  return reconcileOrAppendMessage(state, message({
    role: "user",
    kind: "chat",
    threadId,
    turnId: resolveTurnId(object),
    itemId: resolveItemId(object, incomingItemObject(object)),
    text,
    createdAt: Date.now()
  }));
}

function appendGeneratedImage(state: TimelineState, object: JSONObject): TimelineState {
  const threadId = resolveThreadId(object);
  if (!threadId) {
    return state;
  }
  return appendMessage(state, message({
    role: "assistant",
    kind: "image",
    threadId,
    turnId: resolveTurnId(object),
    itemId: readString(object.itemId) || readString(object.call_id) || readString(object.callId) || readString(object.id),
    text: generatedImageMarkdown(object),
    createdAt: Date.now()
  }));
}

function appendLegacyEvent(state: TimelineState, method: string, object: JSONObject): TimelineState {
  const event = asObject(object.event) || object;
  const eventType = readString(event.type) ?? method;
  if (eventType.includes("image_generation")) {
    return appendGeneratedImage(state, { ...object, ...event });
  }
  const text = readItemText(event) || readString(event.message) || "";
  if (!text) {
    return state;
  }
  return appendStreamingText(state, { ...object, ...event }, "tool", "tool", text);
}

function appendStreamingText(
  state: TimelineState,
  object: JSONObject,
  role: TimelineMessage["role"],
  kind: TimelineMessage["kind"],
  text: string
): TimelineState {
  const threadId = resolveThreadId(object);
  if (!threadId || !text) {
    return state;
  }
  const turnId = resolveTurnId(object);
  const itemId = resolveItemId(object, incomingItemObject(object)) || `${kind}-${turnId ?? "open"}`;
  const existing = state.messagesByThread[threadId] ?? [];
  const index = existing.findIndex((entry) => entry.itemId === itemId && entry.kind === kind && entry.streaming);
  const nextMessage = index >= 0
    ? { ...existing[index], text: existing[index].text + text }
    : message({ role, kind, threadId, turnId, itemId, text, createdAt: Date.now(), streaming: true });
  const nextMessages = index >= 0
    ? existing.map((entry, entryIndex) => entryIndex === index ? nextMessage : entry)
    : [...existing, nextMessage];
  return {
    ...state,
    messagesByThread: {
      ...state.messagesByThread,
      [threadId]: nextMessages
    },
    runningTurnByThread: markThreadRunning(state.runningTurnByThread, threadId, turnId)
  };
}

function markThreadRunning(
  runningTurnByThread: Record<string, string | undefined>,
  threadId: string,
  turnId: string | undefined
): Record<string, string | undefined> {
  const nextTurnId = turnId || runningTurnByThread[threadId] || "__running__";
  if (runningTurnByThread[threadId] === nextTurnId) {
    return runningTurnByThread;
  }
  return {
    ...runningTurnByThread,
    [threadId]: nextTurnId
  };
}

function finalizeMessagesForCompletedTurn(messages: TimelineMessage[], turnId: string | undefined): TimelineMessage[] {
  return messages
    .filter((entry) => !isPlaceholderThinkingForCompletedTurn(entry, turnId))
    .map((entry) => ({ ...entry, streaming: false }));
}

function isPlaceholderThinkingForCompletedTurn(entry: TimelineMessage, turnId: string | undefined): boolean {
  if (entry.role !== "reasoning" || entry.kind !== "reasoning" || entry.streaming !== true) {
    return false;
  }
  if (turnId && entry.turnId && entry.turnId !== turnId) {
    return false;
  }
  return normalizeMessageText(entry.text).replace(/[^a-z0-9]/gi, "").toLowerCase() === "thinking";
}

function appendSystemMessage(
  state: TimelineState,
  threadId: string,
  text: string,
  kind: TimelineMessage["kind"] = "chat"
): TimelineState {
  return appendMessage(state, message({
    role: "system",
    kind,
    threadId,
    text,
    createdAt: Date.now()
  }));
}

function appendMessage(state: TimelineState, nextMessage: TimelineMessage): TimelineState {
  const existing = state.messagesByThread[nextMessage.threadId] ?? [];
  const dedupeKey = `${nextMessage.role}:${nextMessage.kind}:${nextMessage.turnId ?? ""}:${nextMessage.itemId ?? ""}:${nextMessage.text}`;
  if (existing.some((entry) => `${entry.role}:${entry.kind}:${entry.turnId ?? ""}:${entry.itemId ?? ""}:${entry.text}` === dedupeKey)) {
    return state;
  }
  return {
    ...state,
    messagesByThread: {
      ...state.messagesByThread,
      [nextMessage.threadId]: [...existing, nextMessage]
    }
  };
}

function reconcileOrAppendMessage(state: TimelineState, nextMessage: TimelineMessage): TimelineState {
  const existing = state.messagesByThread[nextMessage.threadId] ?? [];
  const index = findReconcileIndex(existing, nextMessage);
  if (index < 0) {
    return appendMessage(state, nextMessage);
  }
  const nextMessages = existing.map((entry, entryIndex) => {
    if (entryIndex !== index) {
      return entry;
    }
    return {
      ...entry,
      text: nextMessage.text,
      turnId: entry.turnId ?? nextMessage.turnId,
      itemId: shouldReplaceItemId(entry, nextMessage.itemId) ? nextMessage.itemId : entry.itemId,
      streaming: false,
      attachments: entry.attachments ?? nextMessage.attachments
    };
  });
  return {
    ...state,
    messagesByThread: {
      ...state.messagesByThread,
      [nextMessage.threadId]: nextMessages
    }
  };
}

function findReconcileIndex(existing: TimelineMessage[], nextMessage: TimelineMessage): number {
  if (nextMessage.itemId) {
    const itemIndex = findLastIndex(existing, (entry) =>
      entry.itemId === nextMessage.itemId
      && entry.role === nextMessage.role
      && entry.kind === nextMessage.kind
    );
    if (itemIndex >= 0) {
      return itemIndex;
    }
  }

  if (nextMessage.role === "user") {
    const userIndex = findLastIndex(existing, (entry) =>
      entry.role === "user"
      && entry.kind === nextMessage.kind
      && normalizeMessageText(entry.text) === normalizeMessageText(nextMessage.text)
      && (!entry.turnId || !nextMessage.turnId || entry.turnId === nextMessage.turnId)
    );
    if (userIndex >= 0) {
      return userIndex;
    }
  }

  if (nextMessage.turnId) {
    const turnIndex = findLastIndex(existing, (entry) =>
      entry.role === nextMessage.role
      && entry.kind === nextMessage.kind
      && entry.turnId === nextMessage.turnId
      && (
        entry.streaming
        || normalizeMessageText(entry.text) === normalizeMessageText(nextMessage.text)
        || Boolean(nextMessage.itemId && !entry.itemId)
      )
    );
    if (turnIndex >= 0) {
      return turnIndex;
    }
  }

  if (nextMessage.role === "assistant" || nextMessage.role === "reasoning") {
    const streamingIndex = findLastIndex(existing, (entry) =>
      entry.role === nextMessage.role
      && entry.kind === nextMessage.kind
      && entry.streaming === true
      && textsOverlap(entry.text, nextMessage.text)
    );
    if (streamingIndex >= 0) {
      return streamingIndex;
    }
  }

  return findLastIndex(existing, (entry) =>
    entry.role === nextMessage.role
    && entry.kind === nextMessage.kind
    && normalizeMessageText(entry.text) === normalizeMessageText(nextMessage.text)
    && (!entry.turnId || !nextMessage.turnId || entry.turnId === nextMessage.turnId)
  );
}

function message(input: Omit<TimelineMessage, "id"> & { id?: string }): TimelineMessage {
  return {
    id: input.id ?? randomUUID(),
    ...input
  };
}

function decodeThread(object: JSONObject): CodexThread | null {
  const id = readString(object.id) || readString(object.threadId) || readString(object.thread_id);
  if (!id) {
    return null;
  }
  return {
    id,
    title: readString(object.title),
    name: readString(object.name),
    cwd: readString(object.cwd) || readString(object.current_working_directory) || readString(object.workingDirectory) || readString(object.working_directory),
    status: readString(object.status),
    updatedAt: readString(object.updatedAt) ?? readString(object.updated_at) ?? readNumber(object.updatedAt),
    createdAt: readString(object.createdAt) ?? readString(object.created_at) ?? readNumber(object.createdAt),
    archived: object.archived === true,
    sourceKind: readString(object.sourceKind) || readString(object.source_kind)
  };
}

function runningTurnIdFromThreadObject(threadObject: JSONObject, turns: JSONValue[]): string | undefined {
  const explicitTurnId = runningTurnIdFromTurns(turns);
  if (explicitTurnId) {
    return explicitTurnId;
  }
  return isRunningStatusObject(threadObject) ? latestTurnIdFromTurns(turns) ?? "__running__" : undefined;
}

function runningTurnIdFromTurns(turns: JSONValue[]): string | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asObject(turns[index]);
    const turnId = readString(turn.id) || readString(turn.turnId) || readString(turn.turn_id);
    if (turnId && isRunningTurn(turn)) {
      return turnId;
    }
  }
  return undefined;
}

function latestTurnIdFromTurns(turns: JSONValue[]): string | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asObject(turns[index]);
    const turnId = readString(turn.id) || readString(turn.turnId) || readString(turn.turn_id);
    if (turnId) {
      return turnId;
    }
  }
  return undefined;
}

function isRunningTurn(turn: JSONObject): boolean {
  return isRunningStatusObject(turn);
}

function isRunningStatusObject(object: JSONObject): boolean {
  const directStatus = readStatusToken(object.status)
    || readStatusToken(object.turnStatus)
    || readStatusToken(object.turn_status)
    || readStatusToken(object.state)
    || readStatusToken(object.phase);
  if (directStatus) {
    return isRunningStatusToken(directStatus);
  }

  const statusObject = asObject(object.status);
  const objectStatus = readStatusToken(statusObject.type)
    || readStatusToken(statusObject.statusType)
    || readStatusToken(statusObject.status_type)
    || readStatusToken(statusObject.state)
    || readStatusToken(statusObject.phase);
  return objectStatus ? isRunningStatusToken(objectStatus) : false;
}

function readStatusToken(value: JSONValue | undefined): string | undefined {
  const stringValue = readString(value);
  return stringValue ? stringValue.replace(/[^a-z0-9]/gi, "").toLowerCase() : undefined;
}

function isRunningStatusToken(value: string): boolean {
  return ["active", "running", "processing", "inprogress", "started", "pending"].includes(value);
}

function upsertThread(threads: CodexThread[], next: CodexThread): CodexThread[] {
  const index = threads.findIndex((thread) => thread.id === next.id);
  if (index < 0) {
    return [...threads, next];
  }
  return threads.map((thread, threadIndex) => threadIndex === index ? mergeThread(thread, next) : thread);
}

function mergeThread(existing: CodexThread, next: CodexThread): CodexThread {
  return Object.fromEntries(
    Object.entries({ ...existing, ...next }).map(([key, value]) => [
      key,
      value === undefined ? existing[key as keyof CodexThread] : value
    ])
  ) as unknown as CodexThread;
}

function sortThreads(threads: CodexThread[]): CodexThread[] {
  return [...threads].sort((a, b) => decodeTimestamp(b.updatedAt ?? b.createdAt) - decodeTimestamp(a.updatedAt ?? a.createdAt));
}

function readDeltaText(object: JSONObject): string {
  return readString(object.delta)
    || readString(object.text)
    || readString(object.output)
    || readString(object.content)
    || readString(asObject(object.event).delta)
    || readString(asObject(object.event).text)
    || "";
}

function readPlanText(object: JSONObject): string {
  const steps = asArray(object.steps);
  if (!steps) {
    return "";
  }
  return steps.map((step) => {
    const item = asObject(step);
    return `${readString(item.status) || "pending"}: ${readString(item.step) || ""}`.trim();
  }).join("\n");
}

function readItemText(item: JSONObject): string {
  const content = asArray(item.content);
  if (content) {
    return content.map((part) => readItemText(asObject(part)) || readString(part)).filter(Boolean).join("\n");
  }
  const output = asArray(item.output);
  if (output) {
    return output.map((part) => readItemText(asObject(part)) || readString(part)).filter(Boolean).join("\n");
  }
  return readString(item.text)
    || readString(item.content)
    || readString(item.message)
    || readString(item.result)
    || "";
}

function decodeImageAttachments(item: JSONObject): ImageAttachment[] {
  const content = asArray(item.content) ?? [];
  return content.flatMap((value) => {
    const object = asObject(value);
    const url = imageURLFromHistoryContent(object);
    if (!url) {
      return [];
    }
    return [{
      id: randomUUID(),
      thumbnailBase64JPEG: url.startsWith("data:image") ? url.split(",", 2)[1] ?? "" : "",
      payloadDataURL: url.startsWith("data:image") ? url : undefined,
      sourceURL: url.startsWith("data:image") ? undefined : url
    }];
  });
}

function imageURLFromHistoryContent(object: JSONObject): string | undefined {
  const direct = readString(object.url)
    || readString(object.image_url)
    || readString(object.imageUrl)
    || readString(object.sourceURL)
    || readString(object.source_url)
    || readString(object.path);
  if (direct?.startsWith("data:image") || direct === "remodex://history-image-elided") {
    return direct;
  }

  for (const key of ["image_url", "imageUrl", "source", "image"]) {
    const nested = imageURLFromNestedValue(object[key]);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function imageURLFromNestedValue(value: JSONValue | undefined): string | undefined {
  const direct = readString(value);
  if (direct?.startsWith("data:image") || direct === "remodex://history-image-elided") {
    return direct;
  }
  const object = objectOrUndefined(value);
  if (!object) {
    return undefined;
  }
  return imageURLFromHistoryContent(object);
}

function incomingItemObject(object: JSONObject): JSONObject | undefined {
  const event = objectOrUndefined(object.event);
  return objectOrUndefined(object.item)
    ?? objectOrUndefined(event?.item)
    ?? objectOrUndefined(asObject(object.event).item)
    ?? (isLikelyIncomingItemPayload(object) ? object : undefined)
    ?? (event && isLikelyIncomingItemPayload(event) ? event : undefined);
}

function isLikelyIncomingItemPayload(object: JSONObject): boolean {
  return Boolean(
    readString(object.type)
    || readString(object.role)
    || asArray(object.content)
    || asArray(object.output)
  );
}

function inferCompletedItemRole(item: JSONObject | undefined): TimelineMessage["role"] | null {
  if (!item) {
    return "assistant";
  }
  const role = normalizeIdentifier(readString(item.role));
  const type = normalizeIdentifier(readString(item.type));
  if (role.includes("user") || type.includes("usermessage")) {
    return "user";
  }
  if (type.includes("reasoning")) {
    return "reasoning";
  }
  if (role.includes("assistant") || role.includes("agent") || role.includes("codex")) {
    return "assistant";
  }
  if (type === "message" || type.includes("agentmessage") || type.includes("assistantmessage")) {
    return "assistant";
  }
  return null;
}

function isGeneratedImageItem(item: JSONObject): boolean {
  const type = readString(item.type)?.toLowerCase().replaceAll("_", "") ?? "";
  return type.includes("imagegeneration") || type === "imageview" || Boolean(generatedImagePath(item));
}

function generatedImageMarkdown(item: JSONObject): string {
  const path = generatedImagePath(item);
  return path ? `![Generated image](${markdownImagePath(path)})` : "Generated image";
}

function generatedImagePath(item: JSONObject): string | undefined {
  return readString(item.saved_path)
    || readString(item.savedPath)
    || readString(item.file_path)
    || readString(item.path);
}

function markdownImagePath(value: string): string {
  if (value.includes(" ") || value.includes(")") || value.includes("%")) {
    return `<${value.replaceAll("%", "%25").replaceAll(">", "%3E").replaceAll(")", "%29")}>`;
  }
  return value;
}

function resolveThreadId(object: JSONObject): string | undefined {
  return readString(object.threadId)
    || readString(object.thread_id)
    || readString(asObject(object.thread).id)
    || readString(asObject(object.event).threadId)
    || readString(asObject(object.event).thread_id);
}

function resolveTurnId(object: JSONObject): string | undefined {
  return readString(object.turnId)
    || readString(object.turn_id)
    || readString(object.id)
    || readString(asObject(object.event).turnId)
    || readString(asObject(object.event).turn_id);
}

function resolveThreadIdFromItem(item: JSONObject): string | undefined {
  return readString(item.threadId)
    || readString(item.thread_id)
    || readString(asObject(item.thread).id);
}

function resolveTurnIdFromItem(item: JSONObject): string | undefined {
  return readString(item.turnId)
    || readString(item.turn_id)
    || readString(asObject(item.turn).id);
}

function resolveItemId(object: JSONObject, item?: JSONObject): string | undefined {
  const event = asObject(object.event);
  return readString(object.itemId)
    || readString(object.item_id)
    || readString(event.itemId)
    || readString(event.item_id)
    || readString(item?.id)
    || readString(item?.itemId)
    || readString(item?.item_id);
}

function asObject(value: JSONValue | undefined): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONObject : {};
}

function objectOrUndefined(value: JSONValue | undefined): JSONObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONObject : undefined;
}

function asArray(value: JSONValue | undefined): JSONValue[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readString(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: JSONValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function decodeTimestamp(value: JSONValue | undefined): number {
  if (typeof value === "number") {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeIdentifier(value: string | undefined): string {
  return (value ?? "").replaceAll("_", "").replaceAll("-", "").toLowerCase();
}

function normalizeMessageText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function textsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeMessageText(left);
  const normalizedRight = normalizeMessageText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(normalizedRight)
    || normalizedRight.startsWith(normalizedLeft);
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) {
      return index;
    }
  }
  return -1;
}

function shouldReplaceItemId(entry: TimelineMessage, nextItemId: string | undefined): boolean {
  if (!nextItemId) {
    return false;
  }
  if (!entry.itemId) {
    return true;
  }
  return entry.itemId === `${entry.kind}-${entry.turnId ?? "open"}`;
}

function mergePendingLocalUserMessages(
  existing: TimelineMessage[],
  decoded: TimelineMessage[]
): TimelineMessage[] {
  const pending = existing.filter(isPendingLocalUserMessage);
  if (pending.length === 0) {
    return decoded;
  }

  const preserved = pending.filter((entry) => {
    return !decoded.some((candidate) => decodedUserMessageRepresentsLocal(candidate, entry));
  });
  if (preserved.length === 0) {
    return decoded;
  }

  return [...decoded, ...preserved].sort((left, right) => left.createdAt - right.createdAt);
}

function isPendingLocalUserMessage(message: TimelineMessage): boolean {
  return message.role === "user"
    && message.kind === "chat"
    && !message.turnId
    && !message.itemId
    && asObject(message.metadata).remodexLocalPending === true;
}

function decodedUserMessageRepresentsLocal(
  decoded: TimelineMessage,
  local: TimelineMessage
): boolean {
  return decoded.role === "user"
    && decoded.kind === local.kind
    && normalizeMessageText(decoded.text) === normalizeMessageText(local.text)
    && attachmentSignature(decoded.attachments) === attachmentSignature(local.attachments)
    && timestampsLikelyRepresentSameMessage(decoded.createdAt, local.createdAt);
}

function attachmentSignature(attachments: ImageAttachment[] | undefined): string {
  return (attachments ?? []).map((attachment) => (
    attachment.sourceURL
      || attachment.payloadDataURL
      || attachment.thumbnailBase64JPEG
      || attachment.id
  )).join("\u0000");
}

function timestampsLikelyRepresentSameMessage(decodedCreatedAt: number, localCreatedAt: number): boolean {
  if (!decodedCreatedAt || !localCreatedAt) {
    return false;
  }
  return Math.abs(decodedCreatedAt - localCreatedAt) <= 5 * 60_000;
}
