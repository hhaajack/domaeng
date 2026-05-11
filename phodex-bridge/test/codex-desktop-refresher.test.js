// FILE: codex-desktop-refresher.test.js
// Purpose: Verifies desktop refresh defaults, failure hardening, and rollout-based throttling.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/codex-desktop-refresher, ../src/rollout-watch

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  CodexDesktopRefresher,
  readBridgeConfig,
} = require("../src/codex-desktop-refresher");
const { createThreadRolloutActivityWatcher } = require("../src/rollout-watch");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) {
      return value;
    }
    await wait(5);
  }
  return predicate();
}

test("readBridgeConfig keeps safe defaults and explicit overrides", () => {
  const macConfig = readBridgeConfig({
    env: {},
    platform: "darwin",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("unexpected read");
      },
    },
  });
  const persistedKeepAwakeConfig = readBridgeConfig({
    env: {
      REMODEX_DEVICE_STATE_DIR: "/tmp/remodex-state",
    },
    platform: "darwin",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync(targetPath) {
        return targetPath === "/tmp/remodex-state/daemon-config.json";
      },
      readFileSync(targetPath) {
        if (targetPath === "/tmp/remodex-state/daemon-config.json") {
          return JSON.stringify({ keepMacAwakeEnabled: false });
        }
        throw new Error("unexpected read");
      },
    },
  });
  const persistedRefreshConfig = readBridgeConfig({
    env: {
      REMODEX_DEVICE_STATE_DIR: "/tmp/remodex-refresh-state",
    },
    platform: "darwin",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync(targetPath) {
        return targetPath === "/tmp/remodex-refresh-state/daemon-config.json";
      },
      readFileSync(targetPath) {
        if (targetPath === "/tmp/remodex-refresh-state/daemon-config.json") {
          return JSON.stringify({ refreshEnabled: true });
        }
        throw new Error("unexpected read");
      },
    },
  });
  const macEndpointConfig = readBridgeConfig({
    env: { REMODEX_CODEX_ENDPOINT: "ws://localhost:8080" },
    platform: "darwin",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("unexpected read");
      },
    },
  });
  const remountCompletionConfig = readBridgeConfig({
    env: { REMODEX_COMPLETION_REFRESH_MODE: "remount" },
    platform: "darwin",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("unexpected read");
      },
    },
  });
  const relaunchCompletionConfig = readBridgeConfig({
    env: { REMODEX_COMPLETION_REFRESH_MODE: "relaunch" },
    platform: "darwin",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("unexpected read");
      },
    },
  });
  const linuxConfig = readBridgeConfig({
    env: {},
    platform: "linux",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("unexpected read");
      },
    },
  });
  const linuxCommandConfig = readBridgeConfig({
    env: { REMODEX_REFRESH_COMMAND: "echo refresh" },
    platform: "linux",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("unexpected read");
      },
    },
  });
  const explicitOnConfig = readBridgeConfig({
    env: {
      REMODEX_CODEX_ENDPOINT: "ws://localhost:8080",
      REMODEX_REFRESH_ENABLED: "true",
      REMODEX_DESKTOP_IPC_SOCKET: "/tmp/remodex-ipc.sock",
    },
    platform: "darwin",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("unexpected read");
      },
    },
  });
  const explicitOffConfig = readBridgeConfig({
    env: {
      REMODEX_REFRESH_COMMAND: "echo refresh",
      REMODEX_REFRESH_ENABLED: "false",
      REMODEX_KEEP_MAC_AWAKE: "false",
    },
    platform: "darwin",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("unexpected read");
      },
    },
  });
  const sharedRuntimeOptOutConfig = readBridgeConfig({
    env: {
      REMODEX_SHARED_CODEX_RUNTIME: "false",
    },
    platform: "darwin",
    runtimeRoot: "/tmp/remodex-package",
    fsImpl: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("unexpected read");
      },
    },
  });
  assert.equal(macConfig.sharedRuntimeEnabled, true);
  assert.equal(macConfig.desktopSharedRuntimeEnabled, false);
  assert.equal(macConfig.sharedRuntimeHost, "127.0.0.1");
  assert.equal(macConfig.sharedRuntimePort, 0);
  assert.equal(macConfig.refreshEnabled, false);
  assert.equal(macConfig.completionRefreshMode, "remount");
  assert.equal(macConfig.keepMacAwakeEnabled, false);
  assert.equal(macConfig.relayUrl, "");
  assert.equal(macConfig.pushServiceUrl, "");
  assert.equal(persistedKeepAwakeConfig.keepMacAwakeEnabled, false);
  assert.equal(persistedRefreshConfig.refreshEnabled, true);
  assert.equal(macEndpointConfig.sharedRuntimeEnabled, false);
  assert.equal(macEndpointConfig.desktopSharedRuntimeEnabled, false);
  assert.equal(macEndpointConfig.refreshEnabled, false);
  assert.equal(remountCompletionConfig.completionRefreshMode, "remount");
  assert.equal(relaunchCompletionConfig.completionRefreshMode, "relaunch");
  assert.equal(linuxConfig.refreshEnabled, false);
  assert.equal(linuxCommandConfig.refreshEnabled, false);
  assert.equal(explicitOnConfig.refreshEnabled, true);
  assert.equal(explicitOnConfig.desktopIpcSocketPath, "/tmp/remodex-ipc.sock");
  assert.equal(explicitOffConfig.refreshEnabled, false);
  assert.equal(explicitOffConfig.keepMacAwakeEnabled, false);
  assert.equal(sharedRuntimeOptOutConfig.sharedRuntimeEnabled, false);
  assert.equal(sharedRuntimeOptOutConfig.desktopSharedRuntimeEnabled, false);
  assert.equal(sharedRuntimeOptOutConfig.refreshEnabled, false);
});

