import {
  BadgeCheck,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  GitBranch,
  GitCommitHorizontal,
  Image as ImageIcon,
  ListChecks,
  ListPlus,
  Menu,
  Pause,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Settings,
  ShieldCheck,
  Upload,
  X
} from "lucide-react";
import { Component, useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { ApprovalRequest, ModelOption, TimelineMessage } from "./types";
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
  const threads = useRemodexStore((state) => state.threads);
  const activeThreadId = useRemodexStore((state) => state.activeThreadId);
  const openThread = useRemodexStore((state) => state.openThread);
  const newThread = useRemodexStore((state) => state.newThread);
  const refreshThreads = useRemodexStore((state) => state.refreshThreads);
  const settingsOpen = useRemodexStore((state) => state.settingsOpen);
  const setSettingsOpen = useRemodexStore((state) => state.setSettingsOpen);

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
              void newThread();
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
        <div className="thread-list">
          {threads.map((thread) => (
            <button
              key={thread.id}
              className={`thread-row ${thread.id === activeThreadId ? "selected" : ""}`}
              onClick={() => {
                setSidebarOpen(false);
                void openThread(thread.id);
              }}
            >
              <span>{thread.title || thread.name || "Conversation"}</span>
              <small>{thread.cwd || thread.sourceKind || thread.status || "local"}</small>
            </button>
          ))}
          {!threads.length ? (
            <div className="empty-sidebar">
              <strong>No conversations</strong>
              <span>Start a new thread or refresh after the bridge has loaded Codex history.</span>
            </div>
          ) : null}
        </div>
      </aside>

      <section className="conversation">
        <header className="topbar">
          <button className="mobile-only icon-button" onClick={() => setSidebarOpen(true)} title="Threads" aria-label="Threads">
            <Menu size={20} />
          </button>
          <ThreadTitle />
          <GitToolbar />
        </header>
        <Timeline />
        <ApprovalStack />
        <Composer />
      </section>
      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}
    </section>
  );
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

function Timeline() {
  const activeThreadId = useRemodexStore((state) => state.activeThreadId);
  const messages = useRemodexStore((state) => activeThreadId ? state.messagesByThread[activeThreadId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES);
  const threads = useRemodexStore((state) => state.threads);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="timeline">
      {!threads.length ? (
        <div className="empty-state">
          <strong>No conversations yet</strong>
          <span>Use the plus button to create a thread, or refresh after Codex history is available.</span>
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
  return (
    <div className="approval-card">
      <div>
        <strong>{request.command || request.method}</strong>
        <span>{request.reason || request.threadId || "Approval requested"}</span>
      </div>
      <button className="icon-button" title="Decline" aria-label="Decline" onClick={() => onDecision("decline")}><X size={16} /></button>
      <button onClick={() => onDecision("acceptForSession")}>Session</button>
      <button className="primary icon-button" title="Accept" aria-label="Accept" onClick={() => onDecision("accept")}><Check size={16} /></button>
    </div>
  );
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
  const availableModels = useRemodexStore((state) => state.availableModels);
  const disconnect = useRemodexStore((state) => state.disconnect);
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
        <button className="danger wide" onClick={disconnect}>Disconnect</button>
      </section>
    </div>
  );
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
