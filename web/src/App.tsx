import {
  AlertCircle,
  BadgeCheck,
  Bell,
  BellOff,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleCheck,
  Copy,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Hand,
  Image as ImageIcon,
  Link,
  ListChecks,
  ListPlus,
  Menu,
  MoreHorizontal,
  Pause,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Upload,
  X
} from "lucide-react";
import {
  Component,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";
import ReactMarkdown from "react-markdown";
import type {
  ApprovalRequest,
  ContextWindowUsage,
  CodexRateLimitBucket,
  CodexRateLimitDisplayRow,
  CodexThread,
  ImageAttachment,
  InAppNotification,
  JSONValue,
  ModelOption,
  QueuedComposerDraft,
  ThreadRunState,
  TimelineMessage
} from "./types";
import { useRemodexStore } from "./state/useRemodexStore";
import {
  canonicalTailscaleWebAppURL,
  defaultRelayEntryModeFromWebAppLocation,
  normalizeRelayURLInput,
  relayEntryOptionsFromWebAppLocation,
  relayURLFromWebAppLocation
} from "./lib/pairing";

const EMPTY_MESSAGES: TimelineMessage[] = [];
const EMPTY_DRAFTS: QueuedComposerDraft[] = [];
const DEFAULT_PROJECT_THREAD_LIMIT = 8;
const PROJECT_THREAD_INCREMENT = 8;

type ComposerSuggestionKind = "command" | "plugin" | "skill";

type ComposerSuggestion = {
  id: string;
  kind: ComposerSuggestionKind;
  label: string;
  insertText: string;
  description: string;
  skillMention?: { id: string; name?: string; path?: string };
  mentionMention?: { name: string; path: string };
};

type ComposerMentionState = {
  trigger: "/" | "@" | "$";
  kind: ComposerSuggestionKind;
  query: string;
  start: number;
  end: number;
  selectedIndex: number;
};

const COMPOSER_SUGGESTIONS: ComposerSuggestion[] = [
  { id: "command-review", kind: "command", label: "/review", insertText: "/review ", description: "Review current changes" },
  { id: "command-fix", kind: "command", label: "/fix", insertText: "/fix ", description: "Fix the current issue" },
  { id: "command-explain", kind: "command", label: "/explain", insertText: "/explain ", description: "Explain selected code or behavior" },
  { id: "command-test", kind: "command", label: "/test", insertText: "/test ", description: "Run or add focused tests" },
  { id: "command-commit", kind: "command", label: "/commit", insertText: "/commit ", description: "Prepare a commit message or commit" },
  {
    id: "plugin-browser-use",
    kind: "plugin",
    label: "@browser-use",
    insertText: "@browser-use ",
    description: "Use the in-app browser surface",
    mentionMention: { name: "browser-use", path: "plugin://browser-use@openai-bundled" }
  },
  {
    id: "plugin-chrome",
    kind: "plugin",
    label: "@chrome",
    insertText: "@chrome ",
    description: "Use Chrome with the user profile",
    mentionMention: { name: "chrome", path: "plugin://chrome@openai-bundled" }
  },
  {
    id: "plugin-computer-use",
    kind: "plugin",
    label: "@computer-use",
    insertText: "@computer-use ",
    description: "Control local desktop apps",
    mentionMention: { name: "computer-use", path: "plugin://computer-use@openai-bundled" }
  },
  { id: "plugin-github", kind: "plugin", label: "@github", insertText: "@github ", description: "Work with repositories and PRs", mentionMention: { name: "github", path: "plugin://github@openai-curated" } },
  {
    id: "skill-browser",
    kind: "skill",
    label: "$browser-use:browser",
    insertText: "$browser-use:browser ",
    description: "Browser automation workflow"
  },
  {
    id: "skill-imagegen",
    kind: "skill",
    label: "$imagegen",
    insertText: "$imagegen ",
    description: "Generate or edit bitmap images"
  },
  {
    id: "skill-openai-docs",
    kind: "skill",
    label: "$openai-docs",
    insertText: "$openai-docs ",
    description: "Use official OpenAI documentation"
  },
  {
    id: "skill-computer-use",
    kind: "skill",
    label: "$computer-use:computer-use",
    insertText: "$computer-use:computer-use ",
    description: "Operate local Mac apps"
  }
];

export function App() {
  const hydrate = useRemodexStore((state) => state.hydrate);
  const connectionStatus = useRemodexStore((state) => state.connectionStatus);
  const secureState = useRemodexStore((state) => state.secureState);
  const previewMode = localPreviewModeEnabled();
  const hasWorkspaceState = useRemodexStore((state) => state.threads.length > 0 || Boolean(state.activeThreadId));
  const showWorkspace = previewMode
    || connectionStatus === "connected"
    || (secureState === "reconnecting" && hasWorkspaceState);

  useEffect(() => {
    if (previewMode) {
      seedPreviewWorkspace();
      return;
    }

    const canonicalURL = canonicalTailscaleWebAppURL(window.location.href);
    if (canonicalURL) {
      window.location.replace(canonicalURL);
      return;
    }
    void hydrate();
  }, [hydrate, previewMode]);

  return (
    <ErrorBoundary>
      <main className="app-shell">
        {showWorkspace ? <Workspace /> : <PairingScreen />}
      </main>
    </ErrorBoundary>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { message?: string }> {
  state: { message?: string } = {};

  static getDerivedStateFromError(error: unknown): { message: string } {
    return {
      message: error instanceof Error ? error.message : String(error)
    };
  }

  render() {
    if (this.state.message) {
      return (
        <main className="app-shell">
          <section className="pairing-screen">
            <div className="pairing-panel">
              <div className="brand-row">
                <div className="brand-mark" aria-hidden="true" />
                <div>
                  <h1>Domaeng</h1>
                  <p>Runtime error</p>
                </div>
              </div>
              <p className="error-text">{this.state.message}</p>
              <button className="primary wide" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function PairingScreen() {
  const [pairingCode, setPairingCode] = useState("");
  const [relayEntryMode, setRelayEntryMode] = useState(() => defaultRelayEntryModeFromLocation());
  const [relayURL, setRelayURL] = useState(() => defaultRelayURLFromLocation());
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const connectFromPairingText = useRemodexStore((state) => state.connectFromPairingText);
  const connectWithPairingCode = useRemodexStore((state) => state.connectWithPairingCode);
  const connectTrusted = useRemodexStore((state) => state.connectTrusted);
  const lastError = useRemodexStore((state) => state.lastError);
  const secureState = useRemodexStore((state) => state.secureState);
  const scannerOpen = useRemodexStore((state) => state.scannerOpen);
  const setScannerOpen = useRemodexStore((state) => state.setScannerOpen);
  const relayEntries = relayEntryOptionsFromCurrentLocation();
  const previewAvailable = localPreviewModeAvailable();

  async function run(action: () => Promise<void>) {
    setLocalError("");
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function connectCode() {
    const normalizedRelayURL = normalizeRelayURLInput(relayURL);
    setRelayURL(normalizedRelayURL);
    return connectWithPairingCode(pairingCode, normalizedRelayURL);
  }

  function reconnectTrusted() {
    const normalizedRelayURL = normalizeRelayURLInput(relayURL);
    setRelayURL(normalizedRelayURL);
    return connectTrusted(normalizedRelayURL);
  }

  function chooseRelayEntry(mode: "tailscale" | "local") {
    setRelayEntryMode(mode);
    const entry = relayEntries.find((candidate) => candidate.mode === mode);
    if (entry?.relayURL) {
      setRelayURL(entry.relayURL);
    }
  }

  return (
    <section className="pairing-screen">
      <div className="pairing-panel">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Domaeng</h1>
            <p>{secureStateLabel(secureState)}</p>
          </div>
        </div>

        <div className="relay-entry-options">
          {relayEntries.map((entry) => (
            <button
              key={entry.mode}
              className={relayEntryMode === entry.mode ? "selected" : ""}
              disabled={busy || !entry.relayURL}
              onClick={() => chooseRelayEntry(entry.mode)}
            >
              <span className="relay-entry-text">
                <strong>{entry.label}</strong>
                <small>{entry.relayURL || "Unavailable"}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="pairing-code-card">
          <label className="field">
            <span>Code</span>
            <div className="code-input-row">
              <input value={pairingCode} onChange={(event) => setPairingCode(event.target.value.toUpperCase())} />
              <button className="scan-icon-button" type="button" disabled={busy} onClick={() => setScannerOpen(true)} aria-label="Scan QR code" title="Scan QR code">
                <QrCode size={20} />
              </button>
            </div>
          </label>

          <label className="field">
            <span>Relay URL</span>
            <input value={relayURL} onChange={(event) => setRelayURL(event.target.value)} placeholder="wss://host/relay" />
          </label>

          <div className="pairing-actions">
            <button className="primary" disabled={busy || !pairingCode.trim()} onClick={() => run(connectCode)}>
              <BadgeCheck size={18} /> Connect code
            </button>
            <button disabled={busy} onClick={() => run(reconnectTrusted)}>
              <ShieldCheck size={18} /> Reconnect
            </button>
          </div>
        </div>
        {previewAvailable ? (
          <button className="preview-link" disabled={busy} onClick={openPreviewWorkspace}>
            <ListChecks size={18} /> Preview workspace
          </button>
        ) : null}

        {localError || lastError ? <p className="error-text">{localError || lastError}</p> : null}
      </div>
      {scannerOpen ? <QRScanner onClose={() => setScannerOpen(false)} onPayload={(value) => {
        setScannerOpen(false);
        void run(() => connectFromPairingText(value));
      }} /> : null}
    </section>
  );
}

const PREVIEW_THREAD_ID = "preview-web-ui-polish";
const PREVIEW_ROOT = "/workspace/domaeng";

function localPreviewModeEnabled(): boolean {
  if (!localPreviewModeAvailable()) {
    return false;
  }

  try {
    return new URL(window.location.href).searchParams.get("preview") === "1";
  } catch {
    return false;
  }
}

function localPreviewModeAvailable(): boolean {
  return Boolean(import.meta.env.DEV && typeof window !== "undefined");
}

function openPreviewWorkspace() {
  const url = new URL(window.location.href);
  url.searchParams.set("preview", "1");
  window.location.assign(url.toString());
}

function seedPreviewWorkspace() {
  const now = Date.now();
  useRemodexStore.setState({
    connectionStatus: "connected",
    secureState: "encrypted",
    lastError: undefined,
    threads: [
      {
        id: PREVIEW_THREAD_ID,
        title: "Web UI polish pass",
        cwd: PREVIEW_ROOT,
        status: "ready",
        updatedAt: now
      },
      {
        id: "preview-bridge-recovery",
        title: "Bridge pairing recovery",
        cwd: PREVIEW_ROOT,
        status: "running",
        updatedAt: now - 38 * 60 * 1000
      },
      {
        id: "preview-release-notes",
        title: "Local relay release notes",
        cwd: `${PREVIEW_ROOT}/phodex-bridge`,
        status: "ready",
        updatedAt: now - 4 * 60 * 60 * 1000
      }
    ],
    activeThreadId: PREVIEW_THREAD_ID,
    locallyStartedThreadIds: {},
    messagesByThread: {
      [PREVIEW_THREAD_ID]: [
        {
          id: "preview-user-1",
          role: "user",
          kind: "chat",
          threadId: PREVIEW_THREAD_ID,
          text: "帮我检查一下本地 bridge 的连接状态，并总结下一步。",
          createdAt: now - 7 * 60 * 1000
        },
        {
          id: "preview-reasoning-1",
          role: "reasoning",
          kind: "reasoning",
          threadId: PREVIEW_THREAD_ID,
          text: "Inspecting the local runtime state, recent thread activity, and current workspace context.",
          createdAt: now - 6 * 60 * 1000
        },
        {
          id: "preview-assistant-1",
          role: "assistant",
          kind: "chat",
          threadId: PREVIEW_THREAD_ID,
          text: "Bridge is paired over Local LAN. The active thread is scoped to `domaeng`, and no hosted relay is configured.\n\nNext steps:\n\n- Keep the local daemon running.\n- Use the composer to start a new turn.\n- Open Settings when you need to change runtime preferences.",
          createdAt: now - 5 * 60 * 1000
        },
        {
          id: "preview-tool-1",
          role: "tool",
          kind: "command",
          threadId: PREVIEW_THREAD_ID,
          text: "npm run build\n\n✓ built in 1.34s",
          createdAt: now - 4 * 60 * 1000
        }
      ]
    },
    runningTurnByThread: {
      "preview-bridge-recovery": "preview-turn"
    },
    threadRunStateByThread: {
      [PREVIEW_THREAD_ID]: "ready",
      "preview-release-notes": "ready"
    },
    pendingApprovals: [],
    inAppNotifications: [],
    contextWindowUsageByThread: {
      [PREVIEW_THREAD_ID]: {
        tokensUsed: 72400,
        tokenLimit: 200000
      }
    },
    contextWindowUsageLoadedAtByThread: {
      [PREVIEW_THREAD_ID]: now
    },
    contextWindowUsageErrorByThread: {},
    isLoadingContextWindowUsageByThread: {},
    rateLimitBuckets: [
      {
        limitId: "preview-primary",
        limitName: "Primary",
        primary: {
          usedPercent: 42,
          windowDurationMins: 60,
          resetsAt: now + 26 * 60 * 1000
        }
      },
      {
        limitId: "preview-weekly",
        limitName: "Weekly",
        primary: {
          usedPercent: 18,
          windowDurationMins: 7 * 24 * 60,
          resetsAt: now + 3 * 24 * 60 * 60 * 1000
        }
      }
    ],
    rateLimitsError: undefined,
    rateLimitsLoadedAt: now,
    isLoadingRateLimits: false,
    availableModels: [
      {
        id: "local-default",
        model: "local-default",
        displayName: "Local default",
        supportedReasoningEfforts: [
          { id: "low", reasoningEffort: "low", title: "Low" },
          { id: "medium", reasoningEffort: "medium", title: "Medium" },
          { id: "high", reasoningEffort: "high", title: "High" }
        ]
      }
    ],
    modelsError: undefined,
    runtimeSettings: {
      accessMode: "onRequest",
      autoReview: true,
      gitToolbarEnabled: false,
      model: "local-default",
      planMode: false,
      reasoningEffort: "medium"
    },
    composerText: "",
    composerSkillMentions: [],
    composerMentionMentions: [],
    attachments: [],
    queuedDraftsByThread: {
      [PREVIEW_THREAD_ID]: [
        { text: "Polish mobile spacing" },
        { text: "Check relay reconnect copy" }
      ]
    },
    gitStatus: {
      cwd: PREVIEW_ROOT,
      repoRoot: PREVIEW_ROOT,
      branch: "local-preview",
      dirty: true,
      files: [
        { path: "web/src/styles.css", status: "modified" }
      ]
    },
    webPushStatus: "disabled",
    webPushError: undefined,
    settingsOpen: false,
    scannerOpen: false
  });
}

function Workspace() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projectOpenByKey, setProjectOpenByKey] = useState<Record<string, boolean>>({});
  const [projectThreadLimitByKey, setProjectThreadLimitByKey] = useState<Record<string, number>>({});
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [openThreadMenuId, setOpenThreadMenuId] = useState<string | undefined>();
  const [renamingThread, setRenamingThread] = useState<CodexThread | undefined>();
  const [sidebarNotice, setSidebarNotice] = useState("");
  const threadMenuRef = useRef<HTMLDivElement | null>(null);
  const threads = useRemodexStore((state) => state.threads);
  const activeThreadId = useRemodexStore((state) => state.activeThreadId);
  const runningTurnByThread = useRemodexStore((state) => state.runningTurnByThread);
  const threadRunStateByThread = useRemodexStore((state) => state.threadRunStateByThread);
  const pendingApprovals = useRemodexStore((state) => state.pendingApprovals);
  const inAppNotifications = useRemodexStore((state) => state.inAppNotifications);
  const dismissInAppNotification = useRemodexStore((state) => state.dismissInAppNotification);
  const openThread = useRemodexStore((state) => state.openThread);
  const newThread = useRemodexStore((state) => state.newThread);
  const refreshThreads = useRemodexStore((state) => state.refreshThreads);
  const settingsOpen = useRemodexStore((state) => state.settingsOpen);
  const setSettingsOpen = useRemodexStore((state) => state.setSettingsOpen);
  const gitToolbarEnabled = useRemodexStore((state) => state.runtimeSettings.gitToolbarEnabled === true);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const projectGroups = buildProjectGroups(threads);
  const visibleProjectGroups = filterProjectGroups(projectGroups, sidebarSearch);
  const activeProjectKey = activeThread ? projectKeyForThread(activeThread) : projectGroups[0]?.key;
  const activeProject = projectGroups.find((project) => project.key === activeProjectKey);
  const newThreadCwd = activeThread?.cwd || activeProject?.cwd;

  useEffect(() => {
    if (!activeProjectKey) {
      return;
    }
    setProjectOpenByKey((state) => state[activeProjectKey] === false ? { ...state, [activeProjectKey]: true } : state);
  }, [activeProjectKey]);

  useEffect(() => {
    if (!openThreadMenuId) {
      return;
    }

    function closeFromOutside(event: PointerEvent) {
      if (threadMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpenThreadMenuId(undefined);
    }

    function closeFromEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenThreadMenuId(undefined);
      }
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [openThreadMenuId]);

  useEffect(() => {
    if (!openThreadMenuId || threads.some((thread) => thread.id === openThreadMenuId)) {
      return;
    }
    setOpenThreadMenuId(undefined);
  }, [openThreadMenuId, threads]);

  useEffect(() => {
    if (!sidebarNotice) {
      return;
    }
    const timeout = window.setTimeout(() => setSidebarNotice(""), 1600);
    return () => window.clearTimeout(timeout);
  }, [sidebarNotice]);

  useEffect(() => {
    const openExternalThread = (threadId: string) => {
      if (!threadId || threadId === activeThreadId) {
        return;
      }
      setSidebarOpen(false);
      void openThread(threadId);
    };

    openExternalThread(threadIdFromCurrentURL());

    const handleHashChange = () => openExternalThread(threadIdFromCurrentURL());
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; threadId?: string } | undefined;
      if (data?.type === "remodex:openThread" && data.threadId) {
        openExternalThread(data.threadId);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [activeThreadId, openThread]);

  function projectIsOpen(projectKey: string): boolean {
    return projectOpenByKey[projectKey] ?? true;
  }

  function toggleProject(projectKey: string) {
    setProjectOpenByKey((state) => ({
      ...state,
      [projectKey]: !(state[projectKey] ?? true)
    }));
  }

  async function copyThreadValue(value: string, notice: string) {
    if (!value) {
      return;
    }
    try {
      await copyText(value);
      setSidebarNotice(notice);
    } catch (error) {
      setSidebarNotice(error instanceof Error ? error.message : "Copy failed");
    }
  }

  return (
    <section className="workspace">
      {sidebarOpen ? (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="brand-lockup">
            <div className="brand-mark small" aria-hidden="true" />
            <strong>Domaeng</strong>
          </div>
          <button
            title="New chat"
            aria-label="New chat"
            onClick={() => {
              setSidebarOpen(false);
              void newThread(newThreadCwd);
            }}
          >
            <Plus size={18} />
          </button>
          <button title="Refresh" aria-label="Refresh" onClick={() => void refreshThreads()}>
            <RefreshCw size={18} />
          </button>
          <button
            title="Settings"
            aria-label="Settings"
            onClick={() => {
              setSidebarOpen(false);
              setSettingsOpen(true);
            }}
          >
            <Settings size={18} />
          </button>
        </div>
        <label className="sidebar-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={sidebarSearch}
            onChange={(event) => setSidebarSearch(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
          />
        </label>
        {sidebarNotice ? <div className="sidebar-notice" role="status">{sidebarNotice}</div> : null}
        <div className="thread-list">
          {visibleProjectGroups.map((project) => {
            const open = projectIsOpen(project.key);
            const projectActive = project.key === activeProjectKey;
            const projectState = projectThreadState(project.threads, runningTurnByThread, threadRunStateByThread, pendingApprovals);
            const searching = sidebarSearch.trim().length > 0;
            const configuredThreadLimit = projectThreadLimitByKey[project.key] ?? DEFAULT_PROJECT_THREAD_LIMIT;
            let projectThreads = searching
              ? project.threads
              : project.threads.slice(0, configuredThreadLimit);
            if (!searching && activeThreadId && !projectThreads.some((thread) => thread.id === activeThreadId)) {
              const activeProjectThread = project.threads.find((thread) => thread.id === activeThreadId);
              if (activeProjectThread) {
                projectThreads = [...projectThreads, activeProjectThread];
              }
            }
            const hiddenThreadCount = Math.max(0, project.threads.length - projectThreads.length);
            return (
              <section key={project.key} className={`project-group ${projectActive ? "active" : ""}`}>
                <div className="project-row">
                  <button
                    className="project-toggle"
                    aria-expanded={open}
                    onClick={() => toggleProject(project.key)}
                    title={project.path}
                  >
                    {open ? <FolderOpen size={16} /> : <Folder size={16} />}
                    <span className="project-text">
                      <strong>{project.label}</strong>
                      <small>{project.path}</small>
                    </span>
                    <ThreadStateDot state={projectState} />
                    <span className="project-count">{project.threads.length}</span>
                  </button>
                  {project.cwd ? (
                    <button
                      className="project-new"
                      title={`New chat in ${project.label}`}
                      aria-label={`New chat in ${project.label}`}
                      onClick={() => {
                        setSidebarOpen(false);
                        void newThread(project.cwd);
                      }}
                    >
                      <Plus size={15} />
                    </button>
                  ) : null}
                </div>
                {open ? (
                  <div className="project-threads">
                    {projectThreads.map((thread) => {
                      const threadState = threadActivityState(thread.id, runningTurnByThread, threadRunStateByThread, pendingApprovals);
                      const menuOpen = openThreadMenuId === thread.id;
                      return (
                        <div
                          key={thread.id}
                          className="thread-row-shell"
                          ref={menuOpen ? threadMenuRef : undefined}
                        >
                          <button
                            className={`thread-row ${thread.id === activeThreadId ? "selected" : ""}`}
                            onClick={() => {
                              setOpenThreadMenuId(undefined);
                              setSidebarOpen(false);
                              void openThread(thread.id);
                            }}
                          >
                            <span className="thread-title-line">
                              <ThreadStateDot state={threadState} />
                              <span className="thread-row-title">{thread.title || thread.name || "Conversation"}</span>
                              <small>{threadSubtitle(thread, project)}</small>
                            </span>
                          </button>
                          <button
                            className="thread-actions-button"
                            title="Thread actions"
                            aria-label="Thread actions"
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenThreadMenuId((current) => current === thread.id ? undefined : thread.id);
                            }}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {menuOpen ? (
                            <ThreadActionsMenu
                              thread={thread}
                              onRename={() => {
                                setOpenThreadMenuId(undefined);
                                setRenamingThread(thread);
                              }}
                              onCopyLink={() => {
                                setOpenThreadMenuId(undefined);
                                void copyThreadValue(threadURL(thread.id), "Thread link copied");
                              }}
                              onCopyId={() => {
                                setOpenThreadMenuId(undefined);
                                void copyThreadValue(thread.id, "Thread ID copied");
                              }}
                              onCopyCwd={thread.cwd ? () => {
                                setOpenThreadMenuId(undefined);
                                void copyThreadValue(thread.cwd!, "Working directory copied");
                              } : undefined}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                    {hiddenThreadCount > 0 ? (
                      <button
                        className="project-view-more"
                        onClick={() => {
                          setProjectThreadLimitByKey((state) => ({
                            ...state,
                            [project.key]: Math.min(
                              project.threads.length,
                              configuredThreadLimit + PROJECT_THREAD_INCREMENT
                            )
                          }));
                        }}
                      >
                        <span>View more</span>
                        <small>{hiddenThreadCount} hidden</small>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
          {!visibleProjectGroups.length ? (
            <div className="empty-sidebar">
              <strong>{sidebarSearch.trim() ? "No matches" : "No conversations"}</strong>
              <span>{sidebarSearch.trim() ? "Try a different search." : "Start a new thread or refresh after the bridge has loaded Codex history."}</span>
            </div>
          ) : null}
        </div>
        <SidebarUsage />
      </aside>

      <section className="conversation">
        <header className="topbar">
          <button className="mobile-only icon-button" onClick={() => setSidebarOpen(true)} title="Threads" aria-label="Threads">
            <Menu size={20} />
          </button>
          <ThreadTitle />
          {gitToolbarEnabled ? <GitToolbar /> : null}
          <ContextUsageStatus />
        </header>
        <Timeline />
        <ApprovalStack />
        <Composer />
      </section>
      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}
      <NotificationBubbles
        notifications={inAppNotifications}
        onDismiss={dismissInAppNotification}
        onOpen={(threadId) => {
          setSidebarOpen(false);
          void openThread(threadId);
        }}
      />
      {renamingThread ? (
        <RenameThreadSheet
          thread={renamingThread}
          onClose={() => setRenamingThread(undefined)}
        />
      ) : null}
    </section>
  );
}

function ThreadActionsMenu({
  thread,
  onRename,
  onCopyLink,
  onCopyId,
  onCopyCwd
}: {
  thread: CodexThread;
  onRename: () => void;
  onCopyLink: () => void;
  onCopyId: () => void;
  onCopyCwd?: () => void;
}) {
  return (
    <div className="thread-actions-menu" role="menu" aria-label={`Actions for ${thread.title || thread.name || "Conversation"}`}>
      <button role="menuitem" onClick={onRename}>
        <Pencil size={15} />
        <span>Rename</span>
      </button>
      <button role="menuitem" onClick={onCopyLink}>
        <Link size={15} />
        <span>Copy link</span>
      </button>
      <button role="menuitem" onClick={onCopyId}>
        <Copy size={15} />
        <span>Copy ID</span>
      </button>
      {onCopyCwd ? (
        <button role="menuitem" onClick={onCopyCwd}>
          <Folder size={15} />
          <span>Copy cwd</span>
        </button>
      ) : null}
    </div>
  );
}

function RenameThreadSheet({ thread, onClose }: { thread: CodexThread; onClose: () => void }) {
  const renameThread = useRemodexStore((state) => state.renameThread);
  const [value, setValue] = useState(thread.title || thread.name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = value.trim();
    if (!nextName) {
      setError("Thread name is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await renameThread(thread.id, nextName);
      onClose();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop">
      <form className="settings-sheet rename-thread-sheet" onSubmit={submit}>
        <header>
          <h2>Rename thread</h2>
          <button type="button" onClick={onClose} aria-label="Close rename"><X size={18} /></button>
        </header>
        <label className="field">
          <span>Name</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="primary wide" disabled={busy || !value.trim()}>
          Save
        </button>
      </form>
    </div>
  );
}

function SidebarUsage() {
  const rateLimitBuckets = useRemodexStore((state) => state.rateLimitBuckets);
  const isLoadingRateLimits = useRemodexStore((state) => state.isLoadingRateLimits);
  const rateLimitsError = useRemodexStore((state) => state.rateLimitsError);
  const rateLimitsLoadedAt = useRemodexStore((state) => state.rateLimitsLoadedAt);
  const refreshRateLimits = useRemodexStore((state) => state.refreshRateLimits);
  const rows = visibleRateLimitRows(rateLimitBuckets);

  return (
    <section className="sidebar-usage" aria-label="Codex usage">
      <div className="sidebar-usage-header">
        <strong>Codex usage</strong>
        <button
          className="usage-refresh-button"
          title="Refresh usage"
          aria-label="Refresh usage"
          disabled={isLoadingRateLimits}
          onClick={() => void refreshRateLimits()}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {rows.length ? (
        <div className="usage-rows">
          {rows.map((row) => (
            <div className="usage-row" key={row.id}>
              <div className="usage-row-top">
                <span>{row.label}</span>
                <strong>{remainingPercent(row.window.usedPercent)}% left</strong>
              </div>
              <div className="usage-meter" aria-hidden="true">
                <span
                  className={`usage-meter-fill ${usageLevelClass(row.window.usedPercent)}`}
                  style={{ width: `${remainingPercent(row.window.usedPercent)}%` }}
                />
              </div>
              <small>{resetLabel(row.window.resetsAt) ?? "Reset time unavailable"}</small>
            </div>
          ))}
        </div>
      ) : (
        <p>{isLoadingRateLimits ? "Loading usage..." : rateLimitsError || "Usage unavailable"}</p>
      )}

      {rateLimitsLoadedAt ? <span className="usage-updated">Updated {timeOfDayLabel(rateLimitsLoadedAt)}</span> : null}
    </section>
  );
}

interface ProjectGroup {
  key: string;
  label: string;
  path: string;
  cwd?: string;
  updatedAt: number;
  threads: CodexThread[];
}

function ThreadStateDot({ state }: { state?: ThreadRunState }) {
  return state ? <span className={`thread-state-dot ${state}`} aria-hidden="true" /> : null;
}

function NotificationBubbles({
  notifications,
  onDismiss,
  onOpen
}: {
  notifications: InAppNotification[];
  onDismiss: (id: string) => void;
  onOpen: (threadId: string) => void;
}) {
  if (!notifications.length) {
    return null;
  }

  return (
    <div className="notification-bubbles" aria-live="polite">
      {notifications.map((notification) => (
        <article key={notification.id} className={`notification-bubble ${notification.kind}`}>
          <button
            className="bubble-main"
            onClick={() => {
              onDismiss(notification.id);
              onOpen(notification.threadId);
            }}
            title={notification.title}
          >
            {notification.kind === "ready" ? <CircleCheck size={18} /> : <AlertCircle size={18} />}
            <span>
              <strong>{notification.title}</strong>
              <small>{notification.body}</small>
            </span>
          </button>
          <button
            className="bubble-close"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(notification.id)}
          >
            <X size={14} />
          </button>
        </article>
      ))}
    </div>
  );
}

function projectThreadState(
  threads: CodexThread[],
  runningTurnByThread: Record<string, string | undefined>,
  stateByThread: Record<string, ThreadRunState | undefined>,
  pendingApprovals: ApprovalRequest[]
): ThreadRunState | undefined {
  return highestPriorityThreadState(
    threads.map((thread) => threadActivityState(thread.id, runningTurnByThread, stateByThread, pendingApprovals))
  );
}

function threadActivityState(
  threadId: string,
  runningTurnByThread: Record<string, string | undefined>,
  stateByThread: Record<string, ThreadRunState | undefined>,
  pendingApprovals: ApprovalRequest[]
): ThreadRunState | undefined {
  if (pendingApprovals.some((request) => request.threadId === threadId)) {
    return "approval";
  }
  if (runningTurnByThread[threadId]) {
    return "running";
  }
  return stateByThread[threadId];
}

function highestPriorityThreadState(states: Array<ThreadRunState | undefined>): ThreadRunState | undefined {
  for (const state of ["approval", "running", "failed", "ready"] as const) {
    if (states.includes(state)) {
      return state;
    }
  }
  return undefined;
}

function ThreadTitle() {
  const threads = useRemodexStore((state) => state.threads);
  const activeThreadId = useRemodexStore((state) => state.activeThreadId);
  const thread = threads.find((entry) => entry.id === activeThreadId);
  return (
    <div className="thread-title">
      <strong>{thread?.title || thread?.name || "Conversation"}</strong>
      <span>{thread?.cwd || "Domaeng"}</span>
    </div>
  );
}

function ContextUsageStatus() {
  const activeThreadId = useRemodexStore((state) => state.activeThreadId);
  const usage = useRemodexStore((state) => activeThreadId ? state.contextWindowUsageByThread[activeThreadId] : undefined);
  const loadedAt = useRemodexStore((state) => activeThreadId ? state.contextWindowUsageLoadedAtByThread[activeThreadId] : undefined);
  const error = useRemodexStore((state) => activeThreadId ? state.contextWindowUsageErrorByThread[activeThreadId] : undefined);
  const isLoading = useRemodexStore((state) => activeThreadId ? Boolean(state.isLoadingContextWindowUsageByThread[activeThreadId]) : false);
  const refreshContextWindowUsage = useRemodexStore((state) => state.refreshContextWindowUsage);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId || usage || isLoading) {
      return;
    }
    void refreshContextWindowUsage(activeThreadId);
  }, [activeThreadId, usage, isLoading, refreshContextWindowUsage]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeFromOutside(event: PointerEvent) {
      if (wrapRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    }

    function closeFromEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [open]);

  if (!activeThreadId) {
    return null;
  }

  const usedPercent = contextUsedPercent(usage);
  const remainingPercentValue = contextRemainingPercent(usage);
  const level = contextUsageLevelClass(usage);
  const hasUsage = Boolean(usage && usage.tokenLimit > 0);
  const title = hasUsage
    ? `Context ${usedPercent}% used, ${remainingPercentValue}% left`
    : error || "Context usage unavailable";

  return (
    <div className="context-usage-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`context-usage-button ${level} ${isLoading ? "loading" : ""}`}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className="context-usage-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle className="context-usage-track" cx="18" cy="18" r="15.5" />
          <circle
            className="context-usage-value"
            cx="18"
            cy="18"
            r="15.5"
            pathLength={100}
            style={{ strokeDasharray: `${hasUsage ? usedPercent : 0} 100` }}
          />
        </svg>
        <span>{hasUsage ? usedPercent : "--"}</span>
      </button>
      {open ? (
        <div className="context-usage-popover" role="dialog" aria-label="Context usage">
          <div className="context-usage-popover-header">
            <strong>Context</strong>
            <button
              className="usage-refresh-button"
              title="Refresh context"
              aria-label="Refresh context"
              disabled={isLoading}
              onClick={() => void refreshContextWindowUsage(activeThreadId)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="context-usage-summary">
            <span>{hasUsage ? `${usedPercent}% used` : "Unavailable"}</span>
            {hasUsage ? <strong>{remainingPercentValue}% left</strong> : null}
          </div>
          <div className="context-usage-meter" aria-hidden="true">
            <span
              className={`context-usage-meter-fill ${level}`}
              style={{ width: `${hasUsage ? usedPercent : 0}%` }}
            />
          </div>
          <small>
            {hasUsage
              ? `${compactTokenCount(usage!.tokensUsed)} used / ${compactTokenCount(usage!.tokenLimit)} limit`
              : error || (isLoading ? "Loading..." : "Waiting for usage data")}
          </small>
          {loadedAt ? <span className="usage-updated">Updated {timeOfDayLabel(loadedAt)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function Timeline() {
  const activeThreadId = useRemodexStore((state) => state.activeThreadId);
  const messages = useRemodexStore((state) => activeThreadId ? state.messagesByThread[activeThreadId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES);
  const threads = useRemodexStore((state) => state.threads);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  useEffect(() => {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    const frame = window.requestAnimationFrame(() => scrollToLatest("auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [activeThreadId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (stickToBottomRef.current) {
        scrollToLatest("auto");
        return;
      }
      updateTimelineStickiness();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  function updateTimelineStickiness() {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    const distanceToBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
    const nearBottom = distanceToBottom < 120;
    stickToBottomRef.current = nearBottom;
    const nextShow = messages.length > 0 && !nearBottom;
    setShowJumpToLatest((current) => current === nextShow ? current : nextShow);
  }

  function scrollToLatest(behavior: ScrollBehavior = "smooth") {
    bottomRef.current?.scrollIntoView({ block: "end", behavior });
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
  }

  return (
    <div className="timeline-shell">
      <div className="timeline" ref={timelineRef} onScroll={updateTimelineStickiness}>
        {!threads.length ? (
          <div className="empty-state">
            <strong>No conversations yet</strong>
            <span>Use the plus button to create a thread, or refresh after the bridge has loaded Codex history.</span>
          </div>
        ) : activeThreadId && messages.length === 0 ? (
          <div className="empty-state">
            <strong>No messages in this thread</strong>
            <span>Send the first message from the composer.</span>
          </div>
        ) : null}
        {messages.map((message) => <TimelineRow key={message.id} message={message} />)}
        <div ref={bottomRef} />
      </div>
      {showJumpToLatest ? (
        <button
          className="jump-latest-button"
          title="Jump to latest"
          aria-label="Jump to latest"
          onClick={() => scrollToLatest()}
        >
          <ChevronDown size={18} />
        </button>
      ) : null}
    </div>
  );
}

function TimelineRow({ message }: { message: TimelineMessage }) {
  return (
    <article className={`timeline-row ${message.role} ${message.kind}`}>
      <div className="row-meta">
        <span>{labelForMessage(message)}</span>
        {message.streaming ? <span className="live-dot" /> : null}
      </div>
      {message.attachments?.length ? (
        <div className="attachment-strip">
          {message.attachments.map((attachment) => (
            <AttachmentPreview key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
      <div className="markdown">
        <ReactMarkdown>{message.text || " "}</ReactMarkdown>
      </div>
    </article>
  );
}

function AttachmentPreview({ attachment }: { attachment: ImageAttachment }) {
  const src = attachment.thumbnailBase64JPEG
    ? `data:image/jpeg;base64,${attachment.thumbnailBase64JPEG}`
    : attachment.payloadDataURL || attachment.sourceURL || "";
  if (!src || src === "remodex://history-image-elided") {
    return <span className="attachment-elided">Image</span>;
  }
  return <img src={src} alt="" />;
}

function ApprovalStack() {
  const pendingApprovals = useRemodexStore((state) => state.pendingApprovals);
  const approve = useRemodexStore((state) => state.approve);
  const answerUserInput = useRemodexStore((state) => state.answerUserInput);
  if (!pendingApprovals.length) {
    return null;
  }
  return (
    <div className="approval-stack">
      {pendingApprovals.map((request) => (
        <ApprovalCard
          key={request.id}
          request={request}
          onDecision={(decision) => void approve(request, decision)}
          onUserInput={(questionId, answer) => void answerUserInput(request, questionId, answer)}
        />
      ))}
    </div>
  );
}

function ApprovalCard({
  request,
  onDecision,
  onUserInput
}: {
  request: ApprovalRequest;
  onDecision: (decision: "accept" | "decline" | "acceptForSession") => void;
  onUserInput: (questionId: string, answer: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const title = approvalTitle(request);
  const detail = approvalDetail(request);
  const extraDetail = approvalExtraDetail(request, title);
  const permissionsRequest = request.method === "item/permissions/requestApproval";
  const userInputQuestion = userInputApprovalQuestion(request);
  return (
    <div className={`approval-card ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="approval-content"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <strong>{title}</strong>
        <span>{detail}</span>
        {expanded && extraDetail ? <pre>{extraDetail}</pre> : null}
      </button>
      {userInputQuestion ? (
        <div className="approval-actions">
          {userInputQuestion.options.map((option) => (
            <button
              key={option}
              className={option === userInputQuestion.options[0] ? "primary" : undefined}
              onClick={() => onUserInput(userInputQuestion.id, option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <div className="approval-actions">
          <button
            className="icon-button"
            title={permissionsRequest ? "Continue without permissions" : "Decline"}
            aria-label={permissionsRequest ? "Continue without permissions" : "Decline"}
            onClick={() => onDecision("decline")}
          >
            <X size={16} />
          </button>
          <button onClick={() => onDecision("acceptForSession")}>Session</button>
          <button
            className="primary icon-button"
            title={permissionsRequest ? "Allow for this turn" : "Accept"}
            aria-label={permissionsRequest ? "Allow for this turn" : "Accept"}
            onClick={() => onDecision("accept")}
          >
            <Check size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function userInputApprovalQuestion(request: ApprovalRequest): { id: string; question: string; options: string[] } | undefined {
  if (request.method !== "item/tool/requestUserInput" && request.method !== "tool/requestUserInput") {
    return undefined;
  }
  const question = arrayValue(objectValue(request.params).questions)
    .map((value) => objectValue(value))
    .find((value) => typeof value.id === "string" && value.id.trim());
  if (!question || typeof question.id !== "string") {
    return undefined;
  }
  const options = arrayValue(question.options)
    .map((value) => objectValue(value).label)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return {
    id: question.id,
    question: typeof question.question === "string" ? question.question : "Input requested",
    options: options.length ? options : ["Yes"]
  };
}

function approvalTitle(request: ApprovalRequest): string {
  switch (request.method) {
    case "item/permissions/requestApproval":
      return "Permissions";
    case "item/fileChange/requestApproval":
      return "File changes";
    case "item/fileRead/requestApproval":
      return "File read";
    case "item/commandExecution/requestApproval":
      return request.command || "Command";
    case "item/tool/requestUserInput":
    case "tool/requestUserInput":
      return "Input needed";
    default:
      return request.command || request.method;
  }
}

function approvalDetail(request: ApprovalRequest): string {
  const userInputQuestion = userInputApprovalQuestion(request);
  if (userInputQuestion?.question) {
    return userInputQuestion.question;
  }
  if (request.reason) {
    return request.reason;
  }
  if (request.method === "item/permissions/requestApproval") {
    return permissionSummary(request.params);
  }
  return request.threadId || "Approval requested";
}

function approvalExtraDetail(request: ApprovalRequest, title: string): string | undefined {
  if (request.method === "item/permissions/requestApproval") {
    const permissions = objectValue(objectValue(request.params).permissions);
    if (Object.keys(permissions).length > 0) {
      return JSON.stringify(permissions, null, 2);
    }
  } else if (request.command && request.command !== title) {
    return request.command;
  }
  return undefined;
}

function permissionSummary(params: unknown): string {
  const permissions = objectValue(objectValue(params).permissions);
  const parts: string[] = [];
  if (permissions.network != null) {
    parts.push("Network");
  }
  const fileSystem = objectValue(permissions.fileSystem);
  const paths = Array.isArray(fileSystem.paths)
    ? fileSystem.paths.filter((path): path is string => typeof path === "string")
    : [];
  if (paths.length) {
    parts.push(paths.length === 1 ? paths[0] : `${paths.length} paths`);
  } else if (permissions.fileSystem != null) {
    parts.push("File system");
  }
  return parts.length ? parts.join(" + ") : "Additional permissions requested";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function Composer() {
  const activeThreadId = useRemodexStore((state) => state.activeThreadId);
  const activeThread = useRemodexStore((state) => state.threads.find((thread) => thread.id === state.activeThreadId));
  const client = useRemodexStore((state) => state.client);
  const previewMode = localPreviewModeEnabled();
  const text = useRemodexStore((state) => state.composerText);
  const setText = useRemodexStore((state) => state.setComposerText);
  const addComposerSkillMention = useRemodexStore((state) => state.addComposerSkillMention);
  const addComposerMentionMention = useRemodexStore((state) => state.addComposerMentionMention);
  const attachments = useRemodexStore((state) => state.attachments);
  const addFiles = useRemodexStore((state) => state.addFiles);
  const removeAttachment = useRemodexStore((state) => state.removeAttachment);
  const sendComposer = useRemodexStore((state) => state.sendComposer);
  const stopActiveTurn = useRemodexStore((state) => state.stopActiveTurn);
  const queueDraft = useRemodexStore((state) => state.queueDraft);
  const running = useRemodexStore((state) => activeThreadId ? Boolean(state.runningTurnByThread[activeThreadId]) : false);
  const runtimeSettings = useRemodexStore((state) => state.runtimeSettings);
  const setRuntimeSettings = useRemodexStore((state) => state.setRuntimeSettings);
  const availableModels = useRemodexStore((state) => state.availableModels);
  const modelsError = useRemodexStore((state) => state.modelsError);
  const lastError = useRemodexStore((state) => state.lastError);
  const queuedDrafts = useRemodexStore((state) => activeThreadId ? state.queuedDraftsByThread[activeThreadId] ?? EMPTY_DRAFTS : EMPTY_DRAFTS);
  const sendQueuedDraft = useRemodexStore((state) => state.sendQueuedDraft);
  const [openChoiceMenu, setOpenChoiceMenu] = useState<"tools" | "runtime" | "access" | null>(null);
  const [mentionState, setMentionState] = useState<ComposerMentionState | null>(null);
  const [remoteSuggestions, setRemoteSuggestions] = useState<ComposerSuggestion[]>([]);
  const choiceMenuRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedModel = availableModels.find((model) => model.id === runtimeSettings.model || model.model === runtimeSettings.model);
  const autoReview = runtimeSettings.autoReview === true;
  const accessTitle = autoReview ? "Auto-review" : "Default permissions";
  const accessIcon = autoReview ? <ShieldCheck size={16} /> : <Hand size={16} />;
  const mentionSuggestions = mentionState ? filteredComposerSuggestions(mentionState, remoteSuggestions) : [];
  const reasoningOptions = selectedModel?.supportedReasoningEfforts?.length
    ? selectedModel.supportedReasoningEfforts
    : [
        { id: "low", reasoningEffort: "low", title: "Low" },
        { id: "medium", reasoningEffort: "medium", title: "Medium" },
        { id: "high", reasoningEffort: "high", title: "High" },
        { id: "xhigh", reasoningEffort: "xhigh", title: "Extra High" }
      ];
  const selectedReasoning = reasoningOptions.find((option) => option.reasoningEffort === runtimeSettings.reasoningEffort);
  const modelButtonLabel = selectedModel
    ? compactModelTitle(selectedModel)
    : runtimeSettings.model
      ? compactModelText(runtimeSettings.model)
      : "Model";
  const reasoningButtonLabel = selectedReasoning
    ? compactTitleForEffort(selectedReasoning.reasoningEffort, selectedReasoning.title)
    : runtimeSettings.reasoningEffort
      ? compactTitleForEffort(runtimeSettings.reasoningEffort)
      : "Auto";
  const runtimeButtonLabel = `${modelButtonLabel} ${reasoningButtonLabel}`;
  const speedOptions = [
    { id: "default", label: "Default", value: undefined },
    { id: "fast", label: "Fast", value: "fast" }
  ];
  const selectedSpeedId = runtimeSettings.serviceTier?.trim() === "fast" ? "fast" : "default";
  const hasComposerDraft = Boolean(text.trim()) || attachments.length > 0;

  function handlePrimaryComposerAction() {
    if (running) {
      if (hasComposerDraft) {
        queueDraft();
        return;
      }
      void stopActiveTurn();
      return;
    }
    previewMode ? sendPreviewComposer() : void sendComposer();
  }

  const primaryComposerTitle = running
    ? hasComposerDraft ? "Queue draft" : "Stop"
    : "Send";

  useEffect(() => {
    if (!openChoiceMenu) {
      return;
    }

    function closeFromOutside(event: PointerEvent) {
      if (choiceMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpenChoiceMenu(null);
    }

    function closeFromEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenChoiceMenu(null);
      }
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [openChoiceMenu]);

  useEffect(() => {
    if (!mentionState || previewMode || (mentionState.kind !== "skill" && mentionState.kind !== "plugin")) {
      setRemoteSuggestions([]);
      return;
    }

    let cancelled = false;
    const cwds = activeThread?.cwd ? [activeThread.cwd] : undefined;
    const loadSuggestions = mentionState.kind === "skill"
      ? client.listSkills(cwds).then(decodeSkillSuggestions)
      : client.listPlugins(cwds).then(decodePluginSuggestions);

    loadSuggestions
      .then((suggestions) => {
        if (!cancelled) {
          setRemoteSuggestions(suggestions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteSuggestions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeThread?.cwd, client, mentionState?.kind, previewMode]);

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = pastedImageFiles(event.clipboardData);
    if (!files.length) {
      return;
    }
    if (!event.clipboardData.getData("text/plain")) {
      event.preventDefault();
    }
    void addFiles(files);
  }

  function updateComposerText(nextText: string, cursor: number | null) {
    setText(nextText);
    setMentionState(resolveComposerMention(nextText, cursor ?? nextText.length));
  }

  function insertComposerSuggestion(suggestion: ComposerSuggestion) {
    if (!mentionState) {
      return;
    }
    const nextText = `${text.slice(0, mentionState.start)}${suggestion.insertText}${text.slice(mentionState.end)}`;
    const nextCursor = mentionState.start + suggestion.insertText.length;
    setText(nextText);
    if (suggestion.skillMention) {
      addComposerSkillMention(suggestion.skillMention);
    }
    if (suggestion.mentionMention) {
      addComposerMentionMention(suggestion.mentionMention);
    }
    setMentionState(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (mentionState && mentionSuggestions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionState({
          ...mentionState,
          selectedIndex: (mentionState.selectedIndex + 1) % mentionSuggestions.length
        });
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionState({
          ...mentionState,
          selectedIndex: (mentionState.selectedIndex + mentionSuggestions.length - 1) % mentionSuggestions.length
        });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertComposerSuggestion(mentionSuggestions[mentionState.selectedIndex] ?? mentionSuggestions[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionState(null);
        return;
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      previewMode ? sendPreviewComposer() : void sendComposer();
    }
  }

  return (
    <footer className="composer">
      {lastError && !previewMode ? <p className="composer-error">{lastError}</p> : null}
      <div className="composer-glass">
        {queuedDrafts.length ? (
          <div className="queued-drafts">
            {queuedDrafts.map((draft, index) => (
              <button
                key={`${draft.text}-${index}`}
                onClick={() => activeThreadId && (previewMode
                  ? sendPreviewQueuedDraft(activeThreadId, index)
                  : void sendQueuedDraft(activeThreadId, index))}
              >
                {draft.text}
              </button>
            ))}
          </div>
        ) : null}
        {attachments.length ? (
          <div className="attachment-strip composer-attachments">
            {attachments.map((attachment) => (
              <button key={attachment.id} onClick={() => removeAttachment(attachment.id)} aria-label="Remove attachment">
                <img src={`data:image/jpeg;base64,${attachment.thumbnailBase64JPEG}`} alt="" />
                <X size={14} />
              </button>
            ))}
          </div>
        ) : null}
        {mentionState && mentionSuggestions.length ? (
          <div className="composer-suggestion-popover" role="listbox" aria-label="Composer suggestions">
            <div className="composer-suggestion-header">{composerSuggestionTitle(mentionState.kind)}</div>
            {mentionSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                className={index === mentionState.selectedIndex ? "selected" : ""}
                role="option"
                aria-selected={index === mentionState.selectedIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertComposerSuggestion(suggestion)}
              >
                <span>
                  <strong>{suggestion.label}</strong>
                  <small>{suggestion.description}</small>
                </span>
                {index === mentionState.selectedIndex ? <Check size={14} /> : null}
              </button>
            ))}
          </div>
        ) : null}
        {running ? (
          <div className="composer-running-status" role="status" aria-live="polite">
            <RefreshCw size={13} aria-hidden="true" />
            <span>{hasComposerDraft ? "Running - draft ready to queue" : "Running"}</span>
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => updateComposerText(event.target.value, event.target.selectionStart)}
          onClick={(event) => setMentionState(resolveComposerMention(event.currentTarget.value, event.currentTarget.selectionStart))}
          onKeyUp={(event) => {
            if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
              return;
            }
            setMentionState(resolveComposerMention(event.currentTarget.value, event.currentTarget.selectionStart));
          }}
          onPaste={handlePaste}
          placeholder="Ask anything... @plugins, $skills, /commands"
          onKeyDown={handleComposerKeyDown}
        />
        <div className="composer-bar" ref={choiceMenuRef}>
          <div className="composer-choice-wrap tools-control">
            <button
              type="button"
              className={`composer-tool-button composer-icon-tool tools-button ${runtimeSettings.planMode || attachments.length ? "selected" : ""}`}
              title="Add attachment"
              aria-label="Add attachment"
              aria-haspopup="menu"
              aria-expanded={openChoiceMenu === "tools"}
              onClick={() => setOpenChoiceMenu(openChoiceMenu === "tools" ? null : "tools")}
            >
              <Plus size={18} />
            </button>
            <input
              ref={fileInputRef}
              className="composer-file-input"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => event.target.files && void addFiles(event.target.files)}
            />
            {openChoiceMenu === "tools" ? (
              <div className="composer-popover tools-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setOpenChoiceMenu(null);
                  }}
                >
                  <span><ImageIcon size={16} /> Attach image</span>
                </button>
                <button
                  type="button"
                  className={runtimeSettings.planMode ? "selected" : ""}
                  role="menuitemcheckbox"
                  aria-checked={runtimeSettings.planMode}
                  onClick={() => {
                    void setRuntimeSettings({ planMode: !runtimeSettings.planMode });
                  }}
                >
                  <span><ListChecks size={16} /> Plan mode</span>
                  {runtimeSettings.planMode ? <Check size={14} /> : null}
                </button>
              </div>
            ) : null}
          </div>
          <div className="composer-choice-wrap runtime-control">
            <button
              type="button"
              className="composer-choice-button runtime-choice-button"
              disabled={!availableModels.length && Boolean(modelsError)}
              title={modelsError || runtimeButtonLabel}
              aria-label="Model and intelligence"
              aria-haspopup="menu"
              aria-expanded={openChoiceMenu === "runtime"}
              onClick={() => setOpenChoiceMenu(openChoiceMenu === "runtime" ? null : "runtime")}
            >
              <span className="runtime-button-label">
                <strong>{modelButtonLabel}</strong>
                <small>{reasoningButtonLabel}</small>
              </span>
              <ChevronDown size={14} />
            </button>
            {openChoiceMenu === "runtime" ? (
              <div className="composer-popover runtime-popover" role="menu">
                <div className="runtime-popover-grid">
                  <section className="runtime-popover-section">
                    <div className="composer-popover-label">Model</div>
                    {availableModels.map((model) => {
                      const selected = model.id === runtimeSettings.model || model.model === runtimeSettings.model;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={selected ? "selected" : ""}
                          role="menuitemradio"
                          aria-checked={selected}
                          onClick={() => {
                            void setRuntimeSettings({ model: model.id });
                          }}
                        >
                          <span>{modelTitle(model)}</span>
                          {selected ? <Check size={14} /> : null}
                        </button>
                      );
                    })}
                  </section>
                  <section className="runtime-popover-section">
                    <div className="composer-popover-label">Intelligence</div>
                    <button
                      type="button"
                      className={!runtimeSettings.reasoningEffort ? "selected" : ""}
                      role="menuitemradio"
                      aria-checked={!runtimeSettings.reasoningEffort}
                      onClick={() => {
                        void setRuntimeSettings({ reasoningEffort: undefined });
                      }}
                    >
                      <span>Auto</span>
                      {!runtimeSettings.reasoningEffort ? <Check size={14} /> : null}
                    </button>
                    {reasoningOptions.map((option) => {
                      const selected = option.reasoningEffort === runtimeSettings.reasoningEffort;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={selected ? "selected" : ""}
                          role="menuitemradio"
                          aria-checked={selected}
                          onClick={() => {
                            void setRuntimeSettings({ reasoningEffort: option.reasoningEffort });
                          }}
                        >
                          <span>{compactTitleForEffort(option.reasoningEffort, option.title)}</span>
                          {selected ? <Check size={14} /> : null}
                        </button>
                      );
                    })}
                  </section>
                </div>
                <div className="composer-popover-separator" />
                <section className="runtime-speed-section">
                  <div className="composer-popover-label">Speed</div>
                  <div className="runtime-speed-options">
                    {speedOptions.map((option) => {
                      const selected = selectedSpeedId === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={selected ? "selected" : ""}
                          role="menuitemradio"
                          aria-checked={selected}
                          onClick={() => {
                            void setRuntimeSettings({ serviceTier: option.value });
                          }}
                        >
                          <span>{option.label}</span>
                          {selected ? <Check size={14} /> : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
          <div className="composer-choice-wrap access-control">
            <button
              type="button"
              className={`composer-choice-button access-choice-button ${autoReview ? "selected" : ""}`}
              title={`Permissions: ${accessTitle}`}
              aria-label={`Change permissions: ${accessTitle}`}
              aria-haspopup="menu"
              aria-expanded={openChoiceMenu === "access"}
              onClick={() => setOpenChoiceMenu(openChoiceMenu === "access" ? null : "access")}
            >
              {accessIcon}
              <span>{accessTitle}</span>
              <ChevronDown size={14} />
            </button>
            {openChoiceMenu === "access" ? (
              <div className="composer-popover access-popover" role="menu">
                <button
                  type="button"
                  className={!autoReview ? "selected" : ""}
                  role="menuitemradio"
                  aria-checked={!autoReview}
                  onClick={() => {
                    void setRuntimeSettings({ autoReview: false, accessMode: "onRequest" });
                  }}
                >
                  <span><Hand size={16} /> Default permissions</span>
                  {!autoReview ? <Check size={14} /> : null}
                </button>
                <button
                  type="button"
                  className={autoReview ? "selected" : ""}
                  role="menuitemradio"
                  aria-checked={autoReview}
                  onClick={() => {
                    void setRuntimeSettings({ autoReview: true, accessMode: "onRequest" });
                  }}
                >
                  <span><ShieldCheck size={16} /> Auto-review</span>
                  {autoReview ? <Check size={14} /> : null}
                </button>
              </div>
            ) : null}
          </div>
          <button
            className={`${running && !hasComposerDraft ? "danger" : "primary"} icon-button send-button`}
            title={primaryComposerTitle}
            aria-label={primaryComposerTitle}
            onClick={handlePrimaryComposerAction}
          >
            {running ? (hasComposerDraft ? <ListPlus size={18} /> : <Pause size={18} />) : <Send size={18} />}
          </button>
        </div>
      </div>
    </footer>
  );
}

function resolveComposerMention(value: string, cursor: number): ComposerMentionState | null {
  let start = cursor;
  while (start > 0 && !/\s/.test(value[start - 1])) {
    start -= 1;
  }

  const token = value.slice(start, cursor);
  if (!/^[\/@$][\w-]*$/.test(token)) {
    return null;
  }

  const trigger = token[0] as "/" | "@" | "$";
  const kind = trigger === "/"
    ? "command"
    : trigger === "@"
      ? "plugin"
      : "skill";
  return {
    trigger,
    kind,
    query: token.slice(1).toLowerCase(),
    start,
    end: cursor,
    selectedIndex: 0
  };
}

function filteredComposerSuggestions(mention: ComposerMentionState, remoteSuggestions: ComposerSuggestion[] = []): ComposerSuggestion[] {
  const query = mention.query.trim().toLowerCase();
  const source = remoteSuggestions.some((suggestion) => suggestion.kind === mention.kind)
    ? remoteSuggestions
    : COMPOSER_SUGGESTIONS;
  return source
    .filter((suggestion) => suggestion.kind === mention.kind)
    .filter((suggestion) => {
      if (!query) {
        return true;
      }
      const label = suggestion.label.slice(1).toLowerCase();
      return label.includes(query) || suggestion.description.toLowerCase().includes(query);
    })
    .slice(0, 6);
}

function composerSuggestionTitle(kind: ComposerSuggestionKind): string {
  if (kind === "command") {
    return "Commands";
  }
  if (kind === "plugin") {
    return "Plugins";
  }
  return "Skills";
}

function decodeSkillSuggestions(result: JSONValue): ComposerSuggestion[] {
  const buckets = arrayValue(objectValue(result).data);
  const flatSkills = [
    ...arrayValue(objectValue(result).skills),
    ...buckets.flatMap((bucket) => arrayValue(objectValue(bucket).skills))
  ];
  const seen = new Set<string>();
  return flatSkills.flatMap((value) => {
    const skill = objectValue(value);
    if (skill.enabled === false) {
      return [];
    }
    const name = stringValue(skill.name);
    if (!name || seen.has(name.toLowerCase())) {
      return [];
    }
    seen.add(name.toLowerCase());
    const path = stringValue(skill.path);
    const interfaceObject = objectValue(skill.interface);
    const skillMention = path ? { id: name, name, path } : undefined;
    return [{
      id: `skill-${name}`,
      kind: "skill" as const,
      label: `$${name}`,
      insertText: `$${name} `,
      description: stringValue(interfaceObject.shortDescription) || stringValue(skill.description) || "Use this Codex skill",
      skillMention
    }];
  });
}

function decodePluginSuggestions(result: JSONValue): ComposerSuggestion[] {
  const marketplaces = arrayValue(objectValue(result).marketplaces);
  const seen = new Set<string>();
  return marketplaces.flatMap((marketplaceValue) => {
    const marketplace = objectValue(marketplaceValue);
    const marketplaceName = stringValue(marketplace.name);
    if (!marketplaceName) {
      return [];
    }
    return arrayValue(marketplace.plugins).flatMap((pluginValue) => {
      const plugin = objectValue(pluginValue);
      const name = stringValue(plugin.name);
      const mentionPath = name ? `plugin://${name}@${marketplaceName}` : "";
      if (!name || seen.has(mentionPath)) {
        return [];
      }
      const available = plugin.installed === true
        || plugin.enabled === true
        || stringValue(plugin.installPolicy) === "INSTALLED_BY_DEFAULT";
      if (!available) {
        return [];
      }
      seen.add(mentionPath);
      const interfaceObject = objectValue(plugin.interface);
      return [{
        id: `plugin-${mentionPath}`,
        kind: "plugin" as const,
        label: `@${name}`,
        insertText: `@${name} `,
        description: stringValue(interfaceObject.shortDescription) || stringValue(plugin.shortDescription) || "Use this Codex plugin",
        mentionMention: {
          name,
          path: mentionPath
        }
      }];
    });
  });
}

function arrayValue(value: unknown): JSONValue[] {
  return Array.isArray(value) ? value as JSONValue[] : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sendPreviewComposer() {
  const state = useRemodexStore.getState();
  const activeThreadId = state.activeThreadId;
  const text = state.composerText.trim();
  if (!activeThreadId || (!text && state.attachments.length === 0)) {
    return;
  }
  appendPreviewExchange(activeThreadId, text || "Preview attachment", {
    composerText: "",
    composerSkillMentions: [],
    composerMentionMentions: [],
    attachments: []
  });
}

function sendPreviewQueuedDraft(threadId: string, index: number) {
  const draft = useRemodexStore.getState().queuedDraftsByThread[threadId]?.[index];
  if (!draft?.text) {
    return;
  }
  appendPreviewExchange(threadId, draft.text, {
    queuedDraftsByThread: {
      ...useRemodexStore.getState().queuedDraftsByThread,
      [threadId]: (useRemodexStore.getState().queuedDraftsByThread[threadId] ?? []).filter((_, entryIndex) => entryIndex !== index)
    }
  });
}

function appendPreviewExchange(threadId: string, text: string, patch: Partial<ReturnType<typeof useRemodexStore.getState>>) {
  const now = Date.now();
  useRemodexStore.setState((state) => ({
    ...patch,
    lastError: undefined,
    messagesByThread: {
      ...state.messagesByThread,
      [threadId]: [
        ...(state.messagesByThread[threadId] ?? []),
        {
          id: previewId("user"),
          role: "user",
          kind: "chat",
          threadId,
          text,
          createdAt: now
        },
        {
          id: previewId("assistant"),
          role: "assistant",
          kind: "chat",
          threadId,
          text: "Preview response. This mode is local-only and does not contact the bridge.",
          createdAt: now + 1
        }
      ]
    },
    threadRunStateByThread: {
      ...state.threadRunStateByThread,
      [threadId]: "ready"
    }
  }));
}

function previewId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pastedImageFiles(data: DataTransfer): File[] {
  const fromItems = Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const fromFiles = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
  const seen = new Set<string>();
  return [...fromItems, ...fromFiles].filter((file) => {
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function GitToolbar() {
  const gitStatus = useRemodexStore((state) => state.gitStatus);
  const refreshGitStatus = useRemodexStore((state) => state.refreshGitStatus);
  const commit = useRemodexStore((state) => state.commit);
  const push = useRemodexStore((state) => state.push);
  const pull = useRemodexStore((state) => state.pull);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refreshGitStatus();
  }, [refreshGitStatus]);

  return (
    <div className="git-toolbar">
      <button className="icon-button git-status-button" title="Git status" aria-label="Git status" onClick={() => void refreshGitStatus()}>
        <GitBranch size={18} />
      </button>
      <span>{gitStatus?.branch || gitStatus?.state || "git"}</span>
      <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Commit message" />
      <button
        className="git-commit-button"
        title="Commit"
        disabled={!message.trim()}
        onClick={() => void commit(message.trim()).then(() => setMessage(""))}
      >
        <GitCommitHorizontal size={16} />
        <span className="button-label">Commit</span>
      </button>
      <button className="icon-button" title="Push" aria-label="Push" onClick={() => void push()}><Upload size={16} /></button>
      <button className="icon-button" title="Pull" aria-label="Pull" onClick={() => void pull()}><ChevronLeft size={16} /></button>
    </div>
  );
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const runtimeSettings = useRemodexStore((state) => state.runtimeSettings);
  const setRuntimeSettings = useRemodexStore((state) => state.setRuntimeSettings);
  const refreshGitStatus = useRemodexStore((state) => state.refreshGitStatus);
  const availableModels = useRemodexStore((state) => state.availableModels);
  const webPushStatus = useRemodexStore((state) => state.webPushStatus);
  const webPushError = useRemodexStore((state) => state.webPushError);
  const enableWebPushNotifications = useRemodexStore((state) => state.enableWebPushNotifications);
  const disableWebPushNotifications = useRemodexStore((state) => state.disableWebPushNotifications);
  const refreshWebPushStatus = useRemodexStore((state) => state.refreshWebPushStatus);
  const disconnect = useRemodexStore((state) => state.disconnect);
  const webPushBusy = webPushStatus === "checking" || webPushStatus === "subscribing";
  const webPushEnabled = webPushStatus === "enabled";
  const webPushUnavailable = webPushStatus === "unsupported";
  const browserNotificationPermission = typeof window !== "undefined" && "Notification" in window
    ? Notification.permission
    : "unsupported";
  const browserAlertsEnabled = browserNotificationPermission === "granted";
  const notificationsEnabled = webPushEnabled || (webPushStatus === "insecure" && browserAlertsEnabled);
  const notificationLabel = webPushStatus === "insecure"
    ? (browserAlertsEnabled ? "Browser alerts enabled; push needs HTTPS" : "Enable browser alerts; push needs HTTPS")
    : webPushLabel(webPushStatus, webPushError);
  async function toggleNotifications() {
    if (webPushStatus === "insecure") {
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      await refreshWebPushStatus();
      return;
    }
    await (webPushEnabled ? disableWebPushNotifications() : enableWebPushNotifications());
  }
  async function setGitToolbarEnabled(enabled: boolean) {
    await setRuntimeSettings({ gitToolbarEnabled: enabled });
    if (enabled) {
      await refreshGitStatus();
    }
  }
  return (
    <div className="sheet-backdrop">
      <section className="settings-sheet">
        <header>
          <h2>Settings</h2>
          <button onClick={onClose} aria-label="Close settings"><X size={18} /></button>
        </header>
        <label className="field">
          <span>Model</span>
          {availableModels.length ? (
            <select value={runtimeSettings.model ?? ""} onChange={(event) => void setRuntimeSettings({ model: event.target.value || undefined })}>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>{modelTitle(model)}</option>
              ))}
            </select>
          ) : (
            <input value={runtimeSettings.model ?? ""} onChange={(event) => void setRuntimeSettings({ model: event.target.value || undefined })} />
          )}
        </label>
        <div className="field">
          <span>Service tier (optional)</span>
          <div className="segmented-control" role="radiogroup" aria-label="Service tier">
            <button
              type="button"
              className={!runtimeSettings.serviceTier ? "selected" : ""}
              role="radio"
              aria-checked={!runtimeSettings.serviceTier}
              onClick={() => void setRuntimeSettings({ serviceTier: undefined })}
            >
              Standard
            </button>
            <button
              type="button"
              className={runtimeSettings.serviceTier === "fast" ? "selected" : ""}
              role="radio"
              aria-checked={runtimeSettings.serviceTier === "fast"}
              onClick={() => void setRuntimeSettings({ serviceTier: "fast" })}
            >
              Fast
            </button>
          </div>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={runtimeSettings.autoReview === true}
            onChange={(event) => void setRuntimeSettings({ autoReview: event.target.checked, accessMode: "onRequest" })}
          />
          <span>Auto review</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={runtimeSettings.gitToolbarEnabled === true}
            onChange={(event) => void setGitToolbarEnabled(event.target.checked)}
          />
          <span>Git toolbar</span>
        </label>
        <div className="push-settings-row">
          <div>
            <span>Notifications</span>
            <small>{notificationLabel}</small>
          </div>
          <button
            className={`icon-button ${notificationsEnabled ? "selected" : ""}`}
            disabled={webPushBusy || webPushUnavailable}
            title={notificationsEnabled ? "Notifications enabled" : "Enable notifications"}
            aria-label={notificationsEnabled ? "Notifications enabled" : "Enable notifications"}
            onClick={() => void toggleNotifications()}
          >
            {notificationsEnabled ? <Bell size={17} /> : <BellOff size={17} />}
          </button>
        </div>
        <button className="danger wide" onClick={disconnect}>Disconnect</button>
      </section>
    </div>
  );
}

function webPushLabel(status: string, error?: string): string {
  if (status === "enabled") return "Enabled";
  if (status === "subscribing") return "Updating...";
  if (status === "checking") return "Checking...";
  if (status === "insecure") return "Push requires HTTPS; live browser alerts still work";
  if (status === "unsupported") return "Unsupported";
  if (status === "error") return error || "Failed";
  return "Off";
}

function QRScanner({ onClose, onPayload }: { onClose: () => void; onPayload: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    async function start() {
      try {
        if (!canUseCameraScanner()) {
          setError(cameraUnavailableMessage());
          return;
        }

        const detectorCtor = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
        if (!detectorCtor) {
          setError("QR scanning is not supported by this browser. Use the pairing code instead.");
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!videoRef.current) {
          return;
        }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        const detector = new detectorCtor({ formats: ["qr_code"] });
        while (!stopped && videoRef.current) {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) {
            onPayload(codes[0].rawValue);
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      } catch (scanError) {
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
        setCameraActive(false);
        setError(cameraErrorMessage(scanError));
      }
    }
    void start();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onPayload]);

  return (
    <div className="sheet-backdrop">
      <section className="scanner-sheet">
        <header>
          <h2>Scan</h2>
          <button onClick={onClose} aria-label="Close scanner"><X size={18} /></button>
        </header>
        {error ? (
          <div className="scanner-placeholder">
            <Camera size={28} />
            <p>{error}</p>
          </div>
        ) : (
          <video ref={videoRef} className={cameraActive ? "active" : ""} muted playsInline />
        )}
        {error ? <button className="wide" onClick={onClose}>Use code instead</button> : null}
      </section>
    </div>
  );
}

function defaultRelayURLFromLocation(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const entries = relayEntryOptionsFromWebAppLocation(window.location.href);
    const defaultMode = defaultRelayEntryModeFromWebAppLocation(window.location.href);
    return entries.find((entry) => entry.mode === defaultMode)?.relayURL
      || relayURLFromWebAppLocation(window.location.href);
  } catch {
    return "";
  }
}

function defaultRelayEntryModeFromLocation(): "tailscale" | "local" {
  if (typeof window === "undefined") {
    return "local";
  }

  try {
    return defaultRelayEntryModeFromWebAppLocation(window.location.href);
  } catch {
    return "local";
  }
}

function relayEntryOptionsFromCurrentLocation() {
  if (typeof window === "undefined") {
    return [
      { mode: "tailscale" as const, label: "Tailscale", relayURL: "" },
      { mode: "local" as const, label: "Local LAN", relayURL: "" }
    ];
  }

  try {
    return relayEntryOptionsFromWebAppLocation(window.location.href);
  } catch {
    return [
      { mode: "tailscale" as const, label: "Tailscale", relayURL: "" },
      { mode: "local" as const, label: "Local LAN", relayURL: "" }
    ];
  }
}

function threadIdFromCurrentURL(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const fromHash = hashParams.get("thread")?.trim();
    if (fromHash) {
      return fromHash;
    }
    const url = new URL(window.location.href);
    return url.searchParams.get("threadId")?.trim() || "";
  } catch {
    return "";
  }
}

function canUseCameraScanner(): boolean {
  return Boolean(
    window.isSecureContext
      && navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

function cameraUnavailableMessage(): string {
  if (!window.isSecureContext) {
    return "Camera scanning requires HTTPS or localhost in mobile browsers. Close this sheet and use the pairing code instead, or reopen Domaeng over HTTPS.";
  }

  return "Camera access is not available in this browser. Use the pairing code instead.";
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Camera permission was denied. Allow camera access or use the pairing code instead.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Camera scanning failed. Use the pairing code instead.";
}

function labelForMessage(message: TimelineMessage): string {
  if (message.role === "user") return "You";
  if (message.kind === "reasoning") return "Reasoning";
  if (message.kind === "command") return "Command";
  if (message.kind === "fileChange") return "Files";
  if (message.kind === "diff") return "Diff";
  if (message.kind === "plan") return "Plan";
  if (message.kind === "image") return "Image";
  return message.role === "assistant" ? "Codex" : "System";
}

function visibleRateLimitRows(buckets: CodexRateLimitBucket[]): CodexRateLimitDisplayRow[] {
  const dedupedByLabel = new Map<string, CodexRateLimitDisplayRow>();
  for (const row of buckets.flatMap(displayRowsForBucket)) {
    const current = dedupedByLabel.get(row.label);
    dedupedByLabel.set(row.label, current ? preferredRateLimitRow(current, row) : row);
  }

  return [...dedupedByLabel.values()].sort((left, right) => {
    const leftDuration = left.window.windowDurationMins ?? Number.MAX_SAFE_INTEGER;
    const rightDuration = right.window.windowDurationMins ?? Number.MAX_SAFE_INTEGER;
    if (leftDuration === rightDuration) {
      return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    }
    return leftDuration - rightDuration;
  });
}

function displayRowsForBucket(bucket: CodexRateLimitBucket): CodexRateLimitDisplayRow[] {
  const fallback = bucket.limitName || bucket.limitId;
  const rows: CodexRateLimitDisplayRow[] = [];
  if (bucket.primary) {
    rows.push({
      id: `${bucket.limitId}-primary`,
      label: durationLabel(bucket.primary.windowDurationMins) ?? fallback,
      window: bucket.primary
    });
  }
  if (bucket.secondary) {
    rows.push({
      id: `${bucket.limitId}-secondary`,
      label: durationLabel(bucket.secondary.windowDurationMins) ?? fallback,
      window: bucket.secondary
    });
  }
  return rows;
}

function preferredRateLimitRow(
  current: CodexRateLimitDisplayRow,
  candidate: CodexRateLimitDisplayRow
): CodexRateLimitDisplayRow {
  const currentUsed = clampedPercent(current.window.usedPercent);
  const candidateUsed = clampedPercent(candidate.window.usedPercent);
  if (currentUsed !== candidateUsed) {
    return candidateUsed > currentUsed ? candidate : current;
  }
  if (current.window.resetsAt == null) {
    return candidate.window.resetsAt == null ? current : candidate;
  }
  if (candidate.window.resetsAt == null) {
    return current;
  }
  return candidate.window.resetsAt < current.window.resetsAt ? candidate : current;
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

function remainingPercent(usedPercent: number): number {
  return Math.max(0, 100 - clampedPercent(usedPercent));
}

function contextUsedPercent(usage: ContextWindowUsage | undefined): number {
  if (!usage || usage.tokenLimit <= 0) {
    return 0;
  }
  return clampedPercent((usage.tokensUsed / usage.tokenLimit) * 100);
}

function contextRemainingPercent(usage: ContextWindowUsage | undefined): number {
  return Math.max(0, 100 - contextUsedPercent(usage));
}

function clampedPercent(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function usageLevelClass(usedPercent: number): string {
  const clamped = clampedPercent(usedPercent);
  if (clamped >= 90) {
    return "high";
  }
  if (clamped >= 70) {
    return "medium";
  }
  return "normal";
}

function contextUsageLevelClass(usage: ContextWindowUsage | undefined): string {
  if (!usage || usage.tokenLimit <= 0) {
    return "unknown";
  }
  const usedPercent = contextUsedPercent(usage);
  if (usedPercent >= 85) {
    return "high";
  }
  if (usedPercent >= 65) {
    return "medium";
  }
  return "normal";
}

function resetLabel(value: number | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "2-digit", minute: "2-digit", hour12: false }
    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false };
  return `resets ${date.toLocaleString(undefined, options)}`;
}

function timeOfDayLabel(value: number): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function compactTokenCount(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  if (rounded >= 1_000_000) {
    return `${formatCompactNumber(rounded / 1_000_000)}M`;
  }
  if (rounded >= 1_000) {
    return `${formatCompactNumber(rounded / 1_000)}K`;
  }
  return String(rounded);
}

function formatCompactNumber(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}

function buildProjectGroups(threads: CodexThread[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const thread of threads) {
    const key = projectKeyForThread(thread);
    const cwd = thread.cwd?.trim();
    const existing = groups.get(key);
    const updatedAt = timestampValue(thread.updatedAt ?? thread.createdAt);
    if (existing) {
      existing.threads.push(thread);
      existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
      continue;
    }
    groups.set(key, {
      key,
      label: cwd ? projectName(cwd) : "No Project",
      path: cwd || "Threads without a project folder",
      cwd,
      updatedAt,
      threads: [thread]
    });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      threads: [...group.threads].sort((left, right) =>
        timestampValue(right.updatedAt ?? right.createdAt) - timestampValue(left.updatedAt ?? left.createdAt)
      )
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function filterProjectGroups(projectGroups: ProjectGroup[], query: string): ProjectGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return projectGroups;
  }

  return projectGroups.flatMap((project) => {
    if (projectSearchText(project).includes(normalizedQuery)) {
      return [project];
    }
    const threads = project.threads.filter((thread) => threadSearchText(thread).includes(normalizedQuery));
    return threads.length ? [{
      ...project,
      threads
    }] : [];
  });
}

function projectSearchText(project: ProjectGroup): string {
  return [
    project.label,
    project.path
  ].join(" ").toLowerCase();
}

function threadSearchText(thread: CodexThread): string {
  return [
    thread.title,
    thread.name,
    thread.cwd,
    thread.status,
    thread.sourceKind,
    thread.id
  ].filter(Boolean).join(" ").toLowerCase();
}

function projectKeyForThread(thread: CodexThread): string {
  return thread.cwd?.trim() || "__no_project__";
}

function projectName(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  if (!normalized || normalized === "/") {
    return path;
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function threadSubtitle(thread: CodexThread, project: ProjectGroup): string {
  if (!project.cwd && thread.cwd) {
    return thread.cwd;
  }
  return timeLabel(threadCreatedAt(thread))
    || thread.status
    || thread.sourceKind
    || project.label;
}

function threadCreatedAt(thread: CodexThread): string | number | undefined {
  return timestampFromUUIDv7(thread.id) || thread.createdAt;
}

function timeLabel(value: string | number | undefined): string | undefined {
  const timestamp = timestampValue(value);
  if (!timestamp) {
    return undefined;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timestampValue(value: string | number | undefined): number {
  if (typeof value === "number") {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (!value) {
    return 0;
  }
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && value.trim() === String(numericValue)) {
    return numericValue > 10_000_000_000 ? numericValue : numericValue * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function timestampFromUUIDv7(value: string | undefined): number {
  const normalized = value?.replaceAll("-", "") ?? "";
  if (!/^[0-9a-f]{32}$/i.test(normalized) || normalized[12].toLowerCase() !== "7") {
    return 0;
  }
  const timestamp = Number.parseInt(normalized.slice(0, 12), 16);
  const latestReasonableCreation = Date.now() + 24 * 60 * 60 * 1000;
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= latestReasonableCreation
    ? timestamp
    : 0;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard is unavailable.");
    }
  } finally {
    document.body.removeChild(textArea);
  }
}

function threadURL(threadId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("threadId");
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  hashParams.set("thread", threadId);
  url.hash = hashParams.toString();
  return url.toString();
}

function secureStateLabel(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function modelTitle(model: ModelOption): string {
  return model.displayName || model.model || model.id;
}

function compactModelTitle(model: ModelOption): string {
  return compactModelText(modelTitle(model));
}

function compactModelText(value: string): string {
  return value.replace(/^gpt[-\s]?/i, "");
}

function titleForEffort(effort: string): string {
  if (effort === "xhigh") return "Extra High";
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

function compactTitleForEffort(effort: string, title?: string): string {
  if (effort === "xhigh") return "xHigh";
  const resolvedTitle = title || titleForEffort(effort);
  if (resolvedTitle === "Extra High") return "xHigh";
  return resolvedTitle;
}
