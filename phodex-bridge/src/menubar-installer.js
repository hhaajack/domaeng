// FILE: menubar-installer.js
// Purpose: Installs and opens the optional bundled unsigned macOS menu bar companion.
// Layer: CLI helper
// Exports: menu bar companion installer/open helpers
// Depends on: child_process, fs, os, path

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_NAME = "DomaengMenuBar.app";

function installMenuBarApp({
  env = process.env,
  platform = process.platform,
  fsImpl = fs,
  osImpl = os,
  runtimeRoot = path.resolve(__dirname, ".."),
} = {}) {
  assertDarwinPlatform(platform);
  const bundledAppPath = resolveBundledMenuBarAppPath({ runtimeRoot, fsImpl });
  if (!bundledAppPath) {
    throw new Error("The optional DomaengMenuBar.app is not bundled with this install.");
  }

  const installDir = resolveMenuBarInstallDir({ env, osImpl });
  const targetPath = path.join(installDir, APP_NAME);
  fsImpl.mkdirSync(installDir, { recursive: true });
  fsImpl.rmSync(targetPath, { recursive: true, force: true });
  fsImpl.cpSync(bundledAppPath, targetPath, {
    recursive: true,
    force: true,
    dereference: false,
  });

  return {
    bundledAppPath,
    installedAppPath: targetPath,
    signed: false,
  };
}

function openMenuBarApp({
  env = process.env,
  platform = process.platform,
  fsImpl = fs,
  osImpl = os,
  runtimeRoot = path.resolve(__dirname, ".."),
  execFileSyncImpl = execFileSync,
} = {}) {
  assertDarwinPlatform(platform);
  const installedAppPath = path.join(resolveMenuBarInstallDir({ env, osImpl }), APP_NAME);
  const appPath = fsImpl.existsSync(installedAppPath)
    ? installedAppPath
    : resolveBundledMenuBarAppPath({ runtimeRoot, fsImpl });
  if (!appPath) {
    throw new Error("DomaengMenuBar.app is not installed and is not bundled with this install.");
  }

  execFileSyncImpl("open", [appPath], { stdio: ["ignore", "ignore", "pipe"] });
  return {
    appPath,
    signed: false,
  };
}

function getMenuBarAppStatus({
  env = process.env,
  platform = process.platform,
  fsImpl = fs,
  osImpl = os,
  runtimeRoot = path.resolve(__dirname, ".."),
} = {}) {
  const bundledAppPath = platform === "darwin"
    ? resolveBundledMenuBarAppPath({ runtimeRoot, fsImpl })
    : "";
  const installedAppPath = platform === "darwin"
    ? path.join(resolveMenuBarInstallDir({ env, osImpl }), APP_NAME)
    : "";
  return {
    bundled: Boolean(bundledAppPath),
    bundledAppPath: bundledAppPath || null,
    installed: Boolean(installedAppPath && fsImpl.existsSync(installedAppPath)),
    installedAppPath: installedAppPath || null,
    signed: false,
  };
}

function resolveBundledMenuBarAppPath({
  runtimeRoot = path.resolve(__dirname, ".."),
  fsImpl = fs,
} = {}) {
  const candidate = path.join(runtimeRoot, "bundled", "menubar", APP_NAME);
  return fsImpl.existsSync(candidate) ? candidate : "";
}

function resolveMenuBarInstallDir({
  env = process.env,
  osImpl = os,
} = {}) {
  return normalizeNonEmptyString(env.DOMAENG_MENUBAR_INSTALL_DIR)
    || path.join(env.HOME || osImpl.homedir(), "Applications");
}

function assertDarwinPlatform(platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error("DomaengMenuBar.app is only available on macOS.");
  }
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  getMenuBarAppStatus,
  installMenuBarApp,
  openMenuBarApp,
  resolveBundledMenuBarAppPath,
  resolveMenuBarInstallDir,
};
