import { openDB, type DBSchema } from "idb";
import type {
  PhoneIdentityState,
  RelaySessionState,
  RuntimeSettings,
  TrustedMacRecord
} from "../types";
import { createPhoneIdentity } from "./secureTransport";

interface RemodexDB extends DBSchema {
  kv: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = "remodex-web";
const DB_VERSION = 1;
const LOCAL_STORAGE_PREFIX = "remodex-web:";
const KEYS = {
  phoneIdentity: "phoneIdentity",
  trustedMacs: "trustedMacs",
  relayState: "relayState",
  runtimeSettings: "runtimeSettings"
};

let idbAvailable = true;

async function db() {
  return openDB<RemodexDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("kv")) {
        database.createObjectStore("kv");
      }
    }
  });
}

export async function readKV<T>(key: string): Promise<T | undefined> {
  if (idbAvailable) {
    try {
      const value = await (await db()).get("kv", key) as T | undefined;
      if (value !== undefined) {
        writeLocalKV(key, value);
        return value;
      }
    } catch {
      idbAvailable = false;
    }
  }

  return readLocalKV<T>(key);
}

export async function writeKV<T>(key: string, value: T): Promise<void> {
  const localWriteSucceeded = writeLocalKV(key, value);
  if (!idbAvailable) {
    if (localWriteSucceeded) {
      return;
    }
    throw new Error("Browser storage is unavailable.");
  }

  try {
    await (await db()).put("kv", value, key);
  } catch (error) {
    idbAvailable = false;
    if (!localWriteSucceeded) {
      throw error;
    }
  }
}

export async function getOrCreatePhoneIdentity(): Promise<PhoneIdentityState> {
  const existing = await readKV<PhoneIdentityState>(KEYS.phoneIdentity);
  if (existing?.phoneDeviceId && existing.phoneIdentityPrivateKey && existing.phoneIdentityPublicKey) {
    return existing;
  }
  const created = createPhoneIdentity();
  await writeKV(KEYS.phoneIdentity, created);
  return created;
}

export async function readTrustedMacs(): Promise<Record<string, TrustedMacRecord>> {
  return (await readKV<Record<string, TrustedMacRecord>>(KEYS.trustedMacs)) ?? {};
}

export async function rememberTrustedMac(record: TrustedMacRecord): Promise<void> {
  const records = await readTrustedMacs();
  records[record.macDeviceId] = record;
  await writeKV(KEYS.trustedMacs, records);
}

export async function forgetTrustedMac(macDeviceId: string): Promise<void> {
  const records = await readTrustedMacs();
  delete records[macDeviceId];
  await writeKV(KEYS.trustedMacs, records);
}

export async function readRelayState(): Promise<RelaySessionState | undefined> {
  return readKV<RelaySessionState>(KEYS.relayState);
}

export async function writeRelayState(state: RelaySessionState): Promise<void> {
  await writeKV(KEYS.relayState, state);
}

export async function updateRelayReplayCursor(lastAppliedBridgeOutboundSeq: number): Promise<void> {
  const state = await readRelayState();
  if (!state) {
    return;
  }
  await writeRelayState({
    ...state,
    lastAppliedBridgeOutboundSeq
  });
}

export async function readRuntimeSettings(): Promise<RuntimeSettings> {
  const stored = (await readKV<Partial<RuntimeSettings>>(KEYS.runtimeSettings)) ?? {};
  return normalizeRuntimeSettings({
    accessMode: "onRequest",
    autoReview: false,
    gitToolbarEnabled: false,
    planMode: false,
    ...stored
  });
}

export async function writeRuntimeSettings(settings: RuntimeSettings): Promise<void> {
  await writeKV(KEYS.runtimeSettings, normalizeRuntimeSettings(settings));
}

export function normalizeRuntimeSettings(settings: Partial<RuntimeSettings>): RuntimeSettings {
  return {
    ...settings,
    accessMode: "onRequest",
    autoReview: settings.autoReview === true,
    gitToolbarEnabled: settings.gitToolbarEnabled === true,
    planMode: settings.planMode === true
  };
}

function localStorageKey(key: string): string {
  return `${LOCAL_STORAGE_PREFIX}${key}`;
}

function readLocalKV<T>(key: string): T | undefined {
  try {
    const rawValue = globalThis.localStorage?.getItem(localStorageKey(key));
    return rawValue == null ? undefined : JSON.parse(rawValue) as T;
  } catch {
    return undefined;
  }
}

function writeLocalKV<T>(key: string, value: T): boolean {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      globalThis.localStorage?.removeItem(localStorageKey(key));
    } else {
      globalThis.localStorage?.setItem(localStorageKey(key), serialized);
    }
    return true;
  } catch {
    return false;
  }
}
