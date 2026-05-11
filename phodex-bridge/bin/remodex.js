#!/usr/bin/env node
// FILE: remodex.js
// Purpose: CLI surface for foreground bridge runs, pairing reset, thread resume, and macOS service control.
// Layer: CLI binary
// Exports: none
// Depends on: ../src

const {
  getMacOSBridgeServiceStatus,
  getMenuBarAppStatus,
  installMenuBarApp,
  openMenuBarApp,
  printMacOSBridgePairingQr,
  printMacOSBridgeServiceStatus,
  readBridgeConfig,
  requestMacOSBridgePairingRenewal,
  resetMacOSBridgePairing,
  renameTrustedDevice,
  runLocalRelayService,
  runMacOSBridgeService,
  revokeTrustedDevice,
  startBridge,
  startMacOSBridgeService,
  startLocalRelayService,
  stopMacOSBridgeService,
  stopLocalRelayService,
  setTrustedDeviceEnabled,
  resetBridgePairing,
  openLastActiveThread,
  watchThreadRollout,
} = require("../src");
const { version } = require("../package.json");

const defaultDeps = {
  getMacOSBridgeServiceStatus,
  getMenuBarAppStatus,
  installMenuBarApp,
  openMenuBarApp,
  printMacOSBridgePairingQr,
  printMacOSBridgeServiceStatus,
  readBridgeConfig,
  requestMacOSBridgePairingRenewal,
  resetMacOSBridgePairing,
  renameTrustedDevice,
  runLocalRelayService,
  runMacOSBridgeService,
  revokeTrustedDevice,
  startBridge,
  startMacOSBridgeService,
  startLocalRelayService,
  stopMacOSBridgeService,
  stopLocalRelayService,
  setTrustedDeviceEnabled,
  resetBridgePairing,
  openLastActiveThread,
  watchThreadRollout,
};

if (require.main === module) {
  void main();
}

// ─── ENTRY POINT ─────────────────────────────────────────────

