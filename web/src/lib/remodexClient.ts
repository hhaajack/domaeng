import type {
  ApprovalRequest,
  GitStatus,
  ImageAttachment,
  JSONObject,
  JSONValue,
  ModelOption,
  PairingQRPayload,
  PhoneIdentityState,
  RelaySessionState,
  RPCMessage,
  RuntimeSettings,
  TrustedMacRecord,
  WebPushSubscriptionPayload
} from "../types";
import { idKey, randomUUID } from "./base64";
import { JSONRPCDispatcher, RPCError } from "./jsonRpc";
import {
  pairingCodeResolveURL,
  relayStateFromPairingPayload,
  relayWebSocketURL,
  trustedResolveURL
} from "./pairing";
import {
  buildResumeState,
  createClientHello,
  finalizeSecureHandshake,
  SecureSession,
  signTrustedSessionResolve,
  wireMessageKind,
  type SecureReadyMessage,
  type SecureServerHello
} from "./secureTransport";
import {
  getOrCreatePhoneIdentity,
  readRelayState,
  readTrustedMacs,
  rememberTrustedMac,
  updateRelayReplayCursor,
  writeRelayState
} from "./storage";
import { makeTurnInputPayload } from "./attachments";

type ClientEvent =
  | { type: "status"; status: string; detail?: string }
  | { type: "rpc"; message: RPCMessage }
  | { type: "notification"; method: string; params?: JSONValue }
  | { type: "serverRequest"; method: string; requestID: string | number; params?: JSONValue }
  | { type: "approval"; request: ApprovalRequest }
  | { type: "secureState"; state: string }
  | { type: "error"; error: Error };

