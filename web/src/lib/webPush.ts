import type { WebPushStatus, WebPushSubscriptionPayload } from "../types";
import type { RemodexClient } from "./remodexClient";

const SERVICE_WORKER_READY_TIMEOUT_MS = 8_000;

export interface WebPushRuntimeState {
  status: WebPushStatus;
  error?: string;
}

export async function readWebPushRuntimeState(): Promise<WebPushRuntimeState> {
  const support = webPushSupportState();
  if (support.status !== "checking") {
    return support;
  }

  try {
    const registration = await serviceWorkerReady();
    const subscription = await registration.pushManager.getSubscription();
    return {
      status: subscription ? "enabled" : "disabled",
    };
  } catch (error) {
    return {
      status: "disabled",
      error: errorMessage(error),
    };
  }
}

export async function enableWebPush(client: RemodexClient): Promise<void> {
  const support = webPushSupportState();
  if (support.status === "unsupported" || support.status === "insecure") {
    throw new Error(support.error || "Web Push is not available in this browser.");
  }

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const [registration, publicKey] = await Promise.all([
    serviceWorkerReady(),
    client.getWebPushPublicKey(),
  ]);
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64URLToArrayBuffer(publicKey),
  });
  await client.registerWebPush(toWebPushSubscriptionPayload(subscription));
}

export async function disableWebPush(client: RemodexClient): Promise<void> {
  const support = webPushSupportState();
  if (support.status === "unsupported" || support.status === "insecure") {
    return;
  }

  const registration = await serviceWorkerReady();
  const subscription = await registration.pushManager.getSubscription();
  await client.unregisterWebPush(subscription?.endpoint);
  if (subscription) {
    await subscription.unsubscribe();
  }
}

function webPushSupportState(): WebPushRuntimeState {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { status: "unsupported", error: "Web Push is not available." };
  }
  if (!window.isSecureContext) {
    return { status: "insecure", error: "Web Push requires HTTPS or localhost." };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { status: "unsupported", error: "This browser does not support Web Push." };
  }
  if (Notification.permission === "denied") {
    return { status: "error", error: "Notification permission is blocked for this site." };
  }
  return { status: "checking" };
}

async function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration>((_, reject) => {
      window.setTimeout(() => reject(new Error("Service worker is not ready.")), SERVICE_WORKER_READY_TIMEOUT_MS);
    }),
  ]);
}

function toWebPushSubscriptionPayload(subscription: PushSubscription): WebPushSubscriptionPayload {
  const raw = subscription.toJSON() as PushSubscriptionJSON & {
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
  if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys.auth) {
    throw new Error("Browser returned an incomplete Web Push subscription.");
  }
  return {
    endpoint: raw.endpoint,
    expirationTime: raw.expirationTime ?? null,
    keys: {
      p256dh: raw.keys.p256dh,
      auth: raw.keys.auth,
    },
  };
}

function base64URLToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output.buffer as ArrayBuffer;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