async function main({
  argv = process.argv,
  platform = process.platform,
  consoleImpl = console,
  exitImpl = process.exit,
  deps = defaultDeps,
} = {}) {
  const {
    command,
    jsonOutput,
    watchThreadId,
    trustedDeviceAction,
    trustedDeviceId,
    trustedDeviceName,
    menuBarAction,
  } = parseCliArgs(argv.slice(2));

  if (isVersionCommand(command)) {
    emitVersion({ jsonOutput, consoleImpl });
    return;
  }

  if (command === "up") {
    if (platform === "darwin") {
      consoleImpl.log("[domaeng] Starting bridge and pairing QR...");
      const result = await deps.startMacOSBridgeService({
        waitForPairing: true,
      });
      deps.printMacOSBridgePairingQr({
        pairingSession: result.pairingSession,
      });
      printUpManagementHelp({
        config: result.config,
        localRelay: result.localRelay,
        consoleImpl,
      });
      return;
    }

    deps.startBridge();
    return;
  }

  if (command === "run") {
    deps.startBridge();
    return;
  }

  if (command === "run-service") {
    deps.runMacOSBridgeService();
    return;
  }

  if (command === "run-local-relay-service") {
    deps.runLocalRelayService();
    return;
  }

  if (command === "start") {
    assertMacOSCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    deps.readBridgeConfig();
    const result = await deps.startMacOSBridgeService({
      waitForPairing: false,
    });
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
        plistPath: result?.plistPath,
        pairingSession: result?.pairingSession,
      },
      message: "[domaeng] macOS bridge service is running.",
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (command === "restart") {
    assertMacOSCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    deps.readBridgeConfig();
    const result = await deps.startMacOSBridgeService({
      waitForPairing: false,
    });
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
        plistPath: result?.plistPath,
        pairingSession: result?.pairingSession,
      },
      message: "[domaeng] macOS bridge service restarted.",
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (command === "stop") {
    assertMacOSCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    deps.stopMacOSBridgeService();
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
      },
      message: "[domaeng] macOS bridge service stopped.",
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (command === "status") {
    assertMacOSCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    if (jsonOutput) {
      emitJson({
        ...deps.getMacOSBridgeServiceStatus(),
        currentVersion: version,
      });
      return;
    }
    deps.printMacOSBridgeServiceStatus();
    return;
  }

  if (command === "reset-pairing") {
    try {
      if (platform === "darwin") {
        deps.resetMacOSBridgePairing();
        emitResult({
          payload: {
            ok: true,
            currentVersion: version,
            platform: "darwin",
          },
          message: "[domaeng] Stopped the macOS bridge service and cleared the saved pairing state. Run `domaeng up` to pair again.",
          jsonOutput,
          consoleImpl,
        });
      } else {
        deps.resetBridgePairing();
        emitResult({
          payload: {
            ok: true,
            currentVersion: version,
            platform,
          },
          message: "[domaeng] Cleared the saved pairing state. Run `domaeng up` to pair again.",
          jsonOutput,
          consoleImpl,
        });
      }
    } catch (error) {
      consoleImpl.error(`[domaeng] ${(error && error.message) || "Failed to clear the saved pairing state."}`);
      exitImpl(1);
    }
    return;
  }

  if (command === "renew-pairing") {
    assertMacOSCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    try {
      const result = await deps.requestMacOSBridgePairingRenewal({
        waitForPairing: true,
      });
      emitResult({
        payload: {
          ok: true,
          currentVersion: version,
          pairingSession: result?.pairingSession || null,
          request: result?.request || null,
        },
        message: "[domaeng] Pairing code renewed.",
        jsonOutput,
        consoleImpl,
      });
    } catch (error) {
      consoleImpl.error(`[domaeng] ${(error && error.message) || "Failed to renew the pairing code."}`);
      exitImpl(1);
    }
    return;
  }

  if (command === "trusted-device") {
    try {
      const result = runTrustedDeviceCommand({
        action: trustedDeviceAction,
        deviceId: trustedDeviceId,
        displayName: trustedDeviceName,
        deps,
      });
      emitResult({
        payload: {
          ok: true,
          currentVersion: version,
          action: trustedDeviceAction,
          ...result,
        },
        message: trustedDeviceActionMessage(trustedDeviceAction),
        jsonOutput,
        consoleImpl,
      });
    } catch (error) {
      consoleImpl.error(`[domaeng] ${(error && error.message) || "Failed to update the trusted device."}`);
      exitImpl(1);
    }
    return;
  }

  if (command === "menubar") {
    assertMacOSCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    try {
      const result = runMenuBarCommand({
        action: menuBarAction,
        deps,
      });
      emitResult({
        payload: {
          ok: true,
          currentVersion: version,
          action: menuBarAction || "status",
          ...result,
        },
        message: menuBarActionMessage(menuBarAction, result),
        jsonOutput,
        consoleImpl,
      });
    } catch (error) {
      consoleImpl.error(`[domaeng] ${(error && error.message) || "Failed to control the menu bar app."}`);
      exitImpl(1);
    }
    return;
  }

  if (command === "resume") {
    try {
      const state = deps.openLastActiveThread();
      emitResult({
        payload: {
          ok: true,
          currentVersion: version,
          threadId: state.threadId,
          source: state.source || "unknown",
        },
        message: `[domaeng] Opened last active thread: ${state.threadId} (${state.source || "unknown"})`,
        jsonOutput,
        consoleImpl,
      });
    } catch (error) {
      consoleImpl.error(`[domaeng] ${(error && error.message) || "Failed to reopen the last thread."}`);
      exitImpl(1);
    }
    return;
  }

  if (command === "watch") {
    try {
      deps.watchThreadRollout(watchThreadId);
    } catch (error) {
      consoleImpl.error(`[domaeng] ${(error && error.message) || "Failed to watch the thread rollout."}`);
      exitImpl(1);
    }
    return;
  }

  consoleImpl.error(`Unknown command: ${command}`);
  consoleImpl.error(
    "Usage: domaeng up | domaeng run | domaeng start | domaeng restart | domaeng stop | domaeng status | "
    + "domaeng reset-pairing | domaeng renew-pairing | "
    + "domaeng trusted-device <enable|disable|revoke|rename> <id> [name] | "
    + "domaeng menubar <status|install|open> | "
    + "domaeng resume | domaeng watch [threadId] | domaeng --version | "
    + "append --json to start/restart/stop/status/reset-pairing/renew-pairing/trusted-device/menubar/resume for machine-readable output"
  );
  exitImpl(1);
}

function parseCliArgs(rawArgs) {
  const positionals = [];
  let jsonOutput = false;

  for (const arg of rawArgs) {
    if (arg === "--json") {
      jsonOutput = true;
      continue;
    }

    positionals.push(arg);
  }

  return {
    command: positionals[0] || "up",
    jsonOutput,
    watchThreadId: positionals[1] || "",
    trustedDeviceAction: positionals[1] || "",
    trustedDeviceId: positionals[2] || "",
    trustedDeviceName: positionals.slice(3).join(" "),
    menuBarAction: positionals[1] || "status",
  };
}

function runMenuBarCommand({ action, deps }) {
  const normalizedAction = action || "status";
  if (normalizedAction === "status") {
    return deps.getMenuBarAppStatus();
  }
  if (normalizedAction === "install") {
    return deps.installMenuBarApp();
  }
  if (normalizedAction === "open") {
    return deps.openMenuBarApp();
  }
  throw new Error("Usage: domaeng menubar <status|install|open>");
}

