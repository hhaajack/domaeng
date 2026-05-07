import { create } from "zustand";
import type {
  ApprovalRequest,
  CodexThread,
  GitStatus,
  ImageAttachment,
  ModelOption,
  RuntimeSettings,
  SecureConnectionState,
  TimelineMessage
} from "../types";
import { makeImageAttachment } from "../lib/attachments";
import { parsePairingPayload } from "../lib/pairing";
import {
  isThreadNotFoundError,
  isThreadRolloutMissingError,
  RemodexClient
} from "../lib/remodexClient";
import { randomUUID } from "../lib/base64";
import {
  appendLocalUserMessage,
  applyNotification,
  decodeThreadRead,
  type TimelineState
} from "../lib/timeline";
import { normalizeRuntimeSettings, readRuntimeSettings, writeRuntimeSettings } from "../lib/storage";

interface RemodexStore {
  client: RemodexClient;
  connectionStatus: string;
  secureState: SecureConnectionState;
  lastError?: string;
  threads: CodexThread[];
  activeThreadId?: string;
  locallyStartedThreadIds: Record<string, true>;
  messagesByThread: Record<string, TimelineMessage[]>;
  runningTurnByThread: Record<string, string | undefined>;
  pendingApprovals: ApprovalRequest[];
  gitStatus?: GitStatus;
  availableModels: ModelOption[];
  modelsError?: string;
  runtimeSettings: RuntimeSettings;
  composerText: string;
  attachments: ImageAttachment[];
  queuedDraftsByThread: Record<string, string[]>;
  settingsOpen: boolean;
  scannerOpen: boolean;
  hydrate: () => Promise<void>;
  connectFromPairingText: (rawText: string) => Promise<void>;
  connectWithPairingCode: (code: string, relayURL?: string) => Promise<void>;
  connectTrusted: (relayURL?: string) => Promise<void>;
  disconnect: () => void;
  refreshAfterConnect: () => Promise<void>;
  refreshThreads: () => Promise<void>;
  openThread: (threadId: string) => Promise<void>;
  newThread: (cwd?: string) => Promise<void>;
  setComposerText: (value: string) => void;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeAttachment: (id: string) => void;
  sendComposer: () => Promise<void>;
  stopActiveTurn: () => Promise<void>;
  queueDraft: () => void;
  sendQueuedDraft: (threadId: string, index: number) => Promise<void>;
  approve: (request: ApprovalRequest, decision: "accept" | "decline" | "acceptForSession") => Promise<void>;
  setRuntimeSettings: (settings: Partial<RuntimeSettings>) => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  commit: (message: string) => Promise<void>;
  push: () => Promise<void>;
  pull: () => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  setScannerOpen: (open: boolean) => void;
}

const client = new RemodexClient();