type Listener = (event: ClientEvent) => void;
type ControlWaiter = {
  resolve: (rawText: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const CONTROL_WAIT_TIMEOUT_MS = 8_000;

export class RemodexClient {
  private socket: WebSocket | null = null;
  private rpc: JSONRPCDispatcher | null = null;
  private secureSession: SecureSession | null = null;
  private relayState: RelaySessionState | null = null;
  private phoneIdentity: PhoneIdentityState | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly controlWaiters = new Map<string, ControlWaiter[]>();
  private readonly bufferedControls = new Map<string, string[]>();
  private pendingSecureError: Error | null = null;
  private initialized = false;

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connectFromPairing(payload: PairingQRPayload): Promise<void> {
    const relayState = relayStateFromPairingPayload(payload);
    await writeRelayState(relayState);
    await this.open(relayState, "qr_bootstrap");
    await rememberTrustedMac({
      macDeviceId: relayState.macDeviceId,
      macIdentityPublicKey: relayState.macIdentityPublicKey,
      relayURL: relayState.relayURL,
      lastPairedAt: Date.now(),
      lastUsedAt: Date.now()
    });
  }

  async connectTrusted(relayURLOverride?: string): Promise<void> {
    const state = await readRelayState();
    const trustedMacs = await readTrustedMacs();
    const trusted = state
      ? trustedMacs[state.macDeviceId]
      : Object.values(trustedMacs).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0];
    if (!trusted) {
      throw new Error("This Web App has not paired with a Mac yet. Scan or enter a pairing code once from this app.");
    }

    const relayURL = relayURLOverride?.trim() || trusted.relayURL || state?.relayURL;
    if (!relayURL) {
      throw new Error("Relay URL is required for trusted reconnect");
    }

    const relayState = await this.resolveTrustedMac({
      ...trusted,
      relayURL
    });
    await this.open(relayState, "trusted_reconnect");
  }

  async resolvePairingCode(code: string, relayURL?: string): Promise<PairingQRPayload> {
    const state = await readRelayState();
    const trustedMac = Object.values(await readTrustedMacs())[0];
    const resolvedRelayURL = relayURL?.trim() || state?.relayURL || trustedMac?.relayURL;
    if (!resolvedRelayURL) {
      throw new Error("Relay URL is required for pairing code");
    }
    const response = await fetch(pairingCodeResolveURL(resolvedRelayURL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code })
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Pairing code could not be resolved");
    }
    return {
      v: Number(body.v),
      relay: resolvedRelayURL,
      sessionId: String(body.sessionId),
      macDeviceId: String(body.macDeviceId),
      macIdentityPublicKey: String(body.macIdentityPublicKey),
      expiresAt: Number(body.expiresAt)
    };
  }

  disconnect(): void {
    this.rpc?.failAll(new Error("Disconnected"));
    this.rpc = null;
    this.secureSession = null;
    this.initialized = false;
    this.rejectControlWaiters(new Error("Relay socket closed"));
    this.socket?.close();
    this.socket = null;
    this.emit({ type: "status", status: "disconnected" });
  }

  async listThreads(limit = 70): Promise<JSONValue[]> {
    const response = await this.request("thread/list", {
      limit,
      sourceKinds: ["cli", "vscode", "appServer", "exec", "unknown"],
      cursor: null
    });
    const result = asObject(response.result);
    return asArray(result.data) ?? asArray(result.items) ?? asArray(result.threads) ?? [];
  }

  async listModels(): Promise<ModelOption[]> {
    const response = await this.request("model/list", {
      cursor: null,
      limit: 50,
      includeHidden: false
    }, 120_000);
    const result = asObject(response.result);
    const items = asArray(result.items) ?? asArray(result.data) ?? asArray(result.models) ?? [];
    return items.map(decodeModelOption).filter((model): model is ModelOption => Boolean(model));
  }

  async readRateLimits(): Promise<JSONValue> {
    try {
      const response = await this.request("account/rateLimits/read", null);
      return response.result ?? {};
    } catch (error) {
      if (!shouldRetryRateLimitsWithEmptyParams(error)) {
        throw error;
      }
    }

    const response = await this.request("account/rateLimits/read", {});
    return response.result ?? {};
  }

  async readContextWindowUsage(threadId: string, turnId?: string): Promise<JSONValue> {
    const params: JSONObject = { threadId };
    if (turnId?.trim()) {
      params.turnId = turnId.trim();
    }
    const response = await this.request("thread/contextWindow/read", params, 30_000);
    return response.result ?? {};
  }

  async readThread(threadId: string): Promise<RPCMessage> {
    return this.request("thread/read", {
      threadId,
      includeTurns: true
    });
  }

  async renameThread(threadId: string, name: string): Promise<JSONValue> {
    const response = await this.request("thread/name/set", {
      threadId,
      name
    });
    return response.result ?? {};
  }

  async resumeThread(threadId: string, cwd?: string, settings?: RuntimeSettings): Promise<RPCMessage> {
    const params: JSONObject = { threadId };
    if (cwd?.trim()) {
      params.cwd = cwd.trim();
    }
    if (settings?.model?.trim()) {
      params.model = settings.model.trim();
    }
    if (settings?.serviceTier?.trim()) {
      params.serviceTier = settings.serviceTier.trim();
    }
    this.applyApprovalReviewer(params, settings);
    return this.request("thread/resume", params);
  }

  async startThread(cwd?: string, settings?: RuntimeSettings): Promise<RPCMessage> {
    const params: JSONObject = {};
    if (cwd?.trim()) {
      params.cwd = cwd.trim();
    }
    if (settings?.model?.trim()) {
      params.model = settings.model.trim();
    }
    if (settings?.serviceTier?.trim()) {
      params.serviceTier = settings.serviceTier.trim();
    }
    this.applyApprovalReviewer(params, settings);
    return this.request("thread/start", params);
  }

  async startTurn({
    threadId,
    text,
    attachments,
    settings
  }: {
    threadId: string;
    text: string;
    attachments: ImageAttachment[];
    settings: RuntimeSettings;
  }): Promise<RPCMessage> {
    const params = this.turnParams(threadId, text, attachments, settings, "url");
    try {
      return await this.request("turn/start", params);
    } catch (error) {
      if (attachments.length > 0 && String(error).includes("image")) {
        return this.request("turn/start", this.turnParams(threadId, text, attachments, settings, "image_url"));
      }
      throw error;
    }
  }

  async steerTurn({
    threadId,
    expectedTurnId,
    text,
    attachments,
    settings
  }: {
    threadId: string;
    expectedTurnId: string;
    text: string;
    attachments: ImageAttachment[];
    settings: RuntimeSettings;
  }): Promise<RPCMessage> {
    const params = this.turnParams(threadId, text, attachments, settings, "url");
    params.expectedTurnId = expectedTurnId;
    return this.request("turn/steer", params);
  }

  async interruptTurn(threadId: string, turnId?: string): Promise<RPCMessage> {
    let resolvedTurnId = turnId?.trim();
    if (!resolvedTurnId) {
      const thread = await this.readThread(threadId);
      resolvedTurnId = findInterruptibleTurnId(thread.result);
    }
    if (!resolvedTurnId) {
      throw new Error("No interruptible turn is available");
    }
    return this.request("turn/interrupt", {
      threadId,
      turnId: resolvedTurnId
    });
  }

  async gitStatus(cwd?: string): Promise<GitStatus> {
    const response = await this.request("git/status", cwd ? { cwd } : {});
    return (response.result ?? {}) as GitStatus;
  }

  async gitCommit(cwd: string | undefined, message: string): Promise<RPCMessage> {
    const params: JSONObject = {
      message
    };
    if (cwd) {
      params.cwd = cwd;
    }
    return this.request("git/commit", params);
  }

  async gitPush(cwd?: string): Promise<RPCMessage> {
    return this.request("git/push", cwd ? { cwd } : {});
  }

  async gitPull(cwd?: string): Promise<RPCMessage> {
    return this.request("git/pull", cwd ? { cwd } : {});
  }

  async refreshDesktopThread(threadId: string): Promise<RPCMessage> {
    return this.request("desktop/refreshThread", { threadId }, 30_000);
  }

  async getWebPushPublicKey(): Promise<string> {
    const response = await this.request("notifications/webPush/publicKey", {}, 30_000);
    const result = asObject(response.result);
    const publicKey = readString(result.publicKey);
    if (!publicKey) {
      throw new Error("Web Push public key is not available");
    }
    return publicKey;
  }

  async registerWebPush(subscription: WebPushSubscriptionPayload): Promise<RPCMessage> {
    return this.request("notifications/webPush/register", {
      subscription: subscription as unknown as JSONValue,
      alertsEnabled: true
    }, 30_000);
  }

  async unregisterWebPush(endpoint?: string): Promise<RPCMessage> {
    return this.request("notifications/webPush/unregister", endpoint ? { endpoint } : {}, 30_000);
  }

  async approve(request: ApprovalRequest, decision: "accept" | "decline" | "acceptForSession"): Promise<void> {
    await this.respond(request.requestID, approvalResponseForDecision(request, decision));
  }

  async request(method: string, params?: JSONValue, timeoutMs?: number): Promise<RPCMessage> {
    if (!this.rpc) {
      throw new Error("Remodex is not connected");
    }
    return this.rpc.request(method, params, timeoutMs);
  }

  async respond(id: string | number, result: JSONValue): Promise<void> {
    if (!this.rpc) {
      throw new Error("Remodex is not connected");
    }
    await this.rpc.respond(id, result);
  }

  private async open(relayState: RelaySessionState, mode: "qr_bootstrap" | "trusted_reconnect"): Promise<void> {
    this.disconnect();
    this.pendingSecureError = null;
    this.bufferedControls.clear();
    this.relayState = relayState;
    this.phoneIdentity = await getOrCreatePhoneIdentity();
    this.emit({ type: "secureState", state: mode === "qr_bootstrap" ? "handshaking" : "reconnecting" });
    this.emit({ type: "status", status: "connecting" });

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(relayWebSocketURL(relayState.relayURL, relayState.sessionId));
      this.socket = socket;
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Relay connection failed")), { once: true });
    });

    this.socket!.addEventListener("message", (event) => {
      void this.handleWireText(String(event.data));
    });
    this.socket!.addEventListener("close", () => {
      this.rpc?.failAll(new Error("Relay socket closed"));
      this.rejectControlWaiters(new Error("Relay socket closed"));
      this.emit({ type: "status", status: "disconnected" });
    });

    try {
      await this.performHandshake(mode);
    } catch (error) {
      this.disconnect();
      this.emit({ type: "secureState", state: mode === "qr_bootstrap" ? "notPaired" : "rePairRequired" });
      throw error;
    }
    this.rpc = new JSONRPCDispatcher((text) => this.sendApplicationText(text));
    this.emit({ type: "status", status: "connected" });
    try {
      await this.initializeSession();
    } catch (error) {
      this.emit({
        type: "error",
        error: new Error(`Connected, but initialize failed: ${errorMessage(error)}`)
      });
    }
  }

  private async performHandshake(mode: "qr_bootstrap" | "trusted_reconnect"): Promise<void> {
    if (!this.relayState || !this.phoneIdentity) {
      throw new Error("Secure handshake missing state");
    }

    const pending = createClientHello({
      relayState: this.relayState,
      phoneIdentity: this.phoneIdentity,
      mode
    });
    this.sendRaw(JSON.stringify(pending.clientHello));
    const serverHello = JSON.parse(await this.waitForControl("serverHello")) as SecureServerHello;
    const { clientAuth, session } = await finalizeSecureHandshake({
      pending,
      serverHello,
      relayState: this.relayState,
      phoneIdentity: this.phoneIdentity
    });
    this.sendRaw(JSON.stringify(clientAuth));
    const ready = JSON.parse(await this.waitForControl("secureReady")) as SecureReadyMessage;
    if (ready.sessionId !== session.sessionId || ready.keyEpoch !== session.keyEpoch) {
      throw new Error("Secure ready did not match current handshake");
    }
    this.secureSession = session;
    this.sendRaw(JSON.stringify(buildResumeState(session)));
    await writeRelayState({
      ...this.relayState,
      forceQRBootstrap: false
    });
    await rememberTrustedMac({
      macDeviceId: this.relayState.macDeviceId,
      macIdentityPublicKey: this.relayState.macIdentityPublicKey,
      relayURL: this.relayState.relayURL,
      lastPairedAt: Date.now(),
      lastUsedAt: Date.now()
    });
    this.emit({ type: "secureState", state: "encrypted" });
  }

  private async initializeSession(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const rpc = this.rpc;
    if (!rpc) {
      throw new Error("Remodex disconnected before initialization.");
    }
    const modernParams = {
      clientInfo: {
        name: "remodex_web",
        title: "Remodex Web",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    };
    await rpc.request("initialize", modernParams);
    await rpc.notify("initialized");
    this.initialized = true;
  }

  private async resolveTrustedMac(trusted: TrustedMacRecord): Promise<RelaySessionState> {
    this.phoneIdentity = await getOrCreatePhoneIdentity();
    const nonce = randomUUID();
    const timestamp = Date.now();
    const body = await signTrustedSessionResolve({
      macDeviceId: trusted.macDeviceId,
      phoneIdentity: this.phoneIdentity,
      nonce,
      timestamp
    });
    const response = await fetch(trustedResolveURL(trusted.relayURL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const resolved = await response.json();
    if (!response.ok || !resolved.ok) {
      throw new Error(resolved.error || "Trusted Mac is not reachable");
    }
    const next: RelaySessionState = {
      relayURL: trusted.relayURL,
      sessionId: String(resolved.sessionId),
      macDeviceId: String(resolved.macDeviceId),
      macIdentityPublicKey: String(resolved.macIdentityPublicKey),
      lastAppliedBridgeOutboundSeq: 0,
      forceQRBootstrap: false
    };
    await writeRelayState(next);
    await rememberTrustedMac({
      ...trusted,
      displayName: typeof resolved.displayName === "string" ? resolved.displayName : trusted.displayName,
      lastResolvedSessionId: next.sessionId,
      lastResolvedAt: Date.now(),
      lastUsedAt: Date.now()
    });
    return next;
  }

  private turnParams(
    threadId: string,
    text: string,
    attachments: ImageAttachment[],
    settings: RuntimeSettings,
    imageURLKey: "url" | "image_url"
  ): JSONObject {
    const params: JSONObject = {
      threadId,
      input: makeTurnInputPayload({
        text,
        attachments,
        imageURLKey
      })
    };
    if (settings.model?.trim()) {
      params.model = settings.model.trim();
    }
    if (settings.reasoningEffort?.trim()) {
      params.effort = settings.reasoningEffort.trim();
    }
    if (settings.serviceTier?.trim()) {
      params.serviceTier = settings.serviceTier.trim();
    }
    this.applyApprovalReviewer(params, settings);
    if (settings.planMode) {
      params.collaborationMode = {
        mode: "plan",
        settings: {
          model: settings.model?.trim() || "gpt-5.4",
          reasoning_effort: settings.reasoningEffort?.trim() || null,
          developer_instructions: null
        }
      };
    }
    return params;
  }

  private applyApprovalReviewer(params: JSONObject, settings?: RuntimeSettings): void {
    if (settings?.autoReview) {
      params.approvals_reviewer = "auto_review";
    }
  }

  private async handleWireText(rawText: string): Promise<void> {
    const kind = wireMessageKind(rawText);
    if (kind === "serverHello" || kind === "secureReady" || kind === "secureError") {
      this.bufferControl(kind, rawText);
      return;
    }
    if (kind === "encryptedEnvelope") {
      if (!this.secureSession) {
        return;
      }
      const plaintext = await this.secureSession.decryptEnvelope(JSON.parse(rawText));
      if (plaintext == null) {
        this.emit({ type: "secureState", state: "rePairRequired" });
        return;
      }
      if (plaintext === "") {
        await updateRelayReplayCursor(this.secureSession.lastInboundBridgeOutboundSeq);
        return;
      }
      await updateRelayReplayCursor(this.secureSession.lastInboundBridgeOutboundSeq);
      this.handleRPCText(plaintext);
      return;
    }
    this.handleRPCText(rawText);
  }

  private handleRPCText(rawText: string): void {
    let message: RPCMessage;
    try {
      message = JSON.parse(rawText) as RPCMessage;
    } catch {
      return;
    }
    this.emit({ type: "rpc", message });
    if (this.rpc?.handleMessage(message)) {
      return;
    }
    if (message.method) {
      if (message.id != null) {
        this.handleServerRequest(message);
      } else {
        this.emit({ type: "notification", method: message.method, params: message.params });
      }
    }
  }

  private handleServerRequest(message: RPCMessage): void {
    const requestID = message.id as string | number;
    const method = message.method ?? "";
    if (method.includes("requestApproval")) {
      const params = asObject(message.params);
      const request: ApprovalRequest = {
        id: idKey(requestID),
        requestID,
        method,
        command: readString(params.command),
        reason: readString(params.reason),
        threadId: readString(params.threadId),
        turnId: readString(params.turnId),
        params: message.params
      };
      this.emit({ type: "approval", request });
      return;
    }
    this.emit({ type: "serverRequest", method, requestID, params: message.params });
  }

  private async sendApplicationText(plaintext: string): Promise<void> {
    if (!this.secureSession) {
      throw new Error("Secure session is not ready");
    }
    this.sendRaw(await this.secureSession.encryptApplicationMessage(plaintext));
  }

  private sendRaw(text: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay socket is not open");
    }
    this.socket.send(text);
  }

  private waitForControl(kind: string, timeoutMs = CONTROL_WAIT_TIMEOUT_MS): Promise<string> {
    if (this.pendingSecureError) {
      return Promise.reject(this.pendingSecureError);
    }
    const buffered = this.bufferedControls.get(kind);
    if (buffered?.length) {
      return Promise.resolve(buffered.shift()!);
    }
    return new Promise((resolve, reject) => {
      const waiters = this.controlWaiters.get(kind) ?? [];
      const waiter: ControlWaiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          const current = this.controlWaiters.get(kind) ?? [];
          this.controlWaiters.set(kind, current.filter((entry) => entry !== waiter));
          reject(new Error(`Secure handshake timed out waiting for ${kind}.`));
        }, timeoutMs)
      };
      waiters.push(waiter);
      this.controlWaiters.set(kind, waiters);
    });
  }

  private bufferControl(kind: string, rawText: string): void {
    if (kind === "secureError") {
      const parsed = JSON.parse(rawText) as { code?: string; message?: string };
      const error = new Error(parsed.message || "Secure transport error");
      this.pendingSecureError = error;
      this.emit({ type: "secureState", state: secureStateForSecureError(parsed.code) });
      this.emit({ type: "error", error });
      this.rejectControlWaiters(error);
      return;
    }
    const waiters = this.controlWaiters.get(kind);
    if (waiters?.length) {
      const waiter = waiters.shift()!;
      this.controlWaiters.set(kind, waiters);
      clearTimeout(waiter.timeout);
      waiter.resolve(rawText);
      return;
    }
    const buffered = this.bufferedControls.get(kind) ?? [];
    buffered.push(rawText);
    this.bufferedControls.set(kind, buffered);
  }

  private rejectControlWaiters(error: Error): void {
    for (const waiters of this.controlWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(error);
      }
    }
    this.controlWaiters.clear();
  }

  private emit(event: ClientEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function secureStateForSecureError(code?: string): string {
  switch (code) {
    case "update_required":
      return "updateRequired";
    case "phone_not_trusted":
    case "phone_identity_changed":
    case "invalid_phone_signature":
      return "rePairRequired";
    default:
      return "notPaired";
  }
}

function asObject(value: JSONValue | undefined): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONObject : {};
}

