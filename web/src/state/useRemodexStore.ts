import { create } from "zustand";
import type {
  ApprovalRequest,
  ComposerMention,
  ComposerSkillMention,
  ContextWindowUsage,
  CodexRateLimitBucket,
  CodexThread,
  GitStatus,
  ImageAttachment,
  InAppNotification,
  JSONValue,
  ModelOption,
  QueuedComposerDraft,
  RuntimeSettings,
  SecureConnectionState,
  ThreadRunState,
  TimelineMessage,
  WebPushStatus
} from "../types";
import { makeImageAttachment } from "../lib/attachments";
import { parsePairingPayload } from "../lib/pairing";
import {
  isThreadNotFoundError,
  isThreadRolloutMissingError,
  RemodexClient
} from "../lib/remodexClient";
import { idKey, randomUUID } from "../lib/base64";
import {
  appendLocalUserMessage,
  applyNotification,
  decodeThreadRead,
  type TimelineState
} from "../lib/timeline";
import { normalizeRuntimeSettings, readRuntimeSettings, readTrustedMacs, writeRuntimeSettings } from "../lib/storage";
import {
  disableWebPush,
  enableWebPush,
  readWebPushRuntimeState
} from "../lib/webPush";

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
  threadRunStateByThread: Record<string, ThreadRunState | undefined>;
  inAppNotifications: InAppNotification[];
  pendingApprovals: ApprovalRequest[];
  gitStatus?: GitStatus;
  rateLimitBuckets: CodexRateLimitBucket[];
  isLoadingRateLimits: boolean;
  rateLimitsError?: string;
  rateLimitsLoadedAt?: number;
  contextWindowUsageByThread: Record<string, ContextWindowUsage | undefined>;
  contextWindowUsageLoadedAtByThread: Record<string, number | undefined>;
  contextWindowUsageErrorByThread: Record<string, string | undefined>;
  isLoadingContextWindowUsageByThread: Record<string, boolean | undefined>;
  availableModels: ModelOption[];
  modelsError?: string;
  runtimeSettings: RuntimeSettings;
  webPushStatus: WebPushStatus;
  webPushError?: string;
  composerText: string;
  composerSkillMentions: ComposerSkillMention[];
  composerMentionMentions: ComposerMention[];
  attachments: ImageAttachment[];
  queuedDraftsByThread: Record<string, QueuedComposerDraft[]>;
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
  renameThread: (threadId: string, name: string) => Promise<void>;
  setComposerText: (value: string) => void;
  addComposerSkillMention: (mention: ComposerSkillMention) => void;
  addComposerMentionMention: (mention: ComposerMention) => void;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeAttachment: (id: string) => void;
  sendComposer: () => Promise<void>;
  stopActiveTurn: () => Promise<void>;
  queueDraft: () => void;
  sendQueuedDraft: (threadId: string, index: number) => Promise<void>;
  approve: (request: ApprovalRequest, decision: "accept" | "decline" | "acceptForSession") => Promise<void>;
  answerUserInput: (request: ApprovalRequest, questionId: string, answer: string) => Promise<void>;
  dismissInAppNotification: (id: string) => void;
  setRuntimeSettings: (settings: Partial<RuntimeSettings>) => Promise<void>;
  refreshContextWindowUsage: (threadId: string) => Promise<void>;
  refreshRateLimits: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  refreshWebPushStatus: () => Promise<void>;
  enableWebPushNotifications: () => Promise<void>;
  disableWebPushNotifications: () => Promise<void>;
  commit: (message: string) => Promise<void>;
  push: () => Promise<void>;
  pull: () => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  setScannerOpen: (open: boolean) => void;
}

const client = new RemodexClient();

