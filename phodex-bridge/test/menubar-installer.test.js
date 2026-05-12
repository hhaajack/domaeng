// FILE: menubar-installer.test.js
// Purpose: Verifies the optional prebuilt macOS MenuBar app install/open helpers.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/menubar-installer

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildMenuBarLoginAgentPlist,
  ensureMenuBarAppForStartup,
  getMenuBarAppStatus,
  installMenuBarApp,
  openInstalledMenuBarAppIfAvailable,
  openMenuBarApp,
  resolveBundledMenuBarAppPath,
  resolveInstalledMenuBarAppPath,
  resolveMenuBarLoginAgentPlistPath,
  resolveMenuBarPreferencesPath,
  setMenuBarOpenAtLoginEnabled,
} = require("../src/menubar-installer");

test("getMenuBarAppStatus reports bundled and installed app locations", () => {
  withTempMenuBarFixture(({ env, runtimeRoot, bundledAppPath, installedAppPath }) => {
    createAppBundle(bundledAppPath);
    createAppBundle(installedAppPath);

    const status = getMenuBarAppStatus({ env, runtimeRoot });

    assert.equal(status.bundled, true);
    assert.equal(status.bundledAppPath, bundledAppPath);
    assert.equal(status.installed, true);
    assert.equal(status.installedAppPath, installedAppPath);
    assert.equal(status.openAtLogin, false);
    assert.equal(status.autoOpenEnabled, true);
    assert.equal(status.appPath, installedAppPath);
  });
});

test("installMenuBarApp copies the bundled prebuilt app and enables login launch", () => {
  withTempMenuBarFixture(({ env, runtimeRoot, bundledAppPath, installedAppPath, loginAgentPlistPath }) => {
    createAppBundle(bundledAppPath);
    fs.mkdirSync(path.join(bundledAppPath, "Contents", "Resources"), { recursive: true });
    fs.writeFileSync(path.join(bundledAppPath, "Contents", "Resources", "control.txt"), "thin control");

    const result = installMenuBarApp({ env, runtimeRoot });

    assert.equal(result.installed, true);
    assert.equal(result.openAtLogin, true);
    assert.equal(result.appPath, installedAppPath);
    assert.equal(fs.existsSync(loginAgentPlistPath), true);
    assert.match(fs.readFileSync(loginAgentPlistPath, "utf8"), /DomaengMenuBar\.app/);
    assert.equal(fs.existsSync(path.join(installedAppPath, "Contents", "Resources", "control.txt")), true);
    assert.equal(fs.existsSync(path.join(installedAppPath, "Contents", "Resources", "dist")), false);
  });
});

test("installMenuBarApp fails gracefully when no prebuilt app is bundled", () => {
  withTempMenuBarFixture(({ env, runtimeRoot }) => {
    assert.throws(
      () => installMenuBarApp({ env, runtimeRoot }),
      /DomaengMenuBar\.app is not bundled/
    );
  });
});

test("openMenuBarApp prefers the installed app and falls back to bundled", () => {
  withTempMenuBarFixture(({ env, runtimeRoot, bundledAppPath, installedAppPath }) => {
    const calls = [];
    createAppBundle(bundledAppPath);
    createAppBundle(installedAppPath);

    const result = openMenuBarApp({
      env,
      runtimeRoot,
      execFileSyncImpl(command, args) {
        calls.push([command, args]);
      },
    });

    assert.equal(result.appPath, installedAppPath);
    assert.deepEqual(calls, [["open", [installedAppPath]]]);
  });
});

test("openInstalledMenuBarAppIfAvailable is a no-op when the app is not installed", () => {
  withTempMenuBarFixture(({ env, runtimeRoot }) => {
    let openCalls = 0;
    const result = openInstalledMenuBarAppIfAvailable({
      env,
      runtimeRoot,
      execFileSyncImpl() {
        openCalls += 1;
      },
    });

    assert.equal(result.opened, false);
    assert.equal(result.reason, "not_installed");
    assert.equal(openCalls, 0);
  });
});

