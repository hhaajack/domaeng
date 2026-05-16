// FILE: package-update.js
// Purpose: Updates the installed Domaeng npm package from the local CLI/control panel.
// Layer: CLI helper
// Exports: updateDomaengPackage
// Depends on: child_process, ../package.json

const { execFile } = require("child_process");
const { version: installedVersion = "" } = require("../package.json");

const DEFAULT_PACKAGE_SPEC = "domaeng@latest";
const DEFAULT_UPDATE_TIMEOUT_MS = 120_000;

async function updateDomaengPackage({
  commandRunner = execFilePromise,
  env = process.env,
  platform = process.platform,
  npmExecutable = platform === "win32" ? "npm.cmd" : "npm",
  packageSpec = DEFAULT_PACKAGE_SPEC,
  installMenuBarApp = null,
} = {}) {
  const normalizedPackageSpec = normalizeNonEmptyString(packageSpec) || DEFAULT_PACKAGE_SPEC;
  await commandRunner(npmExecutable, ["install", "-g", normalizedPackageSpec], {
    env,
    timeout: DEFAULT_UPDATE_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
  });

  const menuBar = platform === "darwin" && typeof installMenuBarApp === "function"
    ? refreshMenuBarApp({ installMenuBarApp })
    : null;

  return {
    updated: true,
    previousVersion: normalizeNonEmptyString(installedVersion) || null,
    packageSpec: normalizedPackageSpec,
    updateCommand: `${npmExecutable} install -g ${normalizedPackageSpec}`,
    menuBar,
    restartRecommended: true,
  };
}

function refreshMenuBarApp({ installMenuBarApp }) {
  try {
    const status = installMenuBarApp({ enableOpenAtLogin: true });
    return {
      ok: true,
      installed: Boolean(status?.installed),
      installedAppPath: normalizeNonEmptyString(status?.installedAppPath) || null,
      appPath: normalizeNonEmptyString(status?.appPath) || normalizeNonEmptyString(status?.installedAppPath) || null,
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeNonEmptyString(error?.message) || "Failed to refresh DomaengMenuBar.app.",
    };
  }
}

function execFilePromise(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const detail = normalizeNonEmptyString(stderr) || normalizeNonEmptyString(stdout) || error.message;
        reject(new Error(detail));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  updateDomaengPackage,
};
