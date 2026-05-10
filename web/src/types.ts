export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };

export interface RPCErrorPayload {
  code: number;
  message: string;
  data?: JSONValue;
}

export interface RPCMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: JSONValue;
  result?: JSONValue;
  error?: RPCErrorPayload;
}

export interface PairingQRPayload {
  v: number;
  relay: string;
  sessionId: string;
  macDeviceId: string;
  macIdentityPublicKey: string;
  expiresAt: number;
}

export interface PhoneIdentityState {
  phoneDeviceId: string;
  phoneIdentityPrivateKey: string;
  phoneIdentityPublicKey: string;
  deviceDisplayName?: string;
  deviceKind?: string;
}

export interface TrustedMacRecord {
  macDeviceId: string;
  macIdentityPublicKey: string;
  relayURL: string;
  displayName?: string;
  lastPairedAt: number;
  lastResolvedSessionId?: string;
  lastResolvedAt?: number;
  lastUsedAt?: number;
}

export interface RelaySessionState {
  relayURL: string;
  sessionId: string;
  macDeviceId: string;
  macIdentityPublicKey: string;
  lastAppliedBridgeOutboundSeq: number;
  forceQRBootstrap: boolean;
}

export type SecureConnectionState =
  | "notPaired"
  | "trustedMac"
  | "liveSessionUnresolved"
  | "handshaking"
  | "encrypted"
  | "reconnecting"
  | "rePairRequired"
  | "updateRequired";

export interface CodexThread {
  id: string;
  title?: string;
  name?: string;
  cwd?: string;
  status?: string;
  updatedAt?: string | number;
  createdAt?: string | number;
  archived?: boolean;
  sourceKind?: string;
}

export interface ImageAttachment {
  id: string;
  thumbnailBase64JPEG: string;
  payloadDataURL?: string;
  sourceURL?: string;
}

export type TimelineRole = "user" | "assistant" | "system" | "tool" | "reasoning" | "plan";
export type TimelineKind =
  | "chat"
  | "reasoning"
  | "tool"
  | "command"
  | "diff"
  | "fileChange"
  | "plan"
  | "approval"
  | "error"
  | "image";

export interface TimelineMessage {
  id: string;
  role: TimelineRole;
  kind: TimelineKind;
  threadId: string;
  turnId?: string;
  itemId?: string;
  text: string;
  createdAt: number;
  streaming?: boolean;
  status?: string;
  attachments?: ImageAttachment[];
  metadata?: JSONObject;
}

export interface ApprovalRequest {
  id: string;
  requestID: string | number;
  method: string;
  command?: string;
  reason?: string;
  threadId?: string;
  turnId?: string;
  approvalRoute?: "bridgeRuntime" | "desktopIpc";
  desktopOwnerClientId?: string;
  params?: JSONValue;
}

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins?: number;
  resetsAt?: number;
}

export interface CodexRateLimitBucket {
  limitId: string;
  limitName?: string;
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
}

export interface ContextWindowUsage {
  tokensUsed: number;
  tokenLimit: number;
}

export interface CodexRateLimitDisplayRow {
  id: string;
  label: string;
  window: CodexRateLimitWindow;
}

export type ThreadRunState = "approval" | "running" | "ready" | "failed";

export interface InAppNotification {
  id: string;
  threadId: string;
  kind: "approval" | "ready" | "failed";
  title: string;
  body: string;
  createdAt: number;
}

export interface WebPushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export type WebPushStatus =
  | "checking"
  | "unsupported"
  | "insecure"
  | "disabled"
  | "subscribing"
  | "enabled"
  | "error";

export interface GitStatusFile {
  path: string;
  status: string;
}

export interface GitStatus {
  cwd?: string;
  repoRoot?: string;
  branch?: string;
  state?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  files?: GitStatusFile[];
  canCommit?: boolean;
  canPush?: boolean;
}

export interface ReasoningEffortOption {
  id: string;
  reasoningEffort: string;
  title?: string;
  description?: string;
}

export interface ModelOption {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
  supportedReasoningEfforts?: ReasoningEffortOption[];
  defaultReasoningEffort?: string;
}

export interface RuntimeSettings {
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  autoReview?: boolean;
  gitToolbarEnabled?: boolean;
  accessMode: "onRequest";
  planMode: boolean;
}

export interface TurnInputOptions {
  text: string;
  attachments: ImageAttachment[];
  skillMentions?: Array<{ id: string; name?: string; path?: string }>;
  mentionMentions?: Array<{ name: string; path: string }>;
  imageURLKey?: "url" | "image_url";
}

export type ComposerSkillMention = { id: string; name?: string; path?: string };
export type ComposerMention = { name: string; path: string };

export interface QueuedComposerDraft {
  text: string;
  skillMentions?: ComposerSkillMention[];
  mentionMentions?: ComposerMention[];
}