test("ensureMenuBarAppForStartup installs, enables login, and opens bundled app by default", () => {
  withTempMenuBarFixture(({ env, runtimeRoot, bundledAppPath, installedAppPath, loginAgentPlistPath }) => {
    const calls = [];
    createAppBundle(bundledAppPath);

    const result = ensureMenuBarAppForStartup({
      env,
      runtimeRoot,
      execFileSyncImpl(command, args) {
        calls.push([command, args]);
      },
    });

    assert.equal(result.opened, true);
    assert.equal(result.appPath, installedAppPath);
    assert.equal(fs.existsSync(installedAppPath), true);
    assert.equal(fs.existsSync(loginAgentPlistPath), true);
    assert.deepEqual(calls, [["open", [installedAppPath]]]);
  });
});

test("ensureMenuBarAppForStartup respects a disabled login preference", () => {
  withTempMenuBarFixture(({ env, runtimeRoot, preferencesPath }) => {
    fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
    fs.writeFileSync(preferencesPath, JSON.stringify({ openAtLogin: false }));
    let openCalls = 0;

    const result = ensureMenuBarAppForStartup({
      env,
      runtimeRoot,
      execFileSyncImpl() {
        openCalls += 1;
      },
    });

    assert.equal(result.opened, false);
    assert.equal(result.reason, "disabled");
    assert.equal(openCalls, 0);
  });
});

test("setMenuBarOpenAtLoginEnabled can disable and re-enable the login agent", () => {
  withTempMenuBarFixture(({ env, runtimeRoot, bundledAppPath, loginAgentPlistPath, preferencesPath }) => {
    createAppBundle(bundledAppPath);
    installMenuBarApp({ env, runtimeRoot });

    const disabled = setMenuBarOpenAtLoginEnabled({ enabled: false, env, runtimeRoot });
    assert.equal(disabled.openAtLogin, false);
    assert.equal(disabled.autoOpenEnabled, false);
    assert.equal(fs.existsSync(loginAgentPlistPath), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(preferencesPath, "utf8")), { openAtLogin: false });

    const enabled = setMenuBarOpenAtLoginEnabled({ enabled: true, env, runtimeRoot });
    assert.equal(enabled.openAtLogin, true);
    assert.equal(enabled.autoOpenEnabled, true);
    assert.equal(fs.existsSync(loginAgentPlistPath), true);
  });
});

test("buildMenuBarLoginAgentPlist escapes app and log paths", () => {
  const plist = buildMenuBarLoginAgentPlist({
    appPath: "/Users/tester/Applications/Domaeng & Menu.app",
    stdoutLogPath: "/tmp/domaeng <out>.log",
    stderrLogPath: "/tmp/domaeng \"err\".log",
  });

  assert.match(plist, /com\.domaeng\.menubar/);
  assert.match(plist, /Domaeng &amp; Menu\.app/);
  assert.match(plist, /domaeng &lt;out&gt;\.log/);
  assert.match(plist, /domaeng &quot;err&quot;\.log/);
});

function withTempMenuBarFixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domaeng-menubar-"));
  try {
    const env = { HOME: path.join(root, "home") };
    const runtimeRoot = path.join(root, "runtime");
    const bundledAppPath = resolveBundledMenuBarAppPath({ runtimeRoot });
    const installedAppPath = resolveInstalledMenuBarAppPath({ env });
    const loginAgentPlistPath = resolveMenuBarLoginAgentPlistPath({ env });
    const preferencesPath = resolveMenuBarPreferencesPath({ env });
    callback({
      env,
      runtimeRoot,
      bundledAppPath,
      installedAppPath,
      loginAgentPlistPath,
      preferencesPath,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createAppBundle(appPath) {
  fs.mkdirSync(path.join(appPath, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(appPath, "Contents", "MacOS", "DomaengMenuBar"), "#!/bin/sh\n");
}