export const useRemodexStore = create<RemodexStore>((set, get) => {
  client.on((event) => {
    switch (event.type) {
      case "status":
        set({ connectionStatus: event.status, lastError: event.detail });
        break;
      case "secureState":
        set({ secureState: event.state as SecureConnectionState });
        break;
      case "notification":
        set((state) => applyTimelinePatch(state, applyNotification(state, event.method, event.params)));
        if (event.method === "turn/completed" && "Notification" in window && Notification.permission === "granted") {
          new Notification("Remodex", { body: "Turn completed" });
        }
        break;
      case "approval":
        set((state) => ({
          pendingApprovals: [
            ...state.pendingApprovals.filter((request) => request.id !== event.request.id),
            event.request
          ]
        }));
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Remodex", { body: "Approval requested" });
        }
        break;
      case "serverRequest":
        set((state) => ({
          lastError: `Unsupported server request: ${event.method}`
        }));
        break;
      case "error":
        set({ lastError: event.error.message });
        break;
      default:
        break;
    }
  });

  async function createContinuationThread(sourceThreadId: string, runtimeSettings: RuntimeSettings): Promise<string> {
    const sourceThread = get().threads.find((thread) => thread.id === sourceThreadId);
    const response = await client.startThread(sourceThread?.cwd, runtimeSettings);
    const continuation = extractThread(response.result);
    if (!continuation?.id) {
      throw new Error("thread/start response missing continuation thread");
    }
    const patchedThread = sourceThread?.cwd && !continuation.cwd
      ? { ...continuation, cwd: sourceThread.cwd }
      : continuation;
    set((state) => ({
      threads: [patchedThread, ...state.threads.filter((entry) => entry.id !== patchedThread.id)],
      activeThreadId: patchedThread.id,
      locallyStartedThreadIds: {
        ...state.locallyStartedThreadIds,
        [patchedThread.id]: true
      },
      messagesByThread: {
        ...state.messagesByThread,
        [patchedThread.id]: appendOnce(state.messagesByThread[patchedThread.id] ?? [], {
          id: randomUUID(),
          role: "system",
          kind: "chat",
          threadId: patchedThread.id,
          text: `Continued from archived thread \`${sourceThreadId}\``,
          createdAt: Date.now()
        })
      }
    }));
    return patchedThread.id;
  }

  async function ensureWritableThread(threadId: string, runtimeSettings: RuntimeSettings): Promise<string> {
    const thread = get().threads.find((entry) => entry.id === threadId);
    const localEmptyThread = Boolean(get().locallyStartedThreadIds[threadId])
      && (get().messagesByThread[threadId] ?? []).length === 0;
    if (localEmptyThread) {
      return threadId;
    }

    try {
      const response = await client.resumeThread(threadId, thread?.cwd, runtimeSettings);
      set((state) => applyTimelinePatch(state, decodeThreadRead(state, response.result)));
      return threadId;
    } catch (error) {
      if (isThreadNotFoundError(error)) {
        return createContinuationThread(threadId, runtimeSettings);
      }
      if (isThreadRolloutMissingError(error) && get().locallyStartedThreadIds[threadId]) {
        return threadId;
      }
      throw error;
    }
  }

  function removeLatestLocalUserMessage(threadId: string, text: string, attachments: ImageAttachment[]): void {
    set((state) => {
      const messages = state.messagesByThread[threadId] ?? [];
      const index = findLatestLocalUserMessageIndex(messages, text, attachments);
      if (index < 0) {
        return state;
      }
      return {
        messagesByThread: {
          ...state.messagesByThread,
          [threadId]: messages.filter((_, entryIndex) => entryIndex !== index)
        }
      };
    });
  }

  async function startTurnOnWritableThread(
    threadId: string,
    text: string,
    attachments: ImageAttachment[],
    runtimeSettings: RuntimeSettings,
    onTargetReady?: (targetThreadId: string) => void
  ): Promise<string> {
    let targetThreadId = await ensureWritableThread(threadId, runtimeSettings);
    onTargetReady?.(targetThreadId);
    try {
      await client.startTurn({
        threadId: targetThreadId,
        text,
        attachments,
        settings: runtimeSettings
      });
      forgetLocallyStartedThread(targetThreadId);
      void refreshDesktopThreadBestEffort(targetThreadId);
    } catch (error) {
      if (!isThreadNotFoundError(error) || targetThreadId !== threadId) {
        throw error;
      }
      removeLatestLocalUserMessage(targetThreadId, text, attachments);
      targetThreadId = await createContinuationThread(threadId, runtimeSettings);
      onTargetReady?.(targetThreadId);
      await client.startTurn({
        threadId: targetThreadId,
        text,
        attachments,
        settings: runtimeSettings
      });
      forgetLocallyStartedThread(targetThreadId);
      void refreshDesktopThreadBestEffort(targetThreadId);
    }
    return targetThreadId;
  }

  function forgetLocallyStartedThread(threadId: string): void {
    set((state) => {
      if (!state.locallyStartedThreadIds[threadId]) {
        return state;
      }
      const { [threadId]: _removed, ...locallyStartedThreadIds } = state.locallyStartedThreadIds;
      return { locallyStartedThreadIds };
    });
  }

  async function refreshDesktopThreadBestEffort(threadId: string): Promise<void> {
    try {
      await client.refreshDesktopThread(threadId);
    } catch (error) {
      set({
        lastError: `Sent, but Codex.app refresh failed: ${errorMessage(error)}. Restart the bridge if it is still running an older build.`
      });
    }
  }

  return {
    client,
    connectionStatus: "disconnected",
    secureState: "notPaired",
    threads: [],
    locallyStartedThreadIds: {},
    messagesByThread: {},
    runningTurnByThread: {},
    pendingApprovals: [],
    availableModels: [],
    runtimeSettings: {
      accessMode: "onRequest",
      autoReview: false,
      planMode: false
    },
    composerText: "",
    attachments: [],
    queuedDraftsByThread: {},
    settingsOpen: false,
    scannerOpen: false,

    async hydrate() {
      set({ runtimeSettings: await readRuntimeSettings() });
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    },

    async connectFromPairingText(rawText) {
      set({ lastError: undefined });
      try {
        await client.connectFromPairing(parsePairingPayload(rawText));
        await get().refreshAfterConnect();
      } catch (error) {
        set({ lastError: errorMessage(error) });
      }
    },

    async connectWithPairingCode(code, relayURL) {
      set({ lastError: undefined });
      try {
        const payload = await client.resolvePairingCode(code, relayURL);
        await client.connectFromPairing(payload);
        await get().refreshAfterConnect();
      } catch (error) {
        set({ lastError: errorMessage(error) });
      }
    },

    async connectTrusted(relayURL) {
      set({ lastError: undefined });
      try {
        await client.connectTrusted(relayURL);
        await get().refreshAfterConnect();
      } catch (error) {
        set({ lastError: errorMessage(error) });
      }
    },

    disconnect() {
      client.disconnect();
      set({ secureState: "notPaired" });
    },

    async refreshThreads() {
      const threads = decodeThreads(await client.listThreads());
      const currentActive = get().activeThreadId;
      const nextActive = currentActive && threads.some((thread) => thread.id === currentActive)
        ? currentActive
        : threads[0]?.id;
      set({
        threads,
        activeThreadId: nextActive
      });
      if (nextActive && !get().messagesByThread[nextActive]) {
        try {
          await get().openThread(nextActive);
        } catch (error) {
          set({ lastError: errorMessage(error) });
        }
      }
    },

    async refreshAfterConnect() {
      try {
        await get().refreshThreads();
      } catch (error) {
        set({ lastError: `Connected, but initial thread refresh failed: ${errorMessage(error)}` });
      }
      void get().refreshModels();
    },

    async openThread(threadId) {
      set({ activeThreadId: threadId });
      const response = await client.readThread(threadId);
      set((state) => applyTimelinePatch(state, decodeThreadRead(state, response.result)));
      await get().refreshGitStatus();
    },

    async newThread(cwd) {
      const response = await client.startThread(cwd, get().runtimeSettings);
      const thread = extractThread(response.result);
      if (thread) {
        set((state) => ({
          threads: [thread, ...state.threads.filter((entry) => entry.id !== thread.id)],
          activeThreadId: thread.id,
          locallyStartedThreadIds: {
            ...state.locallyStartedThreadIds,
            [thread.id]: true
          }
        }));
      }
    },

    setComposerText(value) {
      set({ composerText: value });
    },

    async addFiles(files) {
      const attachments = await Promise.all(Array.from(files).map(makeImageAttachment));
      set((state) => ({ attachments: [...state.attachments, ...attachments] }));
    },

    removeAttachment(id) {
      set((state) => ({ attachments: state.attachments.filter((attachment) => attachment.id !== id) }));
    },

    async sendComposer() {
      const { activeThreadId, composerText, attachments, runtimeSettings } = get();
      const trimmed = composerText.trim();
      if (!activeThreadId || (!trimmed && attachments.length === 0)) {
        return;
      }
      set({ lastError: undefined });
      try {
        await startTurnOnWritableThread(activeThreadId, trimmed, attachments, runtimeSettings, (targetThreadId) => {
          set((state) => ({
            ...applyTimelinePatch(state, appendLocalUserMessage(state, targetThreadId, trimmed, attachments)),
            composerText: "",
            attachments: []
          }));
        });
      } catch (error) {
        set({ lastError: errorMessage(error) });
      }
    },

    async stopActiveTurn() {
      const { activeThreadId, runningTurnByThread } = get();
      if (!activeThreadId) {
        return;
      }
      await client.interruptTurn(activeThreadId, runningTurnByThread[activeThreadId]);
    },

    queueDraft() {
      const { activeThreadId, composerText } = get();
      const trimmed = composerText.trim();
      if (!activeThreadId || !trimmed) {
        return;
      }
      set((state) => ({
        composerText: "",
        queuedDraftsByThread: {
          ...state.queuedDraftsByThread,
          [activeThreadId]: [...(state.queuedDraftsByThread[activeThreadId] ?? []), trimmed]
        }
      }));
    },

    async sendQueuedDraft(threadId, index) {
      const draft = get().queuedDraftsByThread[threadId]?.[index];
      if (!draft) {
        return;
      }
      set({ lastError: undefined });
      try {
        await startTurnOnWritableThread(threadId, draft, [], get().runtimeSettings, (targetThreadId) => {
          set((state) => ({
            ...applyTimelinePatch(state, appendLocalUserMessage(state, targetThreadId, draft, [])),
            queuedDraftsByThread: {
              ...state.queuedDraftsByThread,
              [threadId]: (state.queuedDraftsByThread[threadId] ?? []).filter((_, entryIndex) => entryIndex !== index)
            }
          }));
        });
      } catch (error) {
        set({ lastError: errorMessage(error) });
      }
    },

    async approve(request, decision) {
      await client.approve(request, decision);
      set((state) => ({
        pendingApprovals: state.pendingApprovals.filter((entry) => entry.id !== request.id)
      }));
    },

    async setRuntimeSettings(settings) {
      const next = normalizeRuntimeSettings({ ...get().runtimeSettings, ...settings });
      await writeRuntimeSettings(next);
      set({ runtimeSettings: next });
    },

    async refreshModels() {
      try {
        const models = await client.listModels();
        const runtimeSettings = get().runtimeSettings;
        const selectedModel = normalizeModelSelection(models, runtimeSettings.model);
        const selectedOption = models.find((model) => model.id === selectedModel || model.model === selectedModel);
        const nextSettings = normalizeRuntimeSettings({
          ...runtimeSettings,
          model: selectedModel,
          reasoningEffort: normalizeReasoningSelection(selectedOption, runtimeSettings.reasoningEffort)
        });
        await writeRuntimeSettings(nextSettings);
        set({
          availableModels: models,
          modelsError: undefined,
          runtimeSettings: nextSettings
        });
      } catch (error) {
        set({ modelsError: errorMessage(error) });
      }
    },

    async refreshGitStatus() {
      const cwd = get().threads.find((thread) => thread.id === get().activeThreadId)?.cwd;
      if (!cwd) {
        set({ gitStatus: undefined });
        return;
      }
      try {
        set({ gitStatus: await client.gitStatus(cwd) });
      } catch (error) {
        set({ gitStatus: undefined, lastError: errorMessage(error) });
      }
    },

    async commit(message) {
      const cwd = get().gitStatus?.cwd ?? get().threads.find((thread) => thread.id === get().activeThreadId)?.cwd;
      await client.gitCommit(cwd, message);
      await get().refreshGitStatus();
    },

    async push() {
      await client.gitPush(get().gitStatus?.cwd);
      await get().refreshGitStatus();
    },

    async pull() {
      await client.gitPull(get().gitStatus?.cwd);
      await get().refreshGitStatus();
    },

    setSettingsOpen(open) {
      set({ settingsOpen: open });
    },

    setScannerOpen(open) {
      set({ scannerOpen: open });
    }
  };
});

