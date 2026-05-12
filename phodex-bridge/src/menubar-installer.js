// FILE: menubar-installer.js
// Purpose: Installs, opens, and configures the optional prebuilt macOS MenuBar control panel.
// Layer: CLI helper
// Exports: status/install/open/login helpers for DomaengMenuBar.app
// Depends on: child_process, fs, os, path, ./daemon-state

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  resolveBridgeLogsDir,
  resolveRemodexStateDir,
} = require("./daemon-state");

const APP_NAME = "DomaengMenuBar.app";
const LOGIN_AGENT_LABEL = "com.domaeng.menubar";
const MENUBAR_PREFERENCES_FILE = "menubar-preferences.json";
const MENUBAR_STDOUT_LOG_FILE = "menubar.stdout.log";
const MENUBAR_STDERR_LOG_FILE = "menubar.stderr.log";

function getMenuBarAppStatus({
  env = process.env,
  fsImpl = fs,
  osImpl = os,
  runtimeRoot = path.resolve(__dirname, ".."),
} = {}) {
  const bundledAppPath = resolveBundledMenuBarAppPath({ runtimeRoot });
  const installedAppPath = resolveInstalledMenuBarAppPath({ env, osImpl });
  const loginAgentPlistPath = resolveMenuBarLoginAgentPlistPath({ env, osImpl });
  const preferences = readMenuBarPreferences({ env, fsImpl, osImpl });
  const bundled = isDirectory(bundledAppPath, fsImpl);
  const installed = isDirectory(installedAppPath, fsImpl);
  const loginAgentInstalled = fsImpl.existsSync(loginAgentPlistPath);
  const autoOpenEnabled = preferences.openAtLogin !== false;

  return {
    bundled,
    bundledAppPath,
    installed,
    installedAppPath,
    loginAgentInstalled,
    loginAgentPlistPath,
    openAtLogin: autoOpenEnabled && loginAgentInstalled,
    autoOpenEnabled,
    preferencesPath: resolveMenuBarPreferencesPath({ env, osImpl }),
    appPath: installed ? installedAppPath : (bundled ? bundledAppPath : ""),
  };
}

function installMenuBarApp({
  env = process.env,
  fsImpl = fs,
  osImpl = os,
  runtimeRoot = path.resolve(__dirname, ".."),
  enableOpenAtLogin = true,
} = {}) {
  const status = getMenuBarAppStatus({ env, fsImpl, osImpl, runtimeRoot });
  if (!status.bundled) {
    throw new Error("DomaengMenuBar.app is not bundled with this install.");
  }

  fsImpl.mkdirSync(path.dirname(status.installedAppPath), { recursive: true });
  fsImpl.rmSync(status.installedAppPath, { recursive: true, force: true });
  fsImpl.cpSync(status.bundledAppPath, status.installedAppPath, {
    recursive: true,
    force: true,
    dereference: false,
  });

  if (enableOpenAtLogin) {
    return setMenuBarOpenAtLoginEnabled({
      enabled: true,
      env,
      fsImpl,
      osImpl,
      runtimeRoot,
      installIfNeeded: false,
    });
  }

  return {
    ...getMenuBarAppStatus({ env, fsImpl, osImpl, runtimeRoot }),
    installed: true,
    appPath: status.installedAppPath,
  };
}

function ensureMenuBarAppForStartup({
  env = process.env,
  fsImpl = fs,
  osImpl = os,
  runtimeRoot = path.resolve(__dirname, ".."),
  execFileSyncImpl = execFileSync,
} = {}) {
  let status = getMenuBarAppStatus({ env, fsImpl, osImpl, runtimeRoot });
  if (!status.autoOpenEnabled) {
    return {
      ...status,
      opened: false,
      reason: "disabled",
    };
  }

  if (!status.installed) {
    if (!status.bundled) {
      return {
        ...status,
        opened: false,
        reason: "not_bundled",
      };
    }
    installMenuBarApp({
      env,
      fsImpl,
      osImpl,
      runtimeRoot,
      enableOpenAtLogin: true,
    });
    status = getMenuBarAppStatus({ env, fsImpl, osImpl, runtimeRoot });
  } else if (!status.openAtLogin) {
    setMenuBarOpenAtLoginEnabled({
      enabled: true,
      env,
      fsImpl,
      osImpl,
      runtimeRoot,
      installIfNeeded: false,
    });
    status = getMenuBarAppStatus({ env, fsImpl, osImpl, runtimeRoot });
  }

  return openInstalledMenuBarAppIfAvailable({
    env,
    fsImpl,
    osImpl,
    runtimeRoot,
    execFileSyncImpl,
  });
}

function openMenuBarApp({
  env = process.env,
  fsImpl = fs,
  osImpl = os,
  runtimeRoot = path.resolve(__dirname, ".."),
  execFileSyncImpl = execFileSync,
} = {}) {
  const status = getMenuBarAppStatus({ env, fsImpl, osImpl, runtimeRoot });
  const appPath = status.installed ? status.installedAppPath : (status.bundled ? status.bundledAppPath : "");
  if (!appPath) {
    throw new Error("DomaengMenuBar.app is not installed or bundled.");
  }

  execFileSyncImpl("open", [appPath], { stdio: ["ignore", "ignore", "pipe"] });
  return {
    ...status,
    appPath,
  };
}

