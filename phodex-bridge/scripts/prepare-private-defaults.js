#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const outputPath = path.join(__dirname, "..", "src", "private-defaults.json");
const relayUrl = readFirstString(
  "DOMAENG_PACKAGE_DEFAULT_RELAY_URL",
  "REMODEX_PACKAGE_DEFAULT_RELAY_URL"
);
const pushServiceUrl = readFirstString(
  "DOMAENG_PACKAGE_DEFAULT_PUSH_SERVICE_URL",
  "REMODEX_PACKAGE_DEFAULT_PUSH_SERVICE_URL"
);

if (!relayUrl && !pushServiceUrl) {
  removeIfPresent(outputPath);
  process.exit(0);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  `${JSON.stringify({
    relayUrl,
    pushServiceUrl,
  }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 }
);

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readFirstString(...keys) {
  for (const key of keys) {
    const value = readString(process.env[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function removeIfPresent(targetPath) {
  try {
    fs.unlinkSync(targetPath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
}