test("readBridgeConfig derives a push URL from the active relay default", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-package-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-state-"));
  const srcDir = path.join(tempRoot, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, "private-defaults.json"),
    JSON.stringify({ relayUrl: "wss://relay.example/relay" }),
    "utf8"
  );

  const config = readBridgeConfig({
    env: {
      REMODEX_DEVICE_STATE_DIR: stateDir,
    },
    runtimeRoot: tempRoot,
    fsImpl: fs,
  });

  assert.equal(config.relayUrl, "wss://relay.example/relay");
  assert.equal(config.pushServiceUrl, "https://relay.example");
});

test("readBridgeConfig keeps the persisted daemon relay unless an env override is set", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-package-"));
  const srcDir = path.join(tempRoot, "src");
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-state-"));
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, "private-defaults.json"),
    JSON.stringify({
      relayUrl: "wss://packaged.example/relay",
      pushServiceUrl: "https://packaged.example",
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(stateDir, "daemon-config.json"),
    JSON.stringify({ relayUrl: "ws://127.0.0.1:9000/relay" }),
    "utf8"
  );

  const persistedConfig = readBridgeConfig({
    env: {
      REMODEX_DEVICE_STATE_DIR: stateDir,
    },
    runtimeRoot: tempRoot,
    fsImpl: fs,
  });
  const explicitConfig = readBridgeConfig({
    env: {
      REMODEX_DEVICE_STATE_DIR: stateDir,
      REMODEX_RELAY: "wss://self-host.example/relay",
    },
    runtimeRoot: tempRoot,
    fsImpl: fs,
  });

  assert.equal(persistedConfig.relayUrl, "ws://127.0.0.1:9000/relay");
  assert.equal(persistedConfig.pushServiceUrl, "http://127.0.0.1:9000");
  assert.equal(explicitConfig.relayUrl, "wss://self-host.example/relay");
  assert.equal(explicitConfig.pushServiceUrl, "https://self-host.example");
});