function openInstalledMenuBarAppIfAvailable({
  env = process.env,
  fsImpl = fs,
  osImpl = os,
  runtimeRoot = path.resolve(__dirname, ".."),
  execFileSyncImpl = execFileSync,
} = {}) {
  const status = getMenuBarAppStatus({ env, fsImpl, osImpl, runtimeRoot });
  if (!status.installed) {
    return {
      ...status,
      opened: false,
      reason: "not_installed",
    };
  }

  try {
    execFileSyncImpl("open", [status.installedAppPath], { stdio: ["ignore", "ignore", "pipe"] });
    return {
      ...status,
      opened: true,
      appPath: status.installedAppPath,
    };
  } catch (error) {
    return {
      ...status,
      opened: false,
      reason: "open_failed",
      error: error?.message || String(error),
    };
  }
}

function setMenuBarOpenAtLoginEnabled({
  enabled,
  env = process.env,
  fsImpl = fs,
  osImpl = os,
  runtimeRoot = path.resolve(__dirname, ".."),
  installIfNeeded = true,
} = {}) {
  const nextEnabled = Boolean(enabled);
  let status = getMenuBarAppStatus({ env, fsImpl, osImpl, runtimeRoot });

  if (nextEnabled && !status.installed) {
    if (!installIfNeeded || !status.bundled) {
      throw new Error("DomaengMenuBar.app is not installed. Run `domaeng menubar install` first.");
    }
    installMenuBarApp({
      env,
      fsImpl,
      osImpl,
      runtimeRoot,
      enableOpenAtLogin: false,
    });
    status = getMenuBarAppStatus({ env, fsImpl, osImpl, runtimeRoot });
  }

  writeMenuBarPreferences({ openAtLogin: nextEnabled }, { env, fsImpl, osImpl });
  if (nextEnabled) {
    writeMenuBarLoginAgentPlist({
      appPath: status.installedAppPath,
      env,
      fsImpl,
      osImpl,
    });
  } else {
    removeMenuBarLoginAgentPlist({ env, fsImpl, osImpl });
  }

  return getMenuBarAppStatus({ env, fsImpl, osImpl, runtimeRoot });
}

function resolveBundledMenuBarAppPath({
  runtimeRoot = path.resolve(__dirname, ".."),
} = {}) {
  return path.join(runtimeRoot, "bundled", "menubar", APP_NAME);
}

function resolveInstalledMenuBarAppPath({
  env = process.env,
  osImpl = os,
} = {}) {
  const homeDir = env.HOME || osImpl.homedir();
  return path.join(homeDir, "Applications", APP_NAME);
}

function resolveMenuBarLoginAgentPlistPath({ env = process.env, osImpl = os } = {}) {
  const homeDir = env.HOME || osImpl.homedir();
  return path.join(homeDir, "Library", "LaunchAgents", `${LOGIN_AGENT_LABEL}.plist`);
}

function resolveMenuBarPreferencesPath({ env = process.env, osImpl = os } = {}) {
  return path.join(resolveRemodexStateDir({ env, osImpl }), MENUBAR_PREFERENCES_FILE);
}

function writeMenuBarLoginAgentPlist({
  appPath,
  env = process.env,
  fsImpl = fs,
  osImpl = os,
} = {}) {
  const plistPath = resolveMenuBarLoginAgentPlistPath({ env, osImpl });
  const logsDir = resolveBridgeLogsDir({ env, osImpl });
  fsImpl.mkdirSync(path.dirname(plistPath), { recursive: true });
  fsImpl.mkdirSync(logsDir, { recursive: true });
  fsImpl.writeFileSync(plistPath, buildMenuBarLoginAgentPlist({
    appPath,
    stdoutLogPath: path.join(logsDir, MENUBAR_STDOUT_LOG_FILE),
    stderrLogPath: path.join(logsDir, MENUBAR_STDERR_LOG_FILE),
  }), "utf8");
  return plistPath;
}

function removeMenuBarLoginAgentPlist({
  env = process.env,
  fsImpl = fs,
  osImpl = os,
} = {}) {
  fsImpl.rmSync(resolveMenuBarLoginAgentPlistPath({ env, osImpl }), {
    force: true,
  });
}

function buildMenuBarLoginAgentPlist({
  appPath,
  stdoutLogPath,
  stderrLogPath,
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LOGIN_AGENT_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-g</string>
    <string>${escapeXml(appPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrLogPath)}</string>
</dict>
</plist>
`;
}

function readMenuBarPreferences({ env = process.env, fsImpl = fs, osImpl = os } = {}) {
  const preferencesPath = resolveMenuBarPreferencesPath({ env, osImpl });
  if (!fsImpl.existsSync(preferencesPath)) {
    return {};
  }
  try {
    return JSON.parse(fsImpl.readFileSync(preferencesPath, "utf8"));
  } catch {
    return {};
  }
}

function writeMenuBarPreferences(preferences, { env = process.env, fsImpl = fs, osImpl = os } = {}) {
  const preferencesPath = resolveMenuBarPreferencesPath({ env, osImpl });
  fsImpl.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fsImpl.writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), { mode: 0o600 });
}

function isDirectory(targetPath, fsImpl = fs) {
  try {
    return fsImpl.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

module.exports = {
  APP_NAME,
  LOGIN_AGENT_LABEL,
  buildMenuBarLoginAgentPlist,
  ensureMenuBarAppForStartup,
  getMenuBarAppStatus,
  installMenuBarApp,
  openInstalledMenuBarAppIfAvailable,
  openMenuBarApp,
  readMenuBarPreferences,
  resolveBundledMenuBarAppPath,
  resolveInstalledMenuBarAppPath,
  resolveMenuBarLoginAgentPlistPath,
  resolveMenuBarPreferencesPath,
  setMenuBarOpenAtLoginEnabled,
};