function asArray(value: JSONValue | undefined): JSONValue[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function approvalResponseForDecision(
  request: ApprovalRequest,
  decision: "accept" | "decline" | "acceptForSession"
): JSONValue {
  if (request.method !== "item/permissions/requestApproval") {
    return { decision };
  }

  if (decision === "decline") {
    return {
      permissions: {},
      scope: "turn"
    };
  }

  const params = asObject(request.params);
  return {
    permissions: asObject(params.permissions),
    scope: decision === "acceptForSession" ? "session" : "turn"
  };
}

function readString(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function findInterruptibleTurnId(value: JSONValue | undefined): string | undefined {
  const thread = asObject(asObject(value).thread ?? value);
  const turns = asArray(thread.turns) ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asObject(turns[index]);
    const id = readString(turn.id) || readString(turn.turnId) || readString(turn.turn_id);
    const status = JSON.stringify(turn.status ?? turn).toLowerCase();
    if (id && (status.includes("running") || status.includes("in_progress") || status.includes("pending"))) {
      return id;
    }
  }
  return undefined;
}

function decodeModelOption(value: JSONValue): ModelOption | null {
  const object = asObject(value);
  const model = readString(object.model) || readString(object.id);
  if (!model) {
    return null;
  }
  const id = readString(object.id) || model;
  return {
    id,
    model,
    displayName: readString(object.displayName) || readString(object.display_name) || model,
    description: readString(object.description),
    isDefault: object.isDefault === true || object.is_default === true,
    supportedReasoningEfforts: decodeReasoningEfforts(
      asArray(object.supportedReasoningEfforts) ?? asArray(object.supported_reasoning_efforts)
    ),
    defaultReasoningEffort: readString(object.defaultReasoningEffort) || readString(object.default_reasoning_effort)
  };
}

function decodeReasoningEfforts(values: JSONValue[] | undefined): ModelOption["supportedReasoningEfforts"] {
  if (!values?.length) {
    return undefined;
  }
  return values.flatMap((value) => {
    const object = asObject(value);
    const effort = readString(object.reasoningEffort)
      || readString(object.reasoning_effort)
      || readString(object.effort)
      || readString(value);
    if (!effort) {
      return [];
    }
    return [{
      id: readString(object.id) || effort,
      reasoningEffort: effort,
      title: readString(object.title) || titleForEffort(effort),
      description: readString(object.description)
    }];
  });
}

export function isThreadNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("thread not found")) {
    return true;
  }
  if (error instanceof RPCError) {
    return JSON.stringify(error.data ?? {}).toLowerCase().includes("thread not found");
  }
  return false;
}

export function isThreadRolloutMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();
  if (normalizedMessage.includes("no rollout found") || normalizedMessage.includes("no rollout file found")) {
    return true;
  }
  if (error instanceof RPCError) {
    const data = JSON.stringify(error.data ?? {}).toLowerCase();
    return data.includes("no rollout found") || data.includes("no rollout file found");
  }
  return false;
}

function titleForEffort(effort: string): string {
  if (effort === "xhigh") return "Extra High";
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

function shouldRetryRateLimitsWithEmptyParams(error: unknown): boolean {
  if (!(error instanceof RPCError)) {
    return false;
  }
  if (error.code !== -32602 && error.code !== -32600) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("invalid params")
    || message.includes("invalid param")
    || message.includes("failed to parse")
    || message.includes("expected")
    || message.includes("missing field `params`")
    || message.includes("missing field params");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