function printUpManagementHelp({
  config = {},
  localRelay = null,
  consoleImpl = console,
} = {}) {
  const relayUrl = readNonEmptyString(config?.relayUrl) || "unknown";
  const webAppUrl = webAppUrlFromRelayUrl(relayUrl) || "unknown";
  const localRelayStatus = localRelayStatusLine(localRelay);
  consoleImpl.log([
    "",
    "[domaeng] Domaeng is running in the background. You can close this Terminal window.",
    "",
    "Relay:",
    `  Active relay: ${relayUrl}`,
    `  Web app: ${webAppUrl}`,
    `  Local relay: ${localRelayStatus}`,
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
  ].join("\n"));
}

function localRelayStatusLine(localRelay) {
  if (!localRelay?.managed) {
    return `not managed${localRelay?.reason ? ` (${localRelay.reason})` : ""}`;
  }

  const state = localRelay.started ? "started" : (localRelay.alreadyRunning ? "already running" : "managed");
  return `${state} on port ${localRelay.port || "unknown"}`;
}

function webAppUrlFromRelayUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    } else if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.at(-1) === "relay") {
      parts.pop();
    }
    parts.push("app");
    url.pathname = `/${parts.join("/")}/`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function menuBarActionMessage(action, result = {}) {
  switch (action || "status") {
  case "install":
    return `[domaeng] Installed optional unsigned/adhoc-signed DomaengMenuBar.app to ${result.installedAppPath}. macOS may require manual approval on first launch.`;
  case "open":
    return `[domaeng] Opened optional unsigned/adhoc-signed DomaengMenuBar.app from ${result.appPath}. macOS may require manual approval on first launch.`;
  case "status":
    if (result.bundled && result.installed) {
      return `[domaeng] Optional unsigned/adhoc-signed DomaengMenuBar.app is bundled and installed at ${result.installedAppPath}.`;
    }
    if (result.bundled) {
      return "[domaeng] Optional unsigned/adhoc-signed DomaengMenuBar.app is bundled but not installed. Run `domaeng menubar install`.";
    }
    return "[domaeng] Optional DomaengMenuBar.app is not bundled with this install.";
  default:
    return "[domaeng] Menu bar app command completed.";
  }
}

function runTrustedDeviceCommand({ action, deviceId, displayName, deps }) {
  if (!deviceId || !["enable", "disable", "revoke", "rename"].includes(action)) {
    throw new Error("Usage: domaeng trusted-device <enable|disable|revoke|rename> <id> [name]");
  }

  if (action === "enable") {
    return deps.setTrustedDeviceEnabled(deviceId, true);
  }
  if (action === "disable") {
    return deps.setTrustedDeviceEnabled(deviceId, false);
  }
  if (action === "revoke") {
    return deps.revokeTrustedDevice(deviceId);
  }

  const normalizedDisplayName = typeof displayName === "string" ? displayName.trim() : "";
  if (!normalizedDisplayName) {
    throw new Error("Usage: domaeng trusted-device rename <id> <name>");
  }
  return deps.renameTrustedDevice(deviceId, normalizedDisplayName);
}

function trustedDeviceActionMessage(action) {
  switch (action) {
  case "enable":
    return "[domaeng] Trusted device enabled.";
  case "disable":
    return "[domaeng] Trusted device disabled.";
  case "revoke":
    return "[domaeng] Trusted device removed.";
  case "rename":
    return "[domaeng] Trusted device renamed.";
  default:
    return "[domaeng] Trusted device updated.";
  }
}

function emitVersion({
  jsonOutput = false,
  consoleImpl = console,
} = {}) {
  if (jsonOutput) {
    emitJson({
      currentVersion: version,
    });
    return;
  }

  consoleImpl.log(version);
}

function emitResult({
  payload,
  message,
  jsonOutput = false,
  consoleImpl = console,
} = {}) {
  if (jsonOutput) {
    emitJson(payload);
    return;
  }

  consoleImpl.log(message);
}

function emitJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function assertMacOSCommand(name, {
  platform = process.platform,
  consoleImpl = console,
  exitImpl = process.exit,
} = {}) {
  if (platform === "darwin") {
    return;
  }

  consoleImpl.error(`[domaeng] \`${name}\` is only available on macOS. Use \`domaeng up\` or \`domaeng run\` for the foreground bridge on this OS.`);
  exitImpl(1);
}

function isVersionCommand(value) {
  return value === "-v" || value === "--v" || value === "-V" || value === "--version" || value === "version";
}

module.exports = {
  isVersionCommand,
  main,
};
