// FILE: remodex-cli.test.js
// Purpose: Verifies the public CLI exposes version, service control, and machine-readable status output.
// Layer: Integration-lite test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, child_process, path, ../package.json, ../bin/remodex

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const path = require("path");
const { version } = require("../package.json");
const { main } = require("../bin/remodex");

test("domaeng --version prints the package version", () => {
  const cliPath = path.join(__dirname, "..", "bin", "remodex.js");
  const output = execFileSync(process.execPath, [cliPath, "--version"], {
    encoding: "utf8",
  }).trim();

  assert.equal(output, version);
});

test("domaeng restart reuses the macOS service start flow", async () => {
  const calls = [];
  const messages = [];

  await main({
    argv: ["node", "domaeng", "restart"],
    platform: "darwin",
    consoleImpl: {
      log(message) {
        messages.push(message);
      },
      error(message) {
        messages.push(message);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      readBridgeConfig() {
        calls.push("read-config");
      },
      async startMacOSBridgeService(options) {
        calls.push(["start-service", options]);
        return {
          plistPath: "/tmp/remodex.plist",
          pairingSession: { pairingPayload: { sessionId: "session-restart" } },
          config: { relayUrl: "ws://192.168.1.44:9000/relay" },
          localRelay: { managed: true, alreadyRunning: true, port: 9000 },
        };
      },
      printMacOSBridgePairingQr(options) {
        calls.push(["print-qr", options]);
      },
    },
  });

  assert.deepEqual(calls, [
    "read-config",
    ["start-service", { waitForPairing: true }],
    ["print-qr", {
      pairingSession: { pairingPayload: { sessionId: "session-restart" } },
      showQRCode: false,
    }],
  ]);
  assert.deepEqual(messages, [
    "[domaeng] macOS bridge service restarted.",
    [
      "",
      "[domaeng] Domaeng is running in the background. You can close this Terminal window.",
      "",
      "=== Web app ===",
      "  http://192.168.1.44:9000/app/",
      "",
      "Relay:",
      "  Active relay: ws://192.168.1.44:9000/relay",
      "  Local relay: already running on port 9000",
      "",
      "Manage:",
      "  domaeng status",
      "  domaeng restart",
      "  domaeng stop",
      "  domaeng renew-pairing",
      "",
      "Optional menu bar control (unsigned/adhoc-signed; macOS may require approval):",
      "  domaeng menubar install",
      "  domaeng menubar open",
    ].join("\n"),
  ]);
});

test("domaeng up shows a startup indicator while waiting for the pairing code", async () => {
  const calls = [];
  const messages = [];

  await main({
    argv: ["node", "domaeng", "up"],
    platform: "darwin",
    consoleImpl: {
      log(message) {
        messages.push(message);
      },
      error(message) {
        messages.push(message);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      async startMacOSBridgeService(options) {
        calls.push(["start-service", options]);
        return {
          pairingSession: { pairingPayload: { sessionId: "session-up" } },
          config: { relayUrl: "ws://192.168.1.44:9000/relay" },
          localRelay: { managed: true, started: true, port: 9000 },
        };
      },
      printMacOSBridgePairingQr(options) {
        calls.push(["print-qr", options]);
      },
    },
  });

  assert.deepEqual(messages, [
    "[domaeng] Starting bridge and pairing code...",
    [
      "",
      "[domaeng] Domaeng is running in the background. You can close this Terminal window.",
      "",
      "=== Web app ===",
      "  http://192.168.1.44:9000/app/",
      "",
      "Relay:",
      "  Active relay: ws://192.168.1.44:9000/relay",
      "  Local relay: started on port 9000",
      "",
      "Manage:",
      "  domaeng status",
      "  domaeng restart",
      "  domaeng stop",
      "  domaeng renew-pairing",
      "",
      "Optional menu bar control (unsigned/adhoc-signed; macOS may require approval):",
      "  domaeng menubar install",
      "  domaeng menubar open",
    ].join("\n"),
  ]);
  assert.deepEqual(calls, [
    ["start-service", { waitForPairing: true }],
    ["print-qr", { pairingSession: { pairingPayload: { sessionId: "session-up" } }, showQRCode: false }],
  ]);
});

test("domaeng status --json exposes daemon metadata for companion apps", async () => {
  const writes = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    writes.push(String(chunk));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    await main({
      argv: ["node", "domaeng", "status", "--json"],
      platform: "darwin",
      consoleImpl: {
        log() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        getMacOSBridgeServiceStatus() {
          return {
            daemonConfig: {
              relayUrl: "ws://127.0.0.1:9000/relay",
            },
            bridgeStatus: {
              connectionStatus: "connected",
              pid: 77,
            },
            pairingSession: {
              pairingPayload: {
                relay: "ws://127.0.0.1:9000/relay",
                sessionId: "session-json",
              },
            },
          };
        },
        printMacOSBridgeServiceStatus() {
          throw new Error("status printer should not run for --json");
        },
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const payload = JSON.parse(writes.join("").trim());
  assert.equal(payload.currentVersion, version);
  assert.equal(payload.daemonConfig?.relayUrl, "ws://127.0.0.1:9000/relay");
  assert.equal(payload.bridgeStatus?.connectionStatus, "connected");
  assert.equal(payload.pairingSession?.pairingPayload?.sessionId, "session-json");
});

test("domaeng trusted-device disable emits machine-readable result", async () => {
  const writes = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    writes.push(String(chunk));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    await main({
      argv: ["node", "domaeng", "trusted-device", "disable", "dev_abc123", "--json"],
      platform: "darwin",
      consoleImpl: {
        log() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        setTrustedDeviceEnabled(deviceId, enabled) {
          return {
            trustedDevice: {
              id: deviceId,
              status: enabled ? "enabled" : "disabled",
            },
            trustedDevices: [],
          };
        },
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const payload = JSON.parse(writes.join("").trim());
  assert.equal(payload.ok, true);
  assert.equal(payload.action, "disable");
  assert.equal(payload.trustedDevice.id, "dev_abc123");
  assert.equal(payload.trustedDevice.status, "disabled");
});

test("domaeng menubar install reports the unsigned companion app path", async () => {
  const messages = [];

  await main({
    argv: ["node", "domaeng", "menubar", "install"],
    platform: "darwin",
    consoleImpl: {
      log(message) {
        messages.push(message);
      },
      error(message) {
        throw new Error(`unexpected error: ${message}`);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      installMenuBarApp() {
        return {
          installedAppPath: "/Users/tester/Applications/DomaengMenuBar.app",
          signed: false,
        };
      },
    },
  });

  assert.deepEqual(messages, [
    "[domaeng] Installed optional unsigned/adhoc-signed DomaengMenuBar.app to /Users/tester/Applications/DomaengMenuBar.app. macOS may require manual approval on first launch.",
  ]);
});

test("domaeng menubar status emits machine-readable bundled state", async () => {
  const writes = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    writes.push(String(chunk));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    await main({
      argv: ["node", "domaeng", "menubar", "status", "--json"],
      platform: "darwin",
      consoleImpl: {
        log() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        getMenuBarAppStatus() {
          return {
            bundled: true,
            bundledAppPath: "/pkg/bundled/menubar/DomaengMenuBar.app",
            installed: false,
            installedAppPath: "/Users/tester/Applications/DomaengMenuBar.app",
            signed: false,
          };
        },
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const payload = JSON.parse(writes.join("").trim());
  assert.equal(payload.ok, true);
  assert.equal(payload.action, "status");
  assert.equal(payload.bundled, true);
  assert.equal(payload.signed, false);
});

test("domaeng renew-pairing emits the fresh daemon pairing session", async () => {
  const writes = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    writes.push(String(chunk));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    await main({
      argv: ["node", "domaeng", "renew-pairing", "--json"],
      platform: "darwin",
      consoleImpl: {
        log() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        async requestMacOSBridgePairingRenewal(options) {
          assert.deepEqual(options, { waitForPairing: true });
          return {
            request: { id: "renew-1" },
            pairingSession: {
              pairingCode: "ABCD2345EF",
              pairingPayload: {
                sessionId: "session-renewed",
              },
            },
          };
        },
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const payload = JSON.parse(writes.join("").trim());
  assert.equal(payload.ok, true);
  assert.equal(payload.request.id, "renew-1");
  assert.equal(payload.pairingSession.pairingPayload.sessionId, "session-renewed");
});

test("domaeng renew-pairing prints the renewed QR/code and Web App URL", async () => {
  const calls = [];
  const messages = [];
  const pairingSession = {
    pairingCode: "ABCD2345EF",
    pairingPayload: {
      relay: "ws://192.168.1.44:9000/relay",
      sessionId: "session-renewed",
    },
  };

  await main({
    argv: ["node", "domaeng", "renew-pairing"],
    platform: "darwin",
    consoleImpl: {
      log(message) {
        messages.push(message);
      },
      error(message) {
        throw new Error(`unexpected error: ${message}`);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      async requestMacOSBridgePairingRenewal(options) {
        calls.push(["renew", options]);
        return {
          request: { id: "renew-1" },
          pairingSession,
        };
      },
      printMacOSBridgePairingQr(options) {
        calls.push(["print-qr", options]);
      },
    },
  });

  assert.deepEqual(calls, [
    ["renew", { waitForPairing: true }],
    ["print-qr", { pairingSession, showQRCode: true }],
  ]);
  assert.deepEqual(messages, [
    "[domaeng] Pairing code renewed.",
    [
      "=== Web app ===",
      "  http://192.168.1.44:9000/app/",
      "",
      "Relay:",
      "  Active relay: ws://192.168.1.44:9000/relay",
    ].join("\n"),
  ]);
});
