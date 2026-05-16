// FILE: package-update.test.js
// Purpose: Verifies local package update orchestration stays CLI-driven and testable.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/package-update

const test = require("node:test");
const assert = require("node:assert/strict");
const { version } = require("../package.json");
const { updateDomaengPackage } = require("../src/package-update");

test("updateDomaengPackage runs npm global update and refreshes the menu bar app on macOS", async () => {
  const calls = [];
  const result = await updateDomaengPackage({
    platform: "darwin",
    commandRunner: async (command, args) => {
      calls.push(["command", command, args]);
      return { stdout: "", stderr: "" };
    },
    installMenuBarApp(options) {
      calls.push(["install-menubar", options]);
      return {
        installed: true,
        installedAppPath: "/Users/tester/Applications/DomaengMenuBar.app",
      };
    },
  });

  assert.deepEqual(calls, [
    ["command", "npm", ["install", "-g", "domaeng@latest"]],
    ["install-menubar", { enableOpenAtLogin: true }],
  ]);
  assert.equal(result.updated, true);
  assert.equal(result.previousVersion, version);
  assert.equal(result.packageSpec, "domaeng@latest");
  assert.equal(result.updateCommand, "npm install -g domaeng@latest");
  assert.equal(result.restartRecommended, true);
  assert.equal(result.menuBar.ok, true);
  assert.equal(result.menuBar.installed, true);
});

test("updateDomaengPackage reports menu bar refresh warnings without failing the package update", async () => {
  const result = await updateDomaengPackage({
    platform: "darwin",
    commandRunner: async () => ({ stdout: "", stderr: "" }),
    installMenuBarApp() {
      throw new Error("DomaengMenuBar.app is not bundled with this install.");
    },
  });

  assert.equal(result.updated, true);
  assert.equal(result.menuBar.ok, false);
  assert.equal(result.menuBar.error, "DomaengMenuBar.app is not bundled with this install.");
});