test("readBridgeConfig uses a packaged push default only when it is explicitly provided", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-package-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-state-"));
  const srcDir = path.join(tempRoot, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, "private-defaults.json"),
    JSON.stringify({
      relayUrl: "wss://relay.example/relay",
      pushServiceUrl: "https://relay.example",
    }),
    "utf8"
  );

  const config = readBridgeConfig({
    env: {
      REMODEX_DEVICE_STATE_DIR: stateDir,
    },
    runtimeRoot: tempRoot,
    fsImpl: fs,
  });

  assert.equal(config.relayUrl, "wss://relay.example/relay");
  assert.equal(config.pushServiceUrl, "https://relay.example");
});

test("readBridgeConfig defaults source checkouts with a local relay to localhost", () => {
  const config = readBridgeConfig({
    env: {},
    runtimeRoot: "/workspace/phodex-bridge",
    fsImpl: {
      existsSync(targetPath) {
        return targetPath === "/workspace/.git"
          || targetPath === "/workspace/relay/server.js";
      },
    },
  });

  assert.equal(config.relayUrl, "ws://127.0.0.1:9000/relay");
  assert.equal(config.pushServiceUrl, "http://127.0.0.1:9000");
});

test("readBridgeConfig does not use the hosted fallback inside a source checkout without a local relay", () => {
  const config = readBridgeConfig({
    env: {},
    runtimeRoot: "/workspace/phodex-bridge",
    fsImpl: {
      existsSync(targetPath) {
        return targetPath === "/workspace/.git";
      },
    },
  });

  assert.equal(config.relayUrl, "");
  assert.equal(config.pushServiceUrl, "");
});

test("readBridgeConfig defaults packaged installs with bundled relay to localhost", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domaeng-bundled-package-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "domaeng-state-"));
  try {
    fs.mkdirSync(path.join(tempRoot, "bundled", "relay"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "bundled", "relay", "server.js"), "module.exports = {};");

    const config = readBridgeConfig({
      env: {
        REMODEX_DEVICE_STATE_DIR: stateDir,
      },
      runtimeRoot: tempRoot,
      fsImpl: fs,
    });

    assert.equal(config.relayUrl, "ws://127.0.0.1:9000/relay");
    assert.equal(config.pushServiceUrl, "http://127.0.0.1:9000");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("readBridgeConfig lets bundled local relay outrank stale persisted package relays", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domaeng-bundled-package-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "domaeng-state-"));
  try {
    fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "bundled", "relay"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "bundled", "relay", "server.js"), "module.exports = {};");
    fs.writeFileSync(
      path.join(tempRoot, "src", "private-defaults.json"),
      JSON.stringify({
        relayUrl: "wss://packaged.example/relay",
        pushServiceUrl: "https://packaged.example",
      }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(stateDir, "daemon-config.json"),
      JSON.stringify({ relayUrl: "wss://relay.example/relay" }),
      "utf8"
    );

    const config = readBridgeConfig({
      env: {
        REMODEX_DEVICE_STATE_DIR: stateDir,
      },
      runtimeRoot: tempRoot,
      fsImpl: fs,
    });
    const explicitConfig = readBridgeConfig({
      env: {
        REMODEX_DEVICE_STATE_DIR: stateDir,
        DOMAENG_RELAY: "wss://self-host.example/relay",
      },
      runtimeRoot: tempRoot,
      fsImpl: fs,
    });

    assert.equal(config.relayUrl, "ws://127.0.0.1:9000/relay");
    assert.equal(config.pushServiceUrl, "http://127.0.0.1:9000");
    assert.equal(explicitConfig.relayUrl, "wss://self-host.example/relay");
    assert.equal(explicitConfig.pushServiceUrl, "https://self-host.example");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("readBridgeConfig preserves reverse-proxy subpaths when deriving push URLs", () => {
  const config = readBridgeConfig({
    env: {
      REMODEX_PUSH_SERVICE_URL: "https://relay.example/remodex",
    },
    runtimeRoot: "/workspace/phodex-bridge",
    fsImpl: {
      existsSync() {
        return false;
      },
    },
  });

  assert.equal(config.pushServiceUrl, "https://relay.example/remodex");
});

test("readBridgeConfig derives push from a self-hosted relay override instead of packaged defaults", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-package-"));
  const srcDir = path.join(tempRoot, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, "private-defaults.json"),
    JSON.stringify({ relayUrl: "wss://relay.example/remodex/relay" }),
    "utf8"
  );

  const config = readBridgeConfig({
    env: {
      REMODEX_RELAY: "wss://self-host.example/relay",
    },
    runtimeRoot: tempRoot,
    fsImpl: fs,
  });

  assert.equal(config.relayUrl, "wss://self-host.example/relay");
  assert.equal(config.pushServiceUrl, "https://self-host.example");
});

