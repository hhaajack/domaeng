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
  Image as ImageIcon,
  Link,
  ListChecks,
  ListPlus,
  Menu,
  MoreHorizontal,
  Pause,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  Settings,
  ShieldCheck,
  Upload,
  X
} from "lucide-react";
import { Component, useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type {
  ApprovalRequest,
  ContextWindowUsage,
  CodexRateLimitBucket,
  CodexRateLimitDisplayRow,
  CodexThread,
  InAppNotification,
  ModelOption,
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
const EMPTY_DRAFTS: string[] = [];

export function App() {
  const hydrate = useRemodexStore((state) => state.hydrate);
  const connectionStatus = useRemodexStore((state) => state.connectionStatus);

  useEffect(() => {
    const canonicalURL = canonicalTailscaleWebAppURL(window.location.href);
    if (canonicalURL) {
      window.location.replace(canonicalURL);
      return;
    }
    void hydrate();
  }, [hydrate]);

  return (
    <ErrorBoundary>
      <main className="app-shell">
        {connectionStatus === "connected" ? <Workspace /> : <PairingScreen />}
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
                  <h1>Remodex</h1>
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
  const [pairingText, setPairingText] = useState("");
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
            <h1>Remodex</h1>
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
              {entry.mode === "tailscale" ? <ShieldCheck size={18} /> : <GitBranch size={18} />}
              {entry.label}
            </button>
          ))}
        </div>

        <div className="pairing-actions">
          <button className="primary" disabled={busy} onClick={() => setScannerOpen(true)}>
            <Camera size={18} /> Scan
          </button>
          <button disabled={busy} onClick={() => run(reconnectTrusted)}>
            <ShieldCheck size={18} /> Reconnect
          </button>
        </div>

        <details className="advanced-pairing">
          <summary>Paste QR payload</summary>
          <label className="field">
            <span>QR payload</span>
            <textarea
              value={pairingText}
              onChange={(event) => setPairingText(event.target.value)}
              spellCheck={false}
            />
          </label>
          <button className="primary wide" disabled={busy || !pairingText.trim()} onClick={() => run(() => connectFromPairingText(pairingText))}>
            <BadgeCheck size={18} /> Pair
          </button>
        </details>

        <div className="split-fields">
          <label className="field">
            <span>Code</span>
            <input value={pairingCode} onChange={(event) => setPairingCode(event.target.value.toUpperCase())} />
          </label>
          <label className="field">
            <span>Relay URL</span>
            <input value={relayURL} onChange={(event) => setRelayURL(event.target.value)} placeholder="wss://host/relay" />
          </label>
        </div>
        <button disabled={busy || !pairingCode.trim()} onClick={() => run(connectCode)}>
          Connect code
        </button>

        {localError || lastError ? <p className="error-text">{localError || lastError}</p> : null}
      </div>
      {scannerOpen ? <QRScanner onClose={() => setScannerOpen(false)} onPayload={(value) => {
        setScannerOpen(false);
        setPairingText(value);
        void run(() => connectFromPairingText(value));
      }} /> : null}
    </section>
  );
}

function Workspace() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projectOpenByKey, setProjectOpenByKey] = useState<Record<string, boolean>>({});
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
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="brand-lockup">
            <div className="brand-mark small" aria-hidden="true" />
            <strong>Remodex</strong>
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
                    {project.threads.map((thread) => {
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
                            </span>
                            <small>{threadSubtitle(thread, project)}</small>
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
      <span>{thread?.cwd || "Remodex"}</span>
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
            <img key={attachment.id} src={`data:image/jpeg;base64,${attachment.thumbnailBase64JPEG}`} alt="" />
          ))}
        </div>
      ) : null}
      <div className="markdown">
        <ReactMarkdown>{message.text || " "}</ReactMarkdown>
      </div>
    </article>
  );
}

function ApprovalStack() {
  const pendingApprovals = useRemodexStore((state) => state.pendingApprovals);
  const approve = useRemodexStore((state) => state.approve);
  if (!pendingApprovals.length) {
    return null;
  }
  return (
    <div className="approval-stack">
      {pendingApprovals.map((request) => (
        <ApprovalCard key={request.id} request={request} onDecision={(decision) => void approve(request, decision)} />
      ))}
    </div>
  );
}

function ApprovalCard({
  request,
  onDecision
}: {
  request: ApprovalRequest;
  onDecision: (decision: "accept" | "decline" | "acceptForSession") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const title = approvalTitle(request);
  const detail = approvalDetail(request);
  const extraDetail = approvalExtraDetail(request, title);
  const permissionsRequest = request.method === "item/permissions/requestApproval";
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
    </div>
  );
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
    default:
      return request.command || request.method;
  }
}

