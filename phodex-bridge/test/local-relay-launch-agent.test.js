// FILE: local-relay-launch-agent.test.js
// Purpose: Verifies source-checkout local relay launchd helpers used by menu bar startup.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/local-relay-launch-agent

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildLocalRelayLaunchAgentPlist,
  resolveLocalRelayPort,
  resolveRelayServerModule,
  shouldManageLocalRelay,
  startLocalRelayService,
} = require("../src/local-relay-launch-agent");

test("shouldManageLocalRelay covers LAN and Tailscale relay URLs only by default", () => {
  assert.equal(shouldManageLocalRelay("ws://mac.local:9000/relay"), true);
  assert.equal(shouldManageLocalRelay("ws://127.0.0.1:9000/relay"), true);
  assert.equal(shouldManageLocalRelay("wss://mac.tailnet.ts.net/relay"), true);
  assert.equal(shouldManageLocalRelay("wss://relay.example.com/relay"), false);
  assert.equal(shouldManageLocalRelay("wss://relay.example.com/relay", {
    env: { DOMAENG_LOCAL_RELAY_ENABLED: "true" },
  }), true);
});

test("resolveLocalRelayPort defaults Tailscale relays to local port 9000", () => {
  assert.equal(resolveLocalRelayPort("wss://mac.tailnet.ts.net/relay", {}), 9000);
  assert.equal(resolveLocalRelayPort("ws://mac.local:9100/relay", {}), 9100);
  assert.equal(resolveLocalRelayPort("ws://mac.local:9100/relay", {
    DOMAENG_LOCAL_RELAY_PORT: "9200",
  }), 9200);
});

test("buildLocalRelayLaunchAgentPlist points launchd at the local relay service runner", () => {
  const plist = buildLocalRelayLaunchAgentPlist({
    homeDir: "/Users/tester",
    pathEnv: "/usr/local/bin:/usr/bin",
    nodePath: "/usr/local/bin/node",
    cliPath: "/repo/phodex-bridge/bin/remodex.js",
    runtimeRoot: "/repo/phodex-bridge",
    relayServerModule: "/repo/relay/server.js",
    webAppDir: "/repo/web/dist",
    port: 9000,
    bindHost: "0.0.0.0",
    stdoutLogPath: "/Users/tester/.remodex/logs/relay.stdout.log",
    stderrLogPath: "/Users/tester/.remodex/logs/relay.stderr.log",
  });

  assert.match(plist, /<string>com\.domaeng\.relay<\/string>/);
  assert.match(plist, /<string>run-local-relay-service<\/string>/);
  assert.match(plist, /<key>DOMAENG_RELAY_SERVER_MODULE<\/key>/);
  assert.match(plist, /<string>\/repo\/relay\/server\.js<\/string>/);
  assert.match(plist, /<key>DOMAENG_WEB_APP_DIR<\/key>/);
  assert.match(plist, /<string>\/repo\/web\/dist<\/string>/);
  assert.match(plist, /<key>NODE_PATH<\/key>/);
  assert.match(plist, /<string>\/repo\/phodex-bridge\/node_modules<\/string>/);
});

test("resolveRelayServerModule finds the sibling relay server in a source checkout", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "domaeng-relay-module-"));
  try {
    fs.mkdirSync(path.join(rootDir, "phodex-bridge"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "relay"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "relay", "server.js"), "module.exports = {};");

    assert.equal(
      resolveRelayServerModule({
        runtimeRoot: path.join(rootDir, "phodex-bridge"),
      }),
      path.join(rootDir, "relay", "server.js")
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("startLocalRelayService bootstraps launchd when local relay health is down", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "domaeng-local-relay-"));
  try {
    fs.mkdirSync(path.join(rootDir, "phodex-bridge"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "relay"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "web", "dist"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "relay", "server.js"), "module.exports = {};");

    const calls = [];
    const result = await startLocalRelayService({
      config: { relayUrl: "ws://mac.local:9000/relay" },
      env: { HOME: rootDir, PATH: "/usr/bin", REMODEX_DEVICE_STATE_DIR: rootDir },
      platform: "darwin",
      runtimeRoot: path.join(rootDir, "phodex-bridge"),
      nodePath: "/usr/local/bin/node",
      cliPath: "/repo/phodex-bridge/bin/remodex.js",
      healthCheck: async () => false,
      execFileSyncImpl(command, args) {
        calls.push([command, args]);
        if (args[0] === "bootout") {
          const error = new Error("Could not find service");
          error.stderr = Buffer.from("Could not find service");
          throw error;
        }
      },
    });

    assert.equal(result.managed, true);
    assert.equal(result.started, true);
    assert.deepEqual(
      calls.map(([command, args]) => [command, args[0], args[1], args[2]]),
      [
        ["launchctl", "bootout", `gui/${process.getuid()}`, path.join(rootDir, "Library", "LaunchAgents", "com.domaeng.relay.plist")],
        ["launchctl", "bootout", `gui/${process.getuid()}/com.domaeng.relay`, undefined],
        ["launchctl", "bootstrap", `gui/${process.getuid()}`, path.join(rootDir, "Library", "LaunchAgents", "com.domaeng.relay.plist")],
        ["launchctl", "kickstart", "-k", `gui/${process.getuid()}/com.domaeng.relay`],
      ]
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