test("thread/start falls back once to the new-thread route when thread id is still unknown", async () => {
  const refreshCalls = [];
  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 0,
    fallbackNewThreadMs: 15,
    refreshExecutor: async (targetUrl) => {
      refreshCalls.push(targetUrl);
    },
  });

  refresher.handleInbound(JSON.stringify({
    method: "thread/start",
    params: {},
  }));

  await waitFor(() => refreshCalls.length === 1);

  assert.deepEqual(refreshCalls, ["codex://threads/new"]);
  refresher.handleTransportReset();
});

test("thread/started cancels the fallback and waits for completion before refreshing", async () => {
  const refreshCalls = [];
  const watchedThreads = [];
  let watcherHooks = null;
  let stopCount = 0;
  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 0,
    fallbackNewThreadMs: 40,
    refreshExecutor: async (targetUrl) => {
      refreshCalls.push(targetUrl);
    },
    watchThreadRolloutFactory: (hooks) => {
      watcherHooks = hooks;
      const { threadId } = hooks;
      watchedThreads.push(threadId);
      return {
        stop() {
          stopCount += 1;
        },
      };
    },
  });

  refresher.handleInbound(JSON.stringify({
    method: "thread/start",
    params: {},
  }));
  await wait(10);
  refresher.handleOutbound(JSON.stringify({
    method: "thread/started",
    params: {
      thread: {
        id: "thread-123",
      },
    },
  }));

  await wait(25);

  assert.deepEqual(refreshCalls, []);
  assert.deepEqual(watchedThreads, ["thread-123"]);

  await wait(30);
  assert.deepEqual(refreshCalls, []);

  watcherHooks.onEvent({
    reason: "materialized",
    threadId: "thread-123",
    size: 10,
  });
  await wait(10);
  assert.deepEqual(refreshCalls, []);

  refresher.handleOutbound(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread-123",
      turnId: "turn-123",
    },
  }));
  await wait(10);
  assert.deepEqual(refreshCalls, ["codex://threads/thread-123"]);

  refresher.handleTransportReset();
  assert.equal(stopCount, 1);
});

test("pending approval requests refresh the current desktop thread before completion", async () => {
  const refreshCalls = [];
  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 0,
    refreshExecutor: async (targetUrl, options) => {
      refreshCalls.push({ targetUrl, forceRelaunch: Boolean(options?.forceRelaunch) });
    },
  });

  refresher.handleOutbound(JSON.stringify({
    id: "approval-1",
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-approval",
      command: ["/bin/zsh", "-lc", "date"],
    },
  }));

  await waitFor(() => refreshCalls.length === 1);

  assert.deepEqual(refreshCalls, [{
    targetUrl: "codex://threads/thread-approval",
    forceRelaunch: false,
  }]);

  refresher.handleTransportReset();
});