export const useRemodexStore = create<RemodexStore>((set, get) => {
  let secureChannelRecoveryPromise: Promise<void> | null = null;

  async function recoverTrustedConnection(): Promise<void> {
    if (secureChannelRecoveryPromise) {
      return secureChannelRecoveryPromise;
    }
    set({
      connectionStatus: "connecting",
      secureState: "reconnecting",
      lastError: undefined
    });
    secureChannelRecoveryPromise = (async () => {
      try {
        await client.connectTrusted();
        await get().refreshAfterConnect();
      } catch (error) {
        set({
          connectionStatus: "disconnected",
          secureState: secureStateForTrustedReconnectFailure(error),
          lastError: errorMessage(error)
        });
      } finally {
        secureChannelRecoveryPromise = null;
      }
    })();
    return secureChannelRecoveryPromise;
  }

  client.on((event) => {
    switch (event.type) {
      case "status":
        set({ connectionStatus: event.status, lastError: event.detail });
        break;
      case "secureState":
        set({ secureState: event.state as SecureConnectionState });
        break;
      case "notification":
        if (event.method === "thread/tokenUsage/updated") {
          set((state) => applyContextUsageUpdate(state, event.params));
          break;
        }
        if (event.method === "account/rateLimits/updated") {
          set((state) => ({
            rateLimitBuckets: applyRateLimitsPayload(event.params, state.rateLimitBuckets, true),
            rateLimitsError: undefined,
            rateLimitsLoadedAt: Date.now()
          }));
          break;
        }
        if (isAccountIdentityUpdate(event.method)) {
          set({
            rateLimitBuckets: [],
            isLoadingRateLimits: false,
            rateLimitsError: undefined,
            rateLimitsLoadedAt: undefined
          });
          void get().refreshRateLimits();
          break;
        }
        if (event.method === "serverRequest/resolved") {
          const requestId = resolvedServerRequestId(event.params);
          if (requestId) {
            set((state) => ({
              ...clearResolvedApprovalState(state, requestId)
            }));
          }
        }
        set((state) => applyThreadActivityUpdate(
          applyTimelinePatch(state, applyNotification(state, event.method, event.params)),
          event.method,
          event.params
        ));
        maybeRefreshContextWindowUsageAfterNotification(event.method, event.params);
        break;
      case "approval":
        set((state) => applyApprovalActivityUpdate(state, event.request));
        break;
      case "serverRequest":
        set((state) => ({
          lastError: `Unsupported server request: ${event.method}`
        }));
        break;
      case "error":
        if (isSecureChannelLostError(event.error.message)) {
          void recoverTrustedConnection();
          break;
        }
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
    try {
      const response = await client.resumeThread(threadId, thread?.cwd, runtimeSettings);
      set((state) => applyThreadReadResult(state, response.result));
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
    skillMentions: ComposerSkillMention[] = [],
    mentionMentions: ComposerMention[] = [],
    onTargetReady?: (targetThreadId: string) => void,
    allowSteer = false
  ): Promise<string> {
    let targetThreadId = await ensureWritableThread(threadId, runtimeSettings);
    assertCanStartNewTurn(targetThreadId, allowSteer);
    onTargetReady?.(targetThreadId);
    try {
      const result = await sendTurnInput(targetThreadId, text, attachments, runtimeSettings, skillMentions, mentionMentions, allowSteer, true);
      markLocalTurnAccepted(targetThreadId, result);
      forgetLocallyStartedThread(targetThreadId);
      void refreshDesktopThreadBestEffort(targetThreadId);
    } catch (error) {
      if (!isThreadNotFoundError(error) || targetThreadId !== threadId) {
        clearLocalTurnStart(targetThreadId);
        throw error;
      }
      removeLatestLocalUserMessage(targetThreadId, text, attachments);
      clearLocalTurnStart(targetThreadId);
      targetThreadId = await createContinuationThread(threadId, runtimeSettings);
      assertCanStartNewTurn(targetThreadId, allowSteer);
      onTargetReady?.(targetThreadId);
      const result = await sendTurnInput(targetThreadId, text, attachments, runtimeSettings, skillMentions, mentionMentions, allowSteer, true);
      markLocalTurnAccepted(targetThreadId, result);
      forgetLocallyStartedThread(targetThreadId);
      void refreshDesktopThreadBestEffort(targetThreadId);
    }
    return targetThreadId;
  }

  function assertCanStartNewTurn(threadId: string, allowSteer: boolean): void {
    if (!allowSteer && get().runningTurnByThread[threadId]) {
      throw codedStoreError(
        "turn_running",
        "Codex is still working on this thread. Queue this draft or wait for the current turn to finish."
      );
    }
  }

  async function sendTurnInput(
    threadId: string,
    text: string,
    attachments: ImageAttachment[],
    runtimeSettings: RuntimeSettings,
    skillMentions: ComposerSkillMention[] = [],
    mentionMentions: ComposerMention[] = [],
    allowSteer = false,
    ignoreLocalPendingMarker = false
  ): Promise<JSONValue | undefined> {
    const activeTurnId = ignoreLocalPendingMarker && !allowSteer
      ? undefined
      : await resolveSteerTurnId(threadId);
    if (activeTurnId) {
      if (!allowSteer) {
        throw codedStoreError(
          "turn_running",
          "Codex is still working on this thread. Queue this draft or wait for the current turn to finish."
        );
      }
      const response = await client.steerTurn({
        threadId,
        expectedTurnId: activeTurnId,
        text,
        attachments,
        settings: runtimeSettings,
        skillMentions,
        mentionMentions
      });
      return response.result;
    }

    const response = await client.startTurn({
      threadId,
      text,
      attachments,
      settings: runtimeSettings,
      skillMentions,
      mentionMentions
    });
    return response.result;
  }

  function markLocalTurnAccepted(threadId: string, result: JSONValue | undefined): void {
    const turnId = resolveTurnId(objectValue(result));
    if (!turnId) {
      return;
    }
    set((state) => markStoreThreadRunning(state, threadId, turnId));
  }

  function clearLocalTurnStart(threadId: string): void {
    set((state) => {
      if (state.runningTurnByThread[threadId] !== "__running__") {
        return state;
      }
      return {
        ...state,
        runningTurnByThread: removeThreadKey(state.runningTurnByThread, threadId),
        threadRunStateByThread: clearThreadTerminalState(state.threadRunStateByThread, threadId)
      };
    });
  }

  async function resolveSteerTurnId(threadId: string): Promise<string | undefined> {
    const currentTurnId = get().runningTurnByThread[threadId];
    const concreteCurrentTurnId = concreteTurnId(currentTurnId);
    if (concreteCurrentTurnId || !currentTurnId) {
      return concreteCurrentTurnId;
    }

    await refreshThreadRunSnapshot(threadId);
    const refreshedTurnId = get().runningTurnByThread[threadId];
    const concreteRefreshedTurnId = concreteTurnId(refreshedTurnId);
    if (concreteRefreshedTurnId || !refreshedTurnId) {
      return concreteRefreshedTurnId;
    }

    throw new Error("Current turn is still starting. Try again once Codex reports the turn id.");
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

  async function refreshThreadRunSnapshot(threadId: string): Promise<void> {
    const response = await client.readThread(threadId);
    set((state) => applyThreadReadResult(state, response.result));
  }

  async function reconcileRunningThreadsAfterConnect(): Promise<void> {
    const threadIds = new Set<string>();
    const { activeThreadId, runningTurnByThread, threads } = get();
    const listedThreadIds = new Set(threads.map((thread) => thread.id));
    if (activeThreadId) {
      threadIds.add(activeThreadId);
    }
    for (const [threadId, turnId] of Object.entries(runningTurnByThread)) {
      if (turnId && listedThreadIds.has(threadId)) {
        threadIds.add(threadId);
      }
    }

    for (const threadId of threadIds) {
      try {
        await refreshThreadRunSnapshot(threadId);
      } catch (error) {
        set({ lastError: `Connected, but thread state refresh failed: ${errorMessage(error)}` });
      }
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
    threadRunStateByThread: {},
    inAppNotifications: [],
    pendingApprovals: [],
    rateLimitBuckets: [],
    isLoadingRateLimits: false,
    contextWindowUsageByThread: {},
    contextWindowUsageLoadedAtByThread: {},
    contextWindowUsageErrorByThread: {},
    isLoadingContextWindowUsageByThread: {},
    availableModels: [],
    runtimeSettings: {
      accessMode: "onRequest",
      autoReview: false,
      gitToolbarEnabled: false,
      planMode: false
    },
    webPushStatus: "checking",
    composerText: "",
    composerSkillMentions: [],
    composerMentionMentions: [],
    attachments: [],
    queuedDraftsByThread: {},
    settingsOpen: false,
    scannerOpen: false,

    async hydrate() {
      set({ runtimeSettings: await readRuntimeSettings() });
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
      void get().refreshWebPushStatus();
      const trustedMacs = await readTrustedMacs();
      if (Object.keys(trustedMacs).length > 0) {
        void recoverTrustedConnection();
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
      set({ lastError: undefined, secureState: "reconnecting" });
      try {
        await client.connectTrusted(relayURL);
        await get().refreshAfterConnect();
      } catch (error) {
        set({
          connectionStatus: "disconnected",
          secureState: secureStateForTrustedReconnectFailure(error),
          lastError: errorMessage(error)
        });
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
      await reconcileRunningThreadsAfterConnect();
      void get().refreshModels();
      void get().refreshRateLimits();
      void get().refreshWebPushStatus();
    },

    async openThread(threadId) {
      set((state) => ({
        activeThreadId: threadId,
        threads: promoteThreadByRecentUse(state.threads, threadId),
        threadRunStateByThread: clearThreadOutcomeState(state.threadRunStateByThread, threadId),
        inAppNotifications: state.inAppNotifications.filter((notification) => notification.threadId !== threadId)
      }));
      const response = await client.readThread(threadId);
      set((state) => {
        const patched = applyThreadReadResult(state, response.result);
        return {
          ...patched,
          threads: promoteThreadByRecentUse(patched.threads, threadId)
        };
      });
      void get().refreshContextWindowUsage(threadId);
      if (get().runtimeSettings.gitToolbarEnabled === true) {
        await get().refreshGitStatus();
      }
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
        if (get().runtimeSettings.gitToolbarEnabled === true) {
          await get().refreshGitStatus();
        }
      }
    },

    async renameThread(threadId, name) {
      const normalizedThreadId = threadId.trim();
      const normalizedName = name.trim();
      if (!normalizedThreadId || !normalizedName) {
        throw new Error("Thread name is required.");
      }

      set({ lastError: undefined });
      try {
        const result = await client.renameThread(normalizedThreadId, normalizedName);
        const resultObject = objectValue(result);
        const resultThreadId = resolveThreadId(resultObject) ?? normalizedThreadId;
        const resultName = readString(resultObject.name)
          || readString(resultObject.title)
          || readString(resultObject.threadName)
          || normalizedName;
        set((state) => ({
          threads: renameThreadEntries(state.threads, resultThreadId, resultName),
          lastError: undefined
        }));
      } catch (error) {
        const message = errorMessage(error);
        set({ lastError: message });
        throw error;
      }
    },

    setComposerText(value) {
      set((state) => ({
        composerText: value,
        composerSkillMentions: filterSkillMentionsForText(value, state.composerSkillMentions),
        composerMentionMentions: filterMentionMentionsForText(value, state.composerMentionMentions)
      }));
    },

    addComposerSkillMention(mention) {
      const normalizedId = mention.id.trim();
      if (!normalizedId) {
        return;
      }
      set((state) => ({
        composerSkillMentions: mergeSkillMention(state.composerSkillMentions, {
          id: normalizedId,
          name: mention.name?.trim() || normalizedId,
          path: mention.path?.trim() || undefined
        })
      }));
    },

    addComposerMentionMention(mention) {
      const name = mention.name.trim();
      const path = mention.path.trim();
      if (!name || !path) {
        return;
      }
      set((state) => ({
        composerMentionMentions: mergeMentionMention(state.composerMentionMentions, { name, path })
      }));
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
      const effectiveText = expandComposerCommand(trimmed);
      const skillMentions = filterSkillMentionsForText(trimmed, get().composerSkillMentions);
      const mentionMentions = filterMentionMentionsForText(trimmed, get().composerMentionMentions);
      set({ lastError: undefined });
      try {
        await startTurnOnWritableThread(activeThreadId, effectiveText, attachments, runtimeSettings, skillMentions, mentionMentions, (targetThreadId) => {
          set((state) => ({
            ...markStoreThreadRunning(
              applyTimelinePatch(state, appendLocalUserMessage(state, targetThreadId, effectiveText, attachments)),
              targetThreadId
            ),
            composerText: "",
            composerSkillMentions: [],
            composerMentionMentions: [],
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
      await client.interruptTurn(activeThreadId, concreteTurnId(runningTurnByThread[activeThreadId]));
    },

    queueDraft() {
      const { activeThreadId, composerText } = get();
      const trimmed = composerText.trim();
      if (!activeThreadId || !trimmed) {
        return;
      }
      const effectiveText = expandComposerCommand(trimmed);
      const skillMentions = filterSkillMentionsForText(trimmed, get().composerSkillMentions);
      const mentionMentions = filterMentionMentionsForText(trimmed, get().composerMentionMentions);
      set((state) => ({
        composerText: "",
        composerSkillMentions: [],
        composerMentionMentions: [],
        queuedDraftsByThread: {
          ...state.queuedDraftsByThread,
          [activeThreadId]: [
            ...(state.queuedDraftsByThread[activeThreadId] ?? []),
            { text: effectiveText, skillMentions, mentionMentions }
          ]
        }
      }));
    },

    async sendQueuedDraft(threadId, index) {
      const draft = get().queuedDraftsByThread[threadId]?.[index];
      if (!draft?.text) {
        return;
      }
      set({ lastError: undefined });
      try {
        await startTurnOnWritableThread(
          threadId,
          draft.text,
          [],
          get().runtimeSettings,
          draft.skillMentions ?? [],
          draft.mentionMentions ?? [],
          (targetThreadId) => {
          set((state) => ({
            ...markStoreThreadRunning(
              applyTimelinePatch(state, appendLocalUserMessage(state, targetThreadId, draft.text, [])),
              targetThreadId
            ),
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
      set({ lastError: undefined });
    },

    async answerUserInput(request, questionId, answer) {
      await client.answerUserInput(request, questionId, answer);
      set({ lastError: undefined });
    },

    dismissInAppNotification(id) {
      set((state) => ({
        inAppNotifications: state.inAppNotifications.filter((notification) => notification.id !== id)
      }));
    },

    async setRuntimeSettings(settings) {
      const next = normalizeRuntimeSettings({ ...get().runtimeSettings, ...settings });
      await writeRuntimeSettings(next);
      set({ runtimeSettings: next });
    },

    async refreshContextWindowUsage(threadId) {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        return;
      }
      set((state) => ({
        isLoadingContextWindowUsageByThread: {
          ...state.isLoadingContextWindowUsageByThread,
          [normalizedThreadId]: true
        }
      }));
      try {
        const payload = await client.readContextWindowUsage(
          normalizedThreadId,
          get().runningTurnByThread[normalizedThreadId]
        );
        set((state) => applyContextUsagePayload(state, normalizedThreadId, objectValue(payload).usage ?? payload));
      } catch (error) {
        const fallbackUsage = get().contextWindowUsageByThread[normalizedThreadId] ?? { tokensUsed: 0, tokenLimit: 0 };
        set((state) => ({
          contextWindowUsageByThread: {
            ...state.contextWindowUsageByThread,
            [normalizedThreadId]: fallbackUsage
          },
          contextWindowUsageErrorByThread: {
            ...state.contextWindowUsageErrorByThread,
            [normalizedThreadId]: errorMessage(error)
          },
          contextWindowUsageLoadedAtByThread: {
            ...state.contextWindowUsageLoadedAtByThread,
            [normalizedThreadId]: Date.now()
          },
          isLoadingContextWindowUsageByThread: {
            ...state.isLoadingContextWindowUsageByThread,
            [normalizedThreadId]: false
          }
        }));
      }
    },

    async refreshRateLimits() {
      set({ isLoadingRateLimits: true });
      try {
        const payload = await client.readRateLimits();
        set({
          rateLimitBuckets: applyRateLimitsPayload(payload, [], false),
          isLoadingRateLimits: false,
          rateLimitsError: undefined,
          rateLimitsLoadedAt: Date.now()
        });
      } catch (error) {
        set({
          rateLimitBuckets: [],
          isLoadingRateLimits: false,
          rateLimitsError: errorMessage(error),
          rateLimitsLoadedAt: Date.now()
        });
      }
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
      } catch {
        set({ gitStatus: undefined });
      }
    },

    async refreshWebPushStatus() {
      const nextState = await readWebPushRuntimeState();
      set({
        webPushStatus: nextState.status,
        webPushError: nextState.error
      });
    },

    async enableWebPushNotifications() {
      set({ webPushStatus: "subscribing", webPushError: undefined, lastError: undefined });
      try {
        await enableWebPush(client);
        await get().refreshWebPushStatus();
      } catch (error) {
        const message = errorMessage(error);
        set({
          webPushStatus: "error",
          webPushError: message,
          lastError: message
        });
      }
    },

    async disableWebPushNotifications() {
      set({ webPushStatus: "subscribing", webPushError: undefined, lastError: undefined });
      try {
        await disableWebPush(client);
        await get().refreshWebPushStatus();
      } catch (error) {
        const message = errorMessage(error);
        set({
          webPushStatus: "error",
          webPushError: message,
          lastError: message
        });
      }
    },

    async commit(message) {
      const cwd = get().gitStatus?.cwd ?? get().threads.find((thread) => thread.id === get().activeThreadId)?.cwd;
      await client.gitCommit(cwd, message);
      await get().refreshGitStatus();
    },

    async push() {
      const cwd = get().gitStatus?.cwd ?? get().threads.find((thread) => thread.id === get().activeThreadId)?.cwd;
      await client.gitPush(cwd);
      await get().refreshGitStatus();
    },

    async pull() {
      const cwd = get().gitStatus?.cwd ?? get().threads.find((thread) => thread.id === get().activeThreadId)?.cwd;
      await client.gitPull(cwd);
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

function maybeRefreshContextWindowUsageAfterNotification(method: string, params: JSONValue | undefined): void {
  if (method !== "turn/completed" && method !== "turn/failed") {
    return;
  }
  const threadId = resolveThreadId(objectValue(params));
  if (threadId) {
    void useRemodexStore.getState().refreshContextWindowUsage(threadId);
  }
}

function applyTimelinePatch<T extends TimelineState>(state: T, next: TimelineState): T {
  const patched = {
    ...state,
    threads: next.threads,
    messagesByThread: next.messagesByThread,
    runningTurnByThread: next.runningTurnByThread
  };
  if (!hasThreadRunState(patched)) {
    return patched;
  }
  return {
    ...patched,
    threadRunStateByThread: reconcileThreadRunStateWithRunningTurns(
      patched.threadRunStateByThread,
      next.runningTurnByThread
    )
  };
}

function applyThreadReadResult<T extends RemodexStore>(state: T, result: JSONValue | undefined): T {
  const patched = applyTimelinePatch(state, decodeThreadRead(state, result));
  const threadObject = objectValue(objectValue(result).thread ?? result);
  const threadId = resolveThreadId(threadObject);
  if (!threadId) {
    return patched;
  }
  const usage = extractContextWindowUsage(threadObject.usage);
  if (!usage) {
    return patched;
  }
  return {
    ...patched,
    ...contextUsageStatePatch(patched, threadId, usage)
  };
}

function applyContextUsageUpdate<T extends RemodexStore>(state: T, params: JSONValue | undefined): T {
  const paramsObject = objectValue(params);
  const threadId = resolveThreadId(paramsObject);
  if (!threadId) {
    return state;
  }
  const usage = extractContextWindowUsage(paramsObject.usage);
  if (!usage) {
    return state;
  }
  return {
    ...state,
    ...contextUsageStatePatch(state, threadId, usage)
  };
}

function applyContextUsagePayload<T extends RemodexStore>(state: T, threadId: string, payload: unknown): T {
  const usage = extractContextWindowUsage(payload) ?? { tokensUsed: 0, tokenLimit: 0 };
  return {
    ...state,
    ...contextUsageStatePatch(state, threadId, usage)
  };
}

function contextUsageStatePatch(
  state: RemodexStore,
  threadId: string,
  usage: ContextWindowUsage
): Pick<
  RemodexStore,
  "contextWindowUsageByThread"
    | "contextWindowUsageLoadedAtByThread"
    | "contextWindowUsageErrorByThread"
    | "isLoadingContextWindowUsageByThread"
> {
  return {
    contextWindowUsageByThread: {
      ...state.contextWindowUsageByThread,
      [threadId]: usage
    },
    contextWindowUsageLoadedAtByThread: {
      ...state.contextWindowUsageLoadedAtByThread,
      [threadId]: Date.now()
    },
    contextWindowUsageErrorByThread: {
      ...state.contextWindowUsageErrorByThread,
      [threadId]: undefined
    },
    isLoadingContextWindowUsageByThread: {
      ...state.isLoadingContextWindowUsageByThread,
      [threadId]: false
    }
  };
}

function extractContextWindowUsage(value: unknown): ContextWindowUsage | undefined {
  const object = objectValue(value);
  const tokensUsed = firstNumberForKeys(object, [
    "tokensUsed",
    "tokens_used",
    "totalTokens",
    "total_tokens",
    "usedTokens",
    "used_tokens",
    "inputTokens",
    "input_tokens"
  ]);
  const explicitLimit = firstNumberForKeys(object, [
    "tokenLimit",
    "token_limit",
    "maxTokens",
    "max_tokens",
    "contextWindow",
    "context_window",
    "contextSize",
    "context_size",
    "maxContextTokens",
    "max_context_tokens",
    "inputTokenLimit",
    "input_token_limit",
    "maxInputTokens",
    "max_input_tokens"
  ]);
  const tokensRemaining = firstNumberForKeys(object, [
    "tokensRemaining",
    "tokens_remaining",
    "remainingTokens",
    "remaining_tokens",
    "remainingInputTokens",
    "remaining_input_tokens"
  ]);

  const resolvedTokensUsed = Math.max(0, Math.round(tokensUsed ?? 0));
  const tokenLimit = explicitLimit != null
    ? Math.round(explicitLimit)
    : tokensRemaining != null
      ? resolvedTokensUsed + Math.max(0, Math.round(tokensRemaining))
      : undefined;
  if (tokenLimit == null || tokenLimit <= 0) {
    return undefined;
  }

  return {
    tokensUsed: Math.min(resolvedTokensUsed, tokenLimit),
    tokenLimit
  };
}

function firstNumberForKeys(object: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readNumber(object[key]);
    if (value != null) {
      return value;
    }
  }
  return undefined;
}

function hasThreadRunState<T extends TimelineState>(
  state: T
): state is T & { threadRunStateByThread: Record<string, ThreadRunState | undefined> } {
  return "threadRunStateByThread" in state;
}

function reconcileThreadRunStateWithRunningTurns(
  stateByThread: Record<string, ThreadRunState | undefined>,
  runningTurnByThread: Record<string, string | undefined>
): Record<string, ThreadRunState | undefined> {
  let next = stateByThread;
  const threadIds = new Set([
    ...Object.keys(stateByThread),
    ...Object.keys(runningTurnByThread)
  ]);

  for (const threadId of threadIds) {
    const current = next[threadId];
    if (runningTurnByThread[threadId]) {
      if (current !== "approval" && current !== "running") {
        next = {
          ...next,
          [threadId]: "running"
        };
      }
      continue;
    }
    if (current === "running") {
      const { [threadId]: _removed, ...rest } = next;
      next = rest;
    }
  }

  return next;
}

function markStoreThreadRunning<T extends RemodexStore>(
  state: T,
  threadId: string,
  turnId = "__running__"
): T {
  return {
    ...state,
    runningTurnByThread: {
      ...state.runningTurnByThread,
      [threadId]: turnId
    },
    threadRunStateByThread: {
      ...state.threadRunStateByThread,
      [threadId]: "running"
    }
  };
}

function isSecureChannelLostError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("could not decrypt")
    && normalized.includes("secure payload");
}

function secureStateForTrustedReconnectFailure(error: unknown): SecureConnectionState {
  const code = errorCode(error);
  if (
    code === "phone_not_trusted"
    || code === "phone_identity_changed"
    || code === "invalid_phone_signature"
    || errorMessage(error).toLowerCase().includes("has not paired")
  ) {
    return "rePairRequired";
  }
  if (code === "update_required") {
    return "updateRequired";
  }
  if (code === "session_unavailable") {
    return "liveSessionUnresolved";
  }
  return "trustedMac";
}

function errorCode(error: unknown): string | undefined {
  const value = (error || {}) as { code?: unknown };
  return typeof value.code === "string" && value.code.trim() ? value.code.trim() : undefined;
}

function concreteTurnId(turnId: string | undefined): string | undefined {
  return turnId && turnId !== "__running__" ? turnId : undefined;
}

function applyThreadActivityUpdate<T extends RemodexStore>(
  state: T,
  method: string,
  params: JSONValue | undefined
): T {
  const paramsObject = objectValue(params);
  const threadId = resolveThreadId(paramsObject);
  if (!threadId) {
    return state;
  }

  if (method === "turn/started" || isActiveThreadStatus(method, paramsObject)) {
    const turnId = resolveTurnId(paramsObject) || state.runningTurnByThread[threadId] || "__running__";
    return {
      ...state,
      runningTurnByThread: {
        ...state.runningTurnByThread,
        [threadId]: turnId
      },
      threadRunStateByThread: {
        ...state.threadRunStateByThread,
        [threadId]: "running"
      }
    };
  }

  const outcome = terminalOutcomeForNotification(method, paramsObject);
  if (!outcome) {
    return state;
  }
  if (shouldIgnoreTerminalNotificationForRunningState(state, method, threadId, paramsObject)) {
    return state;
  }

  const nextRunState = state.activeThreadId === threadId
    ? clearThreadTerminalState(state.threadRunStateByThread, threadId)
    : {
        ...state.threadRunStateByThread,
        [threadId]: outcome
      };
  const notification = state.activeThreadId === threadId
    ? undefined
    : makeInAppNotification({
        kind: outcome,
        threadId,
        title: titleForThread(state.threads, threadId),
        body: outcome === "failed" ? "Run failed" : "Response ready",
        idSuffix: resolveTurnId(paramsObject) ?? String(Date.now())
      });
  const notificationUpdate = notification
    ? upsertInAppNotification(state.inAppNotifications, notification)
    : undefined;

  if (notification && notificationUpdate?.shouldAnnounce) {
    showBrowserNotification(notification);
  }

  return {
    ...state,
    runningTurnByThread: removeThreadKey(state.runningTurnByThread, threadId),
    threadRunStateByThread: nextRunState,
    inAppNotifications: notificationUpdate?.notifications ?? state.inAppNotifications
  };
}

function shouldIgnoreTerminalNotificationForRunningState(
  state: RemodexStore,
  method: string,
  threadId: string,
  params: Record<string, unknown>
): boolean {
  if (method !== "turn/completed" && method !== "turn/failed") {
    return false;
  }
  const terminalTurnId = resolveTurnId(params);
  const runningTurnId = state.runningTurnByThread[threadId];
  if (terminalTurnId) {
    return Boolean(runningTurnId && runningTurnId !== "__running__" && runningTurnId !== terminalTurnId);
  }
  return !runningTurnId || runningTurnId !== "__running__";
}

function removeThreadKey<TValue>(
  stateByThread: Record<string, TValue | undefined>,
  threadId: string
): Record<string, TValue | undefined> {
  if (stateByThread[threadId] == null) {
    return stateByThread;
  }
  const { [threadId]: _removed, ...rest } = stateByThread;
  return rest;
}

function applyApprovalActivityUpdate<T extends RemodexStore>(state: T, request: ApprovalRequest): T {
  const pendingApprovals = [
    ...state.pendingApprovals.filter((entry) => {
      return entry.id !== request.id && approvalRequestKey(entry) !== approvalRequestKey(request);
    }),
    request
  ];
  const threadId = request.threadId?.trim();
  if (!threadId) {
    return {
      ...state,
      pendingApprovals
    };
  }

  const notification = state.activeThreadId === threadId
    ? undefined
    : makeInAppNotification({
        kind: "approval",
        threadId,
        title: titleForThread(state.threads, threadId),
        body: approvalNotificationBody(request),
        idSuffix: request.id
      });
  const notificationUpdate = notification
    ? upsertInAppNotification(state.inAppNotifications, notification)
    : undefined;

  if (notification && notificationUpdate?.shouldAnnounce) {
    showBrowserNotification(notification);
  }

  return {
    ...state,
    pendingApprovals,
    threadRunStateByThread: {
      ...state.threadRunStateByThread,
      [threadId]: "approval"
    },
    inAppNotifications: notificationUpdate?.notifications ?? state.inAppNotifications
  };
}

function clearResolvedApprovalState<T extends RemodexStore>(
  state: T,
  requestId: string
): Pick<RemodexStore, "pendingApprovals" | "threadRunStateByThread" | "inAppNotifications"> {
  const removed = state.pendingApprovals.filter((request) => request.id === requestId);
  const pendingApprovals = state.pendingApprovals.filter((request) => request.id !== requestId);
  let threadRunStateByThread = state.threadRunStateByThread;
  let inAppNotifications = state.inAppNotifications;

  for (const request of removed) {
    const threadId = request.threadId?.trim();
    if (!threadId) {
      continue;
    }
    const hasRemainingApproval = pendingApprovals.some((entry) => entry.threadId === threadId);
    if (hasRemainingApproval) {
      continue;
    }

    const currentState = threadRunStateByThread[threadId];
    if (currentState !== "ready" && currentState !== "failed") {
      threadRunStateByThread = {
        ...threadRunStateByThread,
        [threadId]: state.runningTurnByThread[threadId] ? "running" : undefined
      };
    }
    if (!threadRunStateByThread[threadId]) {
      const { [threadId]: _removed, ...rest } = threadRunStateByThread;
      threadRunStateByThread = rest;
    }
    inAppNotifications = inAppNotifications.filter((notification) => {
      return notification.kind !== "approval" || notification.threadId !== threadId;
    });
  }

  return {
    pendingApprovals,
    threadRunStateByThread,
    inAppNotifications
  };
}

function clearThreadOutcomeState(
  stateByThread: Record<string, ThreadRunState | undefined>,
  threadId: string
): Record<string, ThreadRunState | undefined> {
  const current = stateByThread[threadId];
  if (current !== "ready" && current !== "failed") {
    return stateByThread;
  }
  const { [threadId]: _removed, ...rest } = stateByThread;
  return rest;
}

function clearThreadTerminalState(
  stateByThread: Record<string, ThreadRunState | undefined>,
  threadId: string
): Record<string, ThreadRunState | undefined> {
  if (stateByThread[threadId] === "approval" || stateByThread[threadId] == null) {
    return stateByThread;
  }
  const { [threadId]: _removed, ...rest } = stateByThread;
  return rest;
}

function makeInAppNotification({
  kind,
  threadId,
  title,
  body,
  idSuffix
}: {
  kind: InAppNotification["kind"];
  threadId: string;
  title: string;
  body: string;
  idSuffix: string;
}): InAppNotification {
  return {
    id: `${kind}:${threadId}:${idSuffix}`,
    kind,
    threadId,
    title,
    body,
    createdAt: Date.now()
  };
}

function upsertInAppNotification(
  notifications: InAppNotification[],
  notification: InAppNotification
): { notifications: InAppNotification[]; shouldAnnounce: boolean } {
  const signature = inAppNotificationSignature(notification);
  const hadDuplicate = notifications.some((entry) => {
    return entry.id === notification.id || inAppNotificationSignature(entry) === signature;
  });
  const next = [
    notification,
    ...notifications.filter((entry) => {
      return entry.id !== notification.id && inAppNotificationSignature(entry) !== signature;
    })
  ].slice(0, 4);
  return {
    notifications: next,
    shouldAnnounce: !hadDuplicate
  };
}

function inAppNotificationSignature(notification: InAppNotification): string {
  return [
    notification.kind,
    notification.threadId,
    notification.title,
    notification.body
  ].join("\u0000");
}

function approvalRequestKey(request: ApprovalRequest): string {
  return [
    request.method,
    request.threadId ?? "",
    request.turnId ?? "",
    request.command ?? "",
    request.reason ?? "",
    stableStringify(request.params)
  ].join("\u0000");
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => {
    return `${JSON.stringify(key)}:${stableStringify(object[key])}`;
  }).join(",")}}`;
}

function showBrowserNotification(notification: InAppNotification): void {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  const options: NotificationOptions = {
    body: notification.body,
    tag: notification.id,
    data: { threadId: notification.threadId }
  };
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.ready
      .then((registration) => registration.showNotification(notification.title, options))
      .catch(() => showWindowNotification(notification, options));
    return;
  }
  showWindowNotification(notification, options);
}

function showWindowNotification(notification: InAppNotification, options: NotificationOptions): void {
  try {
    const browserNotification = new Notification(notification.title, options);
    browserNotification.onclick = () => {
      window.focus();
      browserNotification.close();
      void useRemodexStore.getState().openThread(notification.threadId);
    };
  } catch {
    // Android Chrome requires ServiceWorkerRegistration.showNotification().
  }
}

function terminalOutcomeForNotification(
  method: string,
  params: Record<string, unknown>
): "ready" | "failed" | undefined {
  if (method === "turn/failed") {
    return "failed";
  }
  if (method === "turn/completed") {
    const status = turnStatusToken(params);
    if (status.includes("cancel") || status.includes("abort") || status.includes("interrupt") || status.includes("stop")) {
      return undefined;
    }
    return status.includes("fail") || status.includes("error") ? "failed" : "ready";
  }
  if (!isThreadStatusMethod(method)) {
    return undefined;
  }

  const normalizedStatus = threadStatusToken(params);
  if (!normalizedStatus) {
    return undefined;
  }
  if (normalizedStatus.includes("fail") || normalizedStatus.includes("error")) {
    return "failed";
  }
  if (["idle", "notloaded", "completed", "done", "finished"].includes(normalizedStatus)) {
    return "ready";
  }
  return undefined;
}

function isActiveThreadStatus(method: string, params: Record<string, unknown>): boolean {
  if (!isThreadStatusMethod(method)) {
    return false;
  }
  return ["active", "running", "processing", "inprogress", "started", "pending"].includes(threadStatusToken(params));
}

function isThreadStatusMethod(method: string): boolean {
  return method === "thread/status/changed"
    || method === "thread/status"
    || method === "codex/event/thread_status_changed";
}

function turnStatusToken(params: Record<string, unknown>): string {
  return normalizeStatusToken(
    readString(objectValue(params.turn).status)
      || readString(params.status)
      || readString(objectValue(params.status).type)
      || ""
  );
}

function threadStatusToken(params: Record<string, unknown>): string {
  const event = objectValue(params.event);
  const status = objectValue(params.status);
  const eventStatus = objectValue(event.status);
  return normalizeStatusToken(
    readString(status.type)
      || readString(status.statusType)
      || readString(status.status_type)
      || readString(params.status)
      || readString(event.status)
      || readString(eventStatus.type)
      || readString(eventStatus.statusType)
      || readString(eventStatus.status_type)
      || ""
  );
}

function normalizeStatusToken(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveThreadId(params: Record<string, unknown>): string | undefined {
  const event = objectValue(params.event);
  const thread = objectValue(params.thread);
  const turn = objectValue(params.turn);
  return readString(params.threadId)
    || readString(params.thread_id)
    || readString(params.conversationId)
    || readString(params.conversation_id)
    || readString(thread.id)
    || readString(thread.threadId)
    || readString(thread.thread_id)
    || readString(turn.threadId)
    || readString(turn.thread_id)
    || readString(event.threadId)
    || readString(event.thread_id)
    || readString(event.conversationId)
    || readString(event.conversation_id);
}

function resolveTurnId(params: Record<string, unknown>): string | undefined {
  const event = objectValue(params.event);
  const turn = objectValue(params.turn);
  return readString(params.turnId)
    || readString(params.turn_id)
    || readString(params.id)
    || readString(turn.id)
    || readString(turn.turnId)
    || readString(turn.turn_id)
    || readString(event.id)
    || readString(event.turnId)
    || readString(event.turn_id);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function titleForThread(threads: CodexThread[], threadId: string): string {
  const thread = threads.find((entry) => entry.id === threadId);
  return thread?.title || thread?.name || "Conversation";
}

function renameThreadEntries(threads: CodexThread[], threadId: string, name: string): CodexThread[] {
  return threads.map((thread) => thread.id === threadId ? {
    ...thread,
    title: name,
    name,
    updatedAt: thread.updatedAt ?? Date.now()
  } : thread);
}

function promoteThreadByRecentUse(threads: CodexThread[], threadId: string): CodexThread[] {
  const thread = threads.find((entry) => entry.id === threadId);
  if (!thread) {
    return threads;
  }
  const promoted = {
    ...thread,
    updatedAt: Date.now()
  };
  return [promoted, ...threads.filter((entry) => entry.id !== threadId)];
}

function approvalNotificationBody(request: ApprovalRequest): string {
  if (request.command?.trim()) {
    return `Approval needed: ${request.command.trim()}`;
  }
  if (request.reason?.trim()) {
    return request.reason.trim();
  }
  return "Codex needs approval to continue.";
}

function applyRateLimitsPayload(
  payload: unknown,
  existing: CodexRateLimitBucket[],
  mergeWithExisting: boolean
): CodexRateLimitBucket[] {
  const decodedBuckets = decodeRateLimitBuckets(payload);
  const buckets = mergeWithExisting
    ? mergeRateLimitBuckets(existing, decodedBuckets)
    : decodedBuckets;

  return [...buckets].sort((left, right) => {
    const leftDuration = bucketSortDuration(left);
    const rightDuration = bucketSortDuration(right);
    if (leftDuration === rightDuration) {
      return bucketDisplayLabel(left).localeCompare(bucketDisplayLabel(right), undefined, { sensitivity: "base" });
    }
    return leftDuration - rightDuration;
  });
}

function decodeRateLimitBuckets(payload: unknown): CodexRateLimitBucket[] {
  const payloadObject = objectValue(payload);

  const keyedRaw = payloadObject.rateLimitsByLimitId ?? payloadObject.rate_limits_by_limit_id;
  if (keyedRaw != null) {
    return Object.entries(objectValue(keyedRaw)).flatMap(([limitId, value]) => {
      const bucket = decodeRateLimitBucket(limitId, value);
      return bucket ? [bucket] : [];
    });
  }

  const rateLimitsRaw = payloadObject.rateLimits ?? payloadObject.rate_limits;
  if (rateLimitsRaw != null) {
    const rateLimitsObject = objectValue(rateLimitsRaw);
    if (containsDirectRateLimitWindows(rateLimitsObject)) {
      return decodeDirectRateLimitBuckets(rateLimitsObject);
    }
    const bucket = decodeRateLimitBucket(undefined, rateLimitsRaw);
    return bucket ? [bucket] : [];
  }

  if (payloadObject.result != null) {
    return decodeRateLimitBuckets(payloadObject.result);
  }

  if (containsDirectRateLimitWindows(payloadObject)) {
    return decodeDirectRateLimitBuckets(payloadObject);
  }

  return [];
}

function decodeRateLimitBucket(explicitLimitId: string | undefined, value: unknown): CodexRateLimitBucket | null {
  const object = objectValue(value);
  const primary = decodeRateLimitWindow(object.primary ?? object.primary_window);
  const secondary = decodeRateLimitWindow(object.secondary ?? object.secondary_window);
  if (!primary && !secondary) {
    return null;
  }

  return {
    limitId: firstNonEmptyString([
      explicitLimitId,
      readString(object.limitId),
      readString(object.limit_id),
      readString(object.id)
    ]) ?? randomUUID(),
    limitName: firstNonEmptyString([
      readString(object.limitName),
      readString(object.limit_name),
      readString(object.name)
    ]),
    primary,
    secondary
  };
}

function decodeDirectRateLimitBuckets(object: Record<string, unknown>): CodexRateLimitBucket[] {
  const buckets: CodexRateLimitBucket[] = [];
  const primary = decodeRateLimitWindow(object.primary ?? object.primary_window);
  const secondary = decodeRateLimitWindow(object.secondary ?? object.secondary_window);

  if (primary) {
    buckets.push({
      limitId: "primary",
      limitName: firstNonEmptyString([
        readString(object.limitName),
        readString(object.limit_name),
        readString(object.name)
      ]),
      primary
    });
  }

  if (secondary) {
    buckets.push({
      limitId: "secondary",
      limitName: firstNonEmptyString([
        readString(object.secondaryName),
        readString(object.secondary_name)
      ]),
      primary: secondary
    });
  }

  return buckets;
}

function decodeRateLimitWindow(value: unknown): CodexRateLimitBucket["primary"] {
  const object = objectValue(value);
  if (!Object.keys(object).length) {
    return undefined;
  }

  return {
    usedPercent: readNumber(object.usedPercent) ?? readNumber(object.used_percent) ?? 0,
    windowDurationMins: readNumber(object.windowDurationMins)
      ?? readNumber(object.window_duration_mins)
      ?? readNumber(object.windowMinutes)
      ?? readNumber(object.window_minutes),
    resetsAt: readResetTimestamp(object.resetsAt)
      ?? readResetTimestamp(object.resets_at)
      ?? readResetTimestamp(object.resetAt)
      ?? readResetTimestamp(object.reset_at)
  };
}

function containsDirectRateLimitWindows(object: Record<string, unknown>): boolean {
  return object.primary != null
    || object.secondary != null
    || object.primary_window != null
    || object.secondary_window != null;
}

function mergeRateLimitBuckets(
  existing: CodexRateLimitBucket[],
  incoming: CodexRateLimitBucket[]
): CodexRateLimitBucket[] {
  if (!existing.length) {
    return incoming;
  }
  if (!incoming.length) {
    return existing;
  }

  const merged = new Map(existing.map((bucket) => [bucket.limitId, bucket]));
  for (const bucket of incoming) {
    const current = merged.get(bucket.limitId);
    merged.set(bucket.limitId, current ? {
      limitId: bucket.limitId,
      limitName: bucket.limitName ?? current.limitName,
      primary: bucket.primary ?? current.primary,
      secondary: bucket.secondary ?? current.secondary
    } : bucket);
  }
  return [...merged.values()];
}

function bucketSortDuration(bucket: CodexRateLimitBucket): number {
  return bucket.primary?.windowDurationMins ?? bucket.secondary?.windowDurationMins ?? Number.MAX_SAFE_INTEGER;
}

function bucketDisplayLabel(bucket: CodexRateLimitBucket): string {
  return durationLabel(bucket.primary?.windowDurationMins ?? bucket.secondary?.windowDurationMins)
    ?? bucket.limitName
    ?? bucket.limitId;
}

function durationLabel(minutes: number | undefined): string | undefined {
  if (!minutes || minutes <= 0) {
    return undefined;
  }
  const weekMinutes = 7 * 24 * 60;
  const dayMinutes = 24 * 60;
  if (minutes % weekMinutes === 0) {
    return minutes === weekMinutes ? "Weekly" : `${minutes / weekMinutes}w`;
  }
  if (minutes % dayMinutes === 0) {
    return `${minutes / dayMinutes}d`;
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return `${minutes}m`;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readResetTimestamp(value: unknown): number | undefined {
  const numeric = readNumber(value);
  if (numeric != null) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function firstNonEmptyString(values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim().length > 0);
}

function appendOnce(messages: TimelineMessage[], next: TimelineMessage): TimelineMessage[] {
  if (messages.some((message) => message.text === next.text && message.role === next.role && message.kind === next.kind)) {
    return messages;
  }
  return [...messages, next];
}

function resolvedServerRequestId(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  const object = params as Record<string, unknown>;
  const value = object.requestId ?? object.requestID ?? object.id;
  return value == null ? undefined : idKey(value);
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

function isAccountIdentityUpdate(method: string): boolean {
  return method === "account/updated"
    || method === "account/login/completed";
}

function codedStoreError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function mergeSkillMention(existing: ComposerSkillMention[], mention: ComposerSkillMention): ComposerSkillMention[] {
  if (existing.some((item) => item.id.toLowerCase() === mention.id.toLowerCase())) {
    return existing.map((item) => item.id.toLowerCase() === mention.id.toLowerCase() ? mention : item);
  }
  return [...existing, mention];
}

function mergeMentionMention(existing: ComposerMention[], mention: ComposerMention): ComposerMention[] {
  if (existing.some((item) => item.path === mention.path)) {
    return existing.map((item) => item.path === mention.path ? mention : item);
  }
  return [...existing, mention];
}

function filterSkillMentionsForText(text: string, mentions: ComposerSkillMention[]): ComposerSkillMention[] {
  return mentions.filter((mention) => hasBoundedToken(text, "$", mention.name || mention.id));
}

function filterMentionMentionsForText(text: string, mentions: ComposerMention[]): ComposerMention[] {
  return mentions.filter((mention) => hasBoundedToken(text, "@", mention.name));
}

function hasBoundedToken(text: string, prefix: "$" | "@", rawName: string): boolean {
  const name = rawName.trim();
  if (!name) {
    return false;
  }
  const token = `${prefix}${name}`;
  let index = text.indexOf(token);
  while (index >= 0) {
    const before = index === 0 ? "" : text[index - 1];
    const after = text[index + token.length] ?? "";
    if ((!before || /\s/.test(before)) && (!after || /\s|[.,;:!?)]/.test(after))) {
      return true;
    }
    index = text.indexOf(token, index + token.length);
  }
  return false;
}

function expandComposerCommand(text: string): string {
  const match = text.match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return text;
  }
  const command = match[1].toLowerCase();
  const tail = match[2]?.trim();
  const prompt = commandPrompt(command);
  if (!prompt) {
    return text;
  }
  return tail ? `${prompt}\n\n${tail}` : prompt;
}

function commandPrompt(command: string): string | undefined {
  switch (command) {
    case "review":
      return "Review the current changes. Prioritize bugs, behavioral regressions, security or data-loss risks, and missing tests. Lead with findings and include file/line references when available.";
    case "fix":
      return "Fix the current issue end to end. Inspect the code first, make the necessary targeted changes, and verify the result.";
    case "explain":
      return "Explain the selected code, current behavior, or relevant implementation details clearly and concretely.";
    case "test":
      return "Run or add focused tests for the current issue. Keep the verification scoped to the changed behavior.";
    case "commit":
      return "Prepare a concise commit message for the current changes. Do not create the commit unless explicitly asked.";
    default:
      return undefined;
  }
}