function applyTimelinePatch<T extends TimelineState>(state: T, next: TimelineState): T {
  return {
    ...state,
    threads: next.threads,
    messagesByThread: next.messagesByThread,
    runningTurnByThread: next.runningTurnByThread
  };
}

function appendOnce(messages: TimelineMessage[], next: TimelineMessage): TimelineMessage[] {
  if (messages.some((message) => message.text === next.text && message.role === next.role && message.kind === next.kind)) {
    return messages;
  }
  return [...messages, next];
}

function findLatestLocalUserMessageIndex(
  messages: TimelineMessage[],
  text: string,
  attachments: ImageAttachment[]
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === "user"
      && !message.turnId
      && message.text === text
      && sameAttachmentIds(message.attachments ?? [], attachments)
    ) {
      return index;
    }
  }
  return -1;
}

function sameAttachmentIds(left: ImageAttachment[], right: ImageAttachment[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((attachment, index) => attachment.id === right[index]?.id);
}

function extractThread(value: unknown): CodexThread | null {
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const candidate = result.thread && typeof result.thread === "object"
    ? result.thread as unknown as CodexThread
    : result as unknown as CodexThread;
  return candidate.id ? candidate : null;
}

function decodeThreads(values: unknown[]): CodexThread[] {
  return values.flatMap((value) => {
    const object = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
    const id = readString(object?.id) || readString(object?.threadId) || readString(object?.thread_id);
    if (!id) {
      return [];
    }
    return [{
      id,
      title: readString(object?.title),
      name: readString(object?.name),
      cwd: readString(object?.cwd) || readString(object?.current_working_directory) || readString(object?.working_directory),
      status: readString(object?.status),
      updatedAt: readTimestamp(object?.updatedAt) ?? readTimestamp(object?.updated_at),
      createdAt: readTimestamp(object?.createdAt) ?? readTimestamp(object?.created_at),
      archived: object?.archived === true,
      sourceKind: readString(object?.sourceKind) || readString(object?.source_kind)
    }];
  });
}

function normalizeModelSelection(models: ModelOption[], current: string | undefined): string | undefined {
  if (!models.length) {
    return current;
  }
  if (current && models.some((model) => model.id === current || model.model === current)) {
    return current;
  }
  const fallback = models.find((model) => model.isDefault) ?? models[0];
  return fallback?.id || fallback?.model;
}

function normalizeReasoningSelection(model: ModelOption | undefined, current: string | undefined): string | undefined {
  const efforts = model?.supportedReasoningEfforts ?? [];
  if (!efforts.length) {
    return current;
  }
  if (current && efforts.some((option) => option.reasoningEffort === current || option.id === current)) {
    return current;
  }
  return model?.defaultReasoningEffort || efforts[0]?.reasoningEffort;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTimestamp(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return typeof value === "number" ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