test("rollout growth does not refresh during long runs", async () => {
  const refreshCalls = [];
  let watcherHooks = null;
  let currentTime = 0;

  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 0,
    now: () => currentTime,
    refreshExecutor: async (targetUrl) => {
      refreshCalls.push(targetUrl);
    },
    watchThreadRolloutFactory: (hooks) => {
      watcherHooks = hooks;
      return { stop() {} };
    },
  });

  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: {
      threadId: "thread-456",
    },
  }));
  await wait(10);
  refreshCalls.length = 0;

  currentTime = 1_000;
  watcherHooks.onEvent({
    reason: "materialized",
    threadId: "thread-456",
    size: 8,
  });
  await wait(10);
  assert.deepEqual(refreshCalls, []);

  currentTime = 2_000;
  watcherHooks.onEvent({
    reason: "growth",
    threadId: "thread-456",
    size: 10,
  });
  await wait(10);
  assert.deepEqual(refreshCalls, []);

  currentTime = 4_500;
  watcherHooks.onEvent({
    reason: "growth",
    threadId: "thread-456",
    size: 15,
  });
  await wait(10);
  assert.deepEqual(refreshCalls, []);

  currentTime = 8_000;
  watcherHooks.onEvent({
    reason: "growth",
    threadId: "thread-456",
    size: 20,
  });
  await wait(10);
  assert.deepEqual(refreshCalls, []);
});

test("turn/completed refreshes once per turn and stops the watcher", async () => {
  const refreshCalls = [];
  let watcherHooks = null;
  let stopCount = 0;
  let currentTime = 3_000;

  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 0,
    now: () => currentTime,
    refreshExecutor: async (targetUrl) => {
      refreshCalls.push(targetUrl);
    },
    watchThreadRolloutFactory: (hooks) => {
      watcherHooks = hooks;
      return {
        stop() {
          stopCount += 1;
        },
      };
    },
  });

  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: {
      threadId: "thread-789",
    },
  }));
  await wait(10);

  watcherHooks.onEvent({
    reason: "materialized",
    threadId: "thread-789",
    size: 12,
  });
  await wait(10);

  currentTime = 4_500;
  refresher.handleOutbound(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread-789",
      turnId: "turn-789",
    },
  }));
  await wait(10);

  currentTime = 4_700;
  refresher.handleOutbound(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread-789",
      turnId: "turn-789",
    },
  }));
  await wait(10);

  assert.deepEqual(refreshCalls, [
    "codex://threads/thread-789",
  ]);
  assert.equal(stopCount, 1);
});

test("turn/completed remounts Codex by default without killing the app", async () => {
  const commandCalls = [];
  const sleepCalls = [];
  let watcherHooks = null;

  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 0,
    bundleId: "com.openai.codex",
    appPath: "/Applications/Codex.app",
    commandExecutor: async (command, args, options) => {
      commandCalls.push([command, args, options]);
      return { stdout: "", stderr: "" };
    },
    sleepFn: async (ms) => {
      sleepCalls.push(ms);
    },
    watchThreadRolloutFactory: (hooks) => {
      watcherHooks = hooks;
      return { stop() {} };
    },
  });

  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: {
      threadId: "thread-relaunch",
    },
  }));
  await wait(10);

  watcherHooks.onEvent({
    reason: "materialized",
    threadId: "thread-relaunch",
    size: 12,
  });
  refresher.handleOutbound(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread-relaunch",
      turnId: "turn-relaunch",
    },
  }));
  await wait(10);

  assert.equal(commandCalls.length, 1);
  assert.equal(commandCalls[0][0], "osascript");
  assert.equal(commandCalls[0][1][1], "com.openai.codex");
  assert.equal(commandCalls[0][1][2], "/Applications/Codex.app");
  assert.equal(commandCalls[0][1][3], "codex://threads/thread-relaunch");
  assert.deepEqual(sleepCalls, []);
});