function approvalDetail(request: ApprovalRequest): string {
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
  const text = useRemodexStore((state) => state.composerText);
  const setText = useRemodexStore((state) => state.setComposerText);
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
  const [openChoiceMenu, setOpenChoiceMenu] = useState<"model" | "reasoning" | null>(null);
  const choiceMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedModel = availableModels.find((model) => model.id === runtimeSettings.model || model.model === runtimeSettings.model);
  const autoReview = runtimeSettings.autoReview === true;
  const accessTitle = autoReview ? "Auto review" : "Default permissions";
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

  return (
    <footer className="composer">
      {lastError ? <p className="composer-error">{lastError}</p> : null}
      <div className="composer-glass">
        {queuedDrafts.length ? (
          <div className="queued-drafts">
            {queuedDrafts.map((draft, index) => (
              <button key={`${draft}-${index}`} onClick={() => activeThreadId && void sendQueuedDraft(activeThreadId, index)}>
                {draft}
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
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={handlePaste}
          placeholder="Ask anything... @plugins, $skills, /commands"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void sendComposer();
            }
          }}
        />
        <div className="composer-bar" ref={choiceMenuRef}>
          <label className="icon-upload" title="Attach image" aria-label="Attach image">
            <ImageIcon size={18} />
            <input type="file" accept="image/*" multiple onChange={(event) => event.target.files && void addFiles(event.target.files)} />
          </label>
          <button
            className={`composer-tool-button plan-button ${runtimeSettings.planMode ? "selected" : ""}`}
            onClick={() => void setRuntimeSettings({ planMode: !runtimeSettings.planMode })}
            title="Plan mode"
          >
            <ListChecks size={16} />
            <span className="button-label">Plan</span>
          </button>
          <div className="composer-choice-wrap model-control">
            <button
              type="button"
              className="composer-choice-button"
              disabled={!availableModels.length}
              title={modelsError || "Model"}
              aria-label="Model"
              aria-haspopup="menu"
              aria-expanded={openChoiceMenu === "model"}
              onClick={() => setOpenChoiceMenu(openChoiceMenu === "model" ? null : "model")}
            >
              <span>{modelButtonLabel}</span>
              <ChevronDown size={14} />
            </button>
            {openChoiceMenu === "model" && availableModels.length ? (
              <div className="composer-popover model-popover" role="menu">
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
                        setOpenChoiceMenu(null);
                      }}
                    >
                      <span>{modelTitle(model)}</span>
                      {selected ? <Check size={14} /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="composer-choice-wrap reasoning-control">
            <button
              type="button"
              className="composer-choice-button"
              title="Reasoning"
              aria-label="Reasoning"
              aria-haspopup="menu"
              aria-expanded={openChoiceMenu === "reasoning"}
              onClick={() => setOpenChoiceMenu(openChoiceMenu === "reasoning" ? null : "reasoning")}
            >
              <span>{reasoningButtonLabel}</span>
              <ChevronDown size={14} />
            </button>
            {openChoiceMenu === "reasoning" ? (
              <div className="composer-popover reasoning-popover" role="menu">
                <button
                  type="button"
                  className={!runtimeSettings.reasoningEffort ? "selected" : ""}
                  role="menuitemradio"
                  aria-checked={!runtimeSettings.reasoningEffort}
                  onClick={() => {
                    void setRuntimeSettings({ reasoningEffort: undefined });
                    setOpenChoiceMenu(null);
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
                        setOpenChoiceMenu(null);
                      }}
                    >
                      <span>{compactTitleForEffort(option.reasoningEffort, option.title)}</span>
                      {selected ? <Check size={14} /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button
            className={`composer-tool-button access-button ${autoReview ? "selected" : ""}`}
            onClick={() => void setRuntimeSettings({ autoReview: !autoReview, accessMode: "onRequest" })}
            title={`Permissions: ${accessTitle}`}
            aria-label={`Change permissions: ${accessTitle}`}
          >
            {autoReview ? <ShieldCheck size={16} /> : <Shield size={16} />}
            <span className="button-label">{autoReview ? "Auto" : "Default"}</span>
          </button>
          <button className="composer-tool-button queue-button" onClick={queueDraft} title="Queue draft">
            <ListPlus size={16} />
            <span className="button-label">Queue</span>
          </button>
          {running ? (
            <button className="danger icon-button" title="Stop" aria-label="Stop" onClick={() => void stopActiveTurn()}><Pause size={18} /></button>
          ) : (
            <button className="primary icon-button send-button" title="Send" aria-label="Send" onClick={() => void sendComposer()}><Send size={18} /></button>
          )}
        </div>
      </div>
    </footer>
  );
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
  const disconnect = useRemodexStore((state) => state.disconnect);
  const webPushBusy = webPushStatus === "checking" || webPushStatus === "subscribing";
  const webPushEnabled = webPushStatus === "enabled";
  const webPushUnavailable = webPushStatus === "unsupported" || webPushStatus === "insecure";
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
        <label className="field">
          <span>Service tier</span>
          <input value={runtimeSettings.serviceTier ?? ""} onChange={(event) => void setRuntimeSettings({ serviceTier: event.target.value || undefined })} />
        </label>
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
            <small>{webPushLabel(webPushStatus, webPushError)}</small>
          </div>
          <button
            className={`icon-button ${webPushEnabled ? "selected" : ""}`}
            disabled={webPushBusy || webPushUnavailable}
            title={webPushEnabled ? "Disable notifications" : "Enable notifications"}
            aria-label={webPushEnabled ? "Disable notifications" : "Enable notifications"}
            onClick={() => void (webPushEnabled ? disableWebPushNotifications() : enableWebPushNotifications())}
          >
            {webPushEnabled ? <Bell size={17} /> : <BellOff size={17} />}
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
  if (status === "insecure") return "HTTPS or localhost required";
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
    return "Camera scanning requires HTTPS or localhost in mobile browsers. Close this sheet and use the pairing code instead, or reopen Remodex over HTTPS.";
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
  return [...groups.values()].sort((left, right) => right.updatedAt - left.updatedAt);
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
  return timeLabel(thread.updatedAt ?? thread.createdAt)
    || thread.status
    || thread.sourceKind
    || project.label;
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
    return value;
  }
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
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
