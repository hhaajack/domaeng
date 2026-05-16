// FILE: index.js
// Purpose: Small entrypoint wrapper for bridge lifecycle commands.
// Layer: CLI entry
// Exports: bridge lifecycle, pairing reset, thread resume/watch, and macOS service helpers.
// Depends on: ./bridge, ./secure-device-state, ./session-state, ./rollout-watch, ./macos-launch-agent, ./local-relay-launch-agent, ./menubar-installer

const { startBridge } = require("./bridge");
const {
  readBridgeDeviceState,
  readTrustedDevicesSnapshot,
  renameTrustedDevice,
  revokeTrustedDevice,
  resetBridgeDeviceState,
  setTrustedDeviceEnabled,
} = require("./secure-device-state");
const { openLastActiveThread } = require("./session-state");
const { watchThreadRollout } = require("./rollout-watch");
const { updateDomaengPackage } = require("./package-update");
const { readBridgeConfig } = require("./codex-desktop-refresher");
const {
  getMacOSBridgeServiceStatus,
  printMacOSBridgePairingQr,
  printMacOSBridgeServiceStatus,
  requestMacOSBridgePairingRenewal,
  resetMacOSBridgePairing,
  runMacOSBridgeService,
  startMacOSBridgeService,
  stopMacOSBridgeService,
} = require("./macos-launch-agent");
const {
  runLocalRelayService,
  startLocalRelayService,
  stopLocalRelayService,
} = require("./local-relay-launch-agent");
const {
  ensureMenuBarAppForStartup,
  getMenuBarAppStatus,
  installMenuBarApp,
  openInstalledMenuBarAppIfAvailable,
  openMenuBarApp,
  setMenuBarOpenAtLoginEnabled,
} = require("./menubar-installer");

module.exports = {
  ensureMenuBarAppForStartup,
  getMacOSBridgeServiceStatus,
  getMenuBarAppStatus,
  installMenuBarApp,
  openInstalledMenuBarAppIfAvailable,
  openMenuBarApp,
  printMacOSBridgePairingQr,
  printMacOSBridgeServiceStatus,
  requestMacOSBridgePairingRenewal,
  readBridgeConfig,
  readBridgeDeviceState,
  readTrustedDevicesSnapshot,
  renameTrustedDevice,
  revokeTrustedDevice,
  resetMacOSBridgePairing,
  runLocalRelayService,
  startBridge,
  runMacOSBridgeService,
  startMacOSBridgeService,
  startLocalRelayService,
  stopMacOSBridgeService,
  stopLocalRelayService,
  resetBridgePairing: resetBridgeDeviceState,
  setMenuBarOpenAtLoginEnabled,
  setTrustedDeviceEnabled,
  openLastActiveThread,
  watchThreadRollout,
  updateDomaengPackage,
};