test("turn/completed is retried after a slow in-flight refresh finishes", async () => {
  const refreshCalls = [];
  let releaseSlowRefresh = null;

  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 0,
    refreshExecutor: async (targetUrl) => {
      refreshCalls.push(targetUrl);
      if (refreshCalls.length === 1) {
        await new Promise((resolve) => {
          releaseSlowRefresh = resolve;
        });
      }
    },
    watchThreadRolloutFactory: () => ({ stop() {} }),
  });

  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: {
      threadId: "thread-slow",
    },
  }));
  await wait(10);

  refresher.handleOutbound(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread-slow",
      turnId: "turn-slow-1",
    },
  }));
  await wait(10);

  refresher.handleOutbound(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread-slow",
      turnId: "turn-slow-2",
    },
  }));
  await wait(10);

  assert.equal(refreshCalls.length, 1);

  releaseSlowRefresh?.();
  await wait(20);

  assert.deepEqual(refreshCalls, [
    "codex://threads/thread-slow",
    "codex://threads/thread-slow",
  ]);
});

test("completion refresh keeps its own thread target even if another thread queues behind it", async () => {
  const refreshCalls = [];
  let stopCount = 0;
  const watcherHooksByThread = new Map();

  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 1_200,
    refreshExecutor: async (targetUrl) => {
      refreshCalls.push(targetUrl);
    },
    watchThreadRolloutFactory: (hooks) => {
      const { threadId } = hooks;
      watcherHooksByThread.set(threadId, hooks);
      return {
        stop() {
          if (threadId === "thread-a") {
            stopCount += 1;
          }
        },
      };
    },
  });

  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: { threadId: "thread-a" },
  }));
  await wait(10);
  refreshCalls.length = 0;
  refresher.clearRefreshTimer();

  refresher.handleOutbound(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread-a",
      turnId: "turn-a",
    },
  }));
  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: { threadId: "thread-b" },
  }));
  watcherHooksByThread.get("thread-b").onEvent({
    reason: "materialized",
    threadId: "thread-b",
    size: 20,
  });
  refresher.queueRefresh("rollout_materialized", {
    threadId: "thread-b",
    url: "codex://threads/thread-b",
  }, "rollout materialized");
  refresher.clearRefreshTimer();
  await refresher.runPendingRefresh();
  await refresher.runPendingRefresh();

  assert.deepEqual(refreshCalls, [
    "codex://threads/thread-a",
    "codex://threads/thread-b",
  ]);
  assert.equal(stopCount, 1);
});

test("handleTransportReset cancels pending refreshes and clears watcher state", async () => {
  const refreshCalls = [];
  let stopCount = 0;

  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 30,
    refreshExecutor: async (targetUrl) => {
      refreshCalls.push(targetUrl);
    },
    watchThreadRolloutFactory: () => ({
      stop() {
        stopCount += 1;
      },
    }),
  });

  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: {
      threadId: "thread-reset",
    },
  }));
  refresher.handleTransportReset();
  await wait(50);

  assert.deepEqual(refreshCalls, []);
  assert.equal(stopCount, 1);
});

test("handleTransportReset clears duplicate-target memory so the next refresh can run", async () => {
  const refreshCalls = [];
  let currentTime = 5_000;

  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 1_200,
    now: () => currentTime,
    refreshExecutor: async (targetUrl) => {
      refreshCalls.push(targetUrl);
    },
    watchThreadRolloutFactory: () => ({ stop() {} }),
  });

  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: { threadId: "thread-reset-dedupe" },
  }));
  refresher.handleOutbound(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread-reset-dedupe",
      turnId: "turn-reset-dedupe-1",
    },
  }));
  await wait(10);

  refresher.handleTransportReset();

  currentTime = 5_100;
  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: { threadId: "thread-reset-dedupe" },
  }));
  refresher.handleOutbound(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread-reset-dedupe",
      turnId: "turn-reset-dedupe-2",
    },
  }));
  await wait(10);

  assert.deepEqual(refreshCalls, [
    "codex://threads/thread-reset-dedupe",
    "codex://threads/thread-reset-dedupe",
  ]);
});

