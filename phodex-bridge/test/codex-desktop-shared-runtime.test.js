// FILE: codex-desktop-shared-runtime.test.js
// Purpose: Verifies Codex.app can be pointed at the bridge-managed shared runtime.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/codex-desktop-shared-runtime

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CodexDesktopSharedRuntime,
  launchCodexAppWithEndpoint,
} = require("../src/codex-desktop-shared-runtime");

test("CodexDesktopSharedRuntime sets launchd env and restarts Codex.app with the endpoint", async () => {
  const execCalls = [];
  const spawnCalls = [];
  let running = true;

  const runtime = new CodexDesktopSharedRuntime({
    enabled: true,
    platform: "darwin",
    appPath: "/Applications/Codex.app",
    executor: async (command, args, options) => {
      execCalls.push({ command, args, options });
      if (command === "pkill") {
        running = false;
      }
    },
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      return { unref() {} };
    },
    setLaunchctlEnvironment: true,
    isAppRunning: async () => running,
    sleepFn: async () => {},
  });

  const result = await runtime.activate("ws://127.0.0.1:4567");

  assert.deepEqual(result, {
    activated: true,
    endpoint: "ws://127.0.0.1:4567",
  });
  assert.deepEqual(
    execCalls.map((call) => [call.command, call.args]),
    [
      ["launchctl", ["setenv", "CODEX_APP_SERVER_WS_URL", "ws://127.0.0.1:4567"]],
      ["pkill", ["-x", "Codex"]],
    ]
  );
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "/Applications/Codex.app/Contents/MacOS/Codex");
  assert.equal(spawnCalls[0].options.env.CODEX_APP_SERVER_WS_URL, "ws://127.0.0.1:4567");
  assert.equal(spawnCalls[0].options.detached, true);
});

test("CodexDesktopSharedRuntime skips repeated activation for the same endpoint", async () => {
  let execCount = 0;
  let spawnCount = 0;
  const runtime = new CodexDesktopSharedRuntime({
    enabled: true,
    platform: "darwin",
    executor: async () => {
      execCount += 1;
    },
    spawnImpl: () => {
      spawnCount += 1;
      return { unref() {} };
    },
    isAppRunning: async () => false,
    sleepFn: async () => {},
  });

  await runtime.activate("ws://127.0.0.1:4567");
  const second = await runtime.activate("ws://127.0.0.1:4567");

  assert.equal(execCount, 0);
  assert.equal(spawnCount, 1);
  assert.deepEqual(second, {
    activated: true,
    endpoint: "ws://127.0.0.1:4567",
    unchanged: true,
  });
});

test("launchCodexAppWithEndpoint injects only the shared runtime env var", () => {
  const spawnCalls = [];
  launchCodexAppWithEndpoint({
    appPath: "/Applications/Codex.app",
    endpoint: "ws://127.0.0.1:9999",
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      return { unref() {} };
    },
  });

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "/Applications/Codex.app/Contents/MacOS/Codex");
  assert.deepEqual(spawnCalls[0].args, []);
  assert.equal(spawnCalls[0].options.env.CODEX_APP_SERVER_WS_URL, "ws://127.0.0.1:9999");
});
