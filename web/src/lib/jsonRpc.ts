import type { JSONValue, RPCErrorPayload, RPCMessage } from "../types";
import { idKey } from "./base64";

export class RPCError extends Error {
  readonly code: number;
  readonly data?: JSONValue;

  constructor(error: RPCErrorPayload) {
    super(error.message);
    this.name = "RPCError";
    this.code = error.code;
    this.data = error.data;
  }
}

export class JSONRPCDispatcher {
  private nextSequence = 1;
  private readonly pending = new Map<string, {
    resolve: (value: RPCMessage) => void;
    reject: (error: Error) => void;
    timer: number;
  }>();

  constructor(
    private readonly sendText: (text: string) => Promise<void>,
    private readonly requestTimeoutMs = 45_000
  ) {}

  async request(method: string, params?: JSONValue, timeoutMs = this.requestTimeoutMs): Promise<RPCMessage> {
    const id = `web-${Date.now().toString(36)}-${this.nextSequence++}`;
    const message: RPCMessage = {
      id,
      method,
      params
    };

    const response = new Promise<RPCMessage>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    try {
      await this.sendText(JSON.stringify(message));
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        window.clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    return response;
  }

  async notify(method: string, params?: JSONValue): Promise<void> {
    await this.sendText(JSON.stringify({ method, params }));
  }

  async respond(id: string | number, result: JSONValue): Promise<void> {
    await this.sendText(JSON.stringify({ id, result }));
  }

  async respondError(id: string | number | null | undefined, code: number, message: string, data?: JSONValue): Promise<void> {
    await this.sendText(JSON.stringify({
      id: id ?? null,
      error: {
        code,
        message,
        data
      }
    }));
  }

  handleMessage(message: RPCMessage): boolean {
    if (message.id == null || (message.result == null && message.error == null)) {
      return false;
    }
    const key = idKey(message.id);
    const pending = this.pending.get(key);
    if (!pending) {
      return false;
    }

    window.clearTimeout(pending.timer);
    this.pending.delete(key);
    if (message.error) {
      pending.reject(new RPCError(message.error));
    } else {
      pending.resolve(message);
    }
    return true;
  }

  failAll(error: Error): void {
    for (const [key, pending] of this.pending.entries()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(key);
    }
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