test("desktop refresh disables itself after a desktop-unavailable AppleScript failure", async () => {
  let attempts = 0;
  let stopCount = 0;

  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 0,
    refreshBackend: "applescript",
    refreshExecutor: async () => {
      attempts += 1;
      throw new Error("Unable to find application named Codex");
    },
    watchThreadRolloutFactory: () => ({
      stop() {
        stopCount += 1;
      },
    }),
  });

  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: {
      threadId: "thread-disable-1",
    },
  }));
  refresher.handleOutbound(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread-disable-1",
      turnId: "turn-disable-1",
    },
  }));
  await wait(10);

  refresher.handleInbound(JSON.stringify({
    method: "turn/start",
    params: {
      threadId: "thread-disable-2",
    },
  }));
  await wait(10);

  assert.equal(attempts, 1);
  assert.equal(stopCount, 1);
  assert.equal(refresher.runtimeRefreshAvailable, false);
});

test("custom refresh commands only disable after repeated failures", async () => {
  let attempts = 0;

  const refresher = new CodexDesktopRefresher({
    enabled: true,
    debounceMs: 0,
    refreshBackend: "command",
    customRefreshFailureThreshold: 3,
    refreshExecutor: async () => {
      attempts += 1;
      throw new Error("command failed");
    },
  });

  for (const threadId of ["thread-cmd-1", "thread-cmd-2", "thread-cmd-3", "thread-cmd-4"]) {
    refresher.handleInbound(JSON.stringify({
      method: "turn/start",
      params: { threadId },
    }));
    refresher.handleOutbound(JSON.stringify({
      method: "turn/completed",
      params: {
        threadId,
        turnId: `${threadId}-turn`,
      },
    }));
    await wait(10);
  }

  assert.equal(attempts, 3);
  assert.equal(refresher.runtimeRefreshAvailable, false);
});

test("rollout watcher retries transient filesystem errors before succeeding", async () => {
  const events = [];
  const errors = [];
  let readdirCalls = 0;

  const watcher = createThreadRolloutActivityWatcher({
    threadId: "thread-watch-ok",
    intervalMs: 5,
    lookupTimeoutMs: 100,
    idleTimeoutMs: 100,
    transientErrorRetryLimit: 2,
    fsModule: {
      existsSync: () => true,
      readdirSync: () => {
        readdirCalls += 1;
        if (readdirCalls === 1) {
          const error = new Error("temporary missing dir");
          error.code = "ENOENT";
          throw error;
        }

        return [{
          name: "rollout-thread-watch-ok.jsonl",
          isDirectory: () => false,
          isFile: () => true,
        }];
      },
      statSync: () => ({ size: 12, mtimeMs: Date.now() }),
      openSync: () => 1,
      readSync: (_fd, buffer) => {
        buffer.write('{"x":1}\n', 0, "utf8");
        return 8;
      },
      closeSync: () => {},
    },
    onEvent: (event) => events.push(event),
    onError: (error) => errors.push(error),
  });

  await wait(25);
  watcher.stop();

  assert.equal(errors.length, 0);
  assert.equal(events[0]?.reason, "materialized");
});

test("rollout watcher stops after repeated transient filesystem failures", async () => {
  const errors = [];
  let currentTime = 0;

  const watcher = createThreadRolloutActivityWatcher({
    threadId: "thread-watch-fail",
    intervalMs: 5,
    lookupTimeoutMs: 100,
    idleTimeoutMs: 100,
    transientErrorRetryLimit: 1,
    now: () => {
      currentTime += 5;
      return currentTime;
    },
    fsModule: {
      existsSync: () => true,
      readdirSync: () => {
        const error = new Error("still missing");
        error.code = "ENOENT";
        throw error;
      },
    },
    onError: (error) => errors.push(error),
  });

  await wait(25);
  watcher.stop();

  assert.equal(errors.length, 1);
});
