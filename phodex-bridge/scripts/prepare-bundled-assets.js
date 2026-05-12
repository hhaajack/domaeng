#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..");
const bundleRoot = path.join(packageRoot, "bundled");

removeIfPresent(bundleRoot);
fs.mkdirSync(bundleRoot, { recursive: true });

copyRelayAssets();
copyWebAssets();
copyMenuBarAppIfAvailable();

function copyRelayAssets() {
  const sourceRoot = path.join(repoRoot, "relay");
  const targetRoot = path.join(bundleRoot, "relay");
  const files = [
    "apns-client.js",
    "push-service.js",
    "relay.js",
    "server.js",
    "web-push-client.js",
  ];

  for (const file of files) {
    copyFile(path.join(sourceRoot, file), path.join(targetRoot, file));
  }
}

function copyWebAssets() {
  const sourceRoot = path.join(repoRoot, "web", "dist");
  const targetRoot = path.join(bundleRoot, "web");
  assertDirectory(sourceRoot, "web/dist is missing. Run `npm run build` in web/ before packing.");
  fs.cpSync(sourceRoot, targetRoot, {
    recursive: true,
    force: true,
    dereference: false,
  });
}

function copyMenuBarAppIfAvailable() {
  const sourcePath = resolveMenuBarAppPath();
  if (!sourcePath) {
    return;
  }

  const targetRoot = path.join(bundleRoot, "menubar");
  const targetPath = path.join(targetRoot, "DomaengMenuBar.app");
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    dereference: false,
  });
}

function resolveMenuBarAppPath() {
  const explicitPath = readString(process.env.DOMAENG_MENUBAR_APP_PATH);
  if (explicitPath) {
    assertDirectory(explicitPath, `DOMAENG_MENUBAR_APP_PATH does not exist: ${explicitPath}`);
    return explicitPath;
  }

  const defaultPath = path.join(repoRoot, "macos", "DomaengMenuBar", "build", "DomaengMenuBar.app");
  return fs.existsSync(defaultPath) ? defaultPath : "";
}

function copyFile(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing bundled asset source: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function assertDirectory(targetPath, message) {
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
    throw new Error(message);
  }
}

function removeIfPresent(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
