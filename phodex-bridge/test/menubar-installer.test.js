// FILE: menubar-installer.test.js
// Purpose: Verifies optional unsigned menu bar companion app install helpers.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/menubar-installer

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  getMenuBarAppStatus,
  installMenuBarApp,
  openMenuBarApp,
} = require("../src/menubar-installer");

test("installMenuBarApp copies the bundled unsigned app into the user install dir", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "domaeng-menubar-install-"));
  try {
    const bundledApp = path.join(rootDir, "pkg", "bundled", "menubar", "DomaengMenuBar.app");
    fs.mkdirSync(path.join(bundledApp, "Contents", "MacOS"), { recursive: true });
    fs.writeFileSync(path.join(bundledApp, "Contents", "MacOS", "DomaengMenuBar"), "binary");

    const result = installMenuBarApp({
      env: {
        HOME: rootDir,
      },
      platform: "darwin",
      runtimeRoot: path.join(rootDir, "pkg"),
    });

    assert.equal(result.signed, false);
    assert.equal(result.installedAppPath, path.join(rootDir, "Applications", "DomaengMenuBar.app"));
    assert.equal(
      fs.readFileSync(path.join(result.installedAppPath, "Contents", "MacOS", "DomaengMenuBar"), "utf8"),
      "binary"
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("getMenuBarAppStatus reports missing bundled app without failing", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "domaeng-menubar-status-"));
  try {
    const status = getMenuBarAppStatus({
      env: {
        HOME: rootDir,
      },
      platform: "darwin",
      runtimeRoot: path.join(rootDir, "pkg"),
    });

    assert.equal(status.bundled, false);
    assert.equal(status.installed, false);
    assert.equal(status.signed, false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("openMenuBarApp opens the installed app before the bundled app", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "domaeng-menubar-open-"));
  try {
    const installedApp = path.join(rootDir, "Applications", "DomaengMenuBar.app");
    const bundledApp = path.join(rootDir, "pkg", "bundled", "menubar", "DomaengMenuBar.app");
    fs.mkdirSync(installedApp, { recursive: true });
    fs.mkdirSync(bundledApp, { recursive: true });
    const calls = [];

    const result = openMenuBarApp({
      env: {
        HOME: rootDir,
      },
      platform: "darwin",
      runtimeRoot: path.join(rootDir, "pkg"),
      execFileSyncImpl(command, args) {
        calls.push([command, args]);
      },
    });

    assert.equal(result.appPath, installedApp);
    assert.deepEqual(calls, [["open", [installedApp]]]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
