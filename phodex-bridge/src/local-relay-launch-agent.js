// FILE: local-relay-launch-agent.js
// Purpose: Manages the source-checkout local relay as a macOS launchd service.
// Layer: CLI helper
// Exports: local relay launchd lifecycle and the service runner used by `domaeng start`.
// Depends on: child_process, fs, http, os, path

const { execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const {
  DEFAULT_LOCAL_RELAY_PORT,
  isLocalRelayHost,
} = require("./local-relay-url");

const SERVICE_LABEL = "com.domaeng.relay";
const DEFAULT_LOCAL_RELAY_BIND_HOST = "0.0.0.0";
const DEFAULT_HEALTH_TIMEOUT_MS = 800;

async function startLocalRelayService({
  config = {},
  env = process.env,
  platform = process.platform,
  fsImpl = fs,
  execFileSyncImpl = execFileSync,
  osImpl = os,
  nodePath = process.execPath,
  cliPath = path.resolve(__dirname, "..", "bin", "remodex.js"),
  runtimeRoot = path.resolve(__dirname, ".."),
  healthCheck = isLocalRelayHealthy,
} = {}) {
  assertDarwinPlatform(platform);
  if (!shouldManageLocalRelay(config.relayUrl, { env })) {
    return { managed: false, reason: "relay_url_not_local" };
  }

  const relayServerModule = resolveRelayServerModule({ env, fsImpl, runtimeRoot });
  if (!relayServerModule) {
    return { managed: false, reason: "relay_server_missing" };
  }

  const port = resolveLocalRelayPort(config.relayUrl, env);
  if (await healthCheck({ port, env })) {
    return { managed: true, alreadyRunning: true, port };
  }

  const plistPath = writeLocalRelayLaunchAgentPlist({
    env,
    fsImpl,
    osImpl,
    nodePath,
    cliPath,
    runtimeRoot,
    relayServerModule,
    webAppDir: resolveWebAppDir({ env, fsImpl, runtimeRoot }),
    port,
    bindHost: env.RELAY_BIND_HOST || DEFAULT_LOCAL_RELAY_BIND_HOST,
  });
  restartLocalRelayLaunchAgent({
    env,
    execFileSyncImpl,
    plistPath,
  });
  return { managed: true, started: true, port, plistPath };
}

function runLocalRelayService({
  env = process.env,
  runtimeRoot = path.resolve(__dirname, ".."),
} = {}) {
  const relayServerModule = resolveRelayServerModule({ env, runtimeRoot });
  if (!relayServerModule) {
    console.error("[domaeng] Local relay server module was not found.");
    process.exitCode = 1;
    return;
  }

  const { createRelayServer } = require(relayServerModule);
  const port = parseInteger(env.DOMAENG_LOCAL_RELAY_PORT || env.RELAY_PORT || env.PORT, DEFAULT_LOCAL_RELAY_PORT);
  const bindHost = env.RELAY_BIND_HOST || DEFAULT_LOCAL_RELAY_BIND_HOST;
  const webAppDir = resolveWebAppDir({ env, runtimeRoot });
  const enablePushService = readOptionalBooleanEnv(["DOMAENG_ENABLE_PUSH_SERVICE", "REMODEX_ENABLE_PUSH_SERVICE"], env) ?? true;
  const { server } = createRelayServer({
    enablePushService,
    webAppDir,
  });

  server.listen(port, bindHost, () => {
    console.log(`[domaeng] local relay listening on http://${bindHost}:${port}`);
  });

  function shutdown(signal) {
    console.log(`[domaeng] local relay shutting down (${signal})`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function stopLocalRelayService({
  env = process.env,
  platform = process.platform,
  execFileSyncImpl = execFileSync,
} = {}) {
  assertDarwinPlatform(platform);
  bootoutLocalRelayLaunchAgent({
    env,
    execFileSyncImpl,
    ignoreMissing: true,
  });
}

function shouldManageLocalRelay(relayUrl, { env = process.env } = {}) {
  const explicit = readOptionalBooleanEnv(["DOMAENG_LOCAL_RELAY_ENABLED", "REMODEX_LOCAL_RELAY_ENABLED"], env);
  if (explicit != null) {
    return explicit;
  }

  try {
    const url = new URL(String(relayUrl || ""));
    return isLocalRelayHost(url.hostname);
  } catch {
    return false;
  }
}

function resolveLocalRelayPort(relayUrl, env = process.env) {
  const explicitPort = parseInteger(env.DOMAENG_LOCAL_RELAY_PORT || env.RELAY_PORT || env.PORT, 0);
  if (explicitPort > 0) {
    return explicitPort;
  }

  try {
    const url = new URL(String(relayUrl || ""));
    const port = parseInteger(url.port, 0);
    return port > 0 ? port : DEFAULT_LOCAL_RELAY_PORT;
  } catch {
    return DEFAULT_LOCAL_RELAY_PORT;
  }
}

function resolveRelayServerModule({
  env = process.env,
  fsImpl = fs,
  runtimeRoot = path.resolve(__dirname, ".."),
} = {}) {
  const override = normalizeNonEmptyString(env.DOMAENG_RELAY_SERVER_MODULE || env.REMODEX_RELAY_SERVER_MODULE);
  if (override && fsImpl.existsSync(override)) {
    return override;
  }

  const bundledRelayModule = path.join(runtimeRoot, "bundled", "relay", "server.js");
  if (fsImpl.existsSync(bundledRelayModule)) {
    return bundledRelayModule;
  }

  const repoRoot = path.resolve(runtimeRoot, "..");
  const sourceRelayModule = path.join(repoRoot, "relay", "server.js");
  if (fsImpl.existsSync(sourceRelayModule)) {
    return sourceRelayModule;
  }

  return "";
}

function resolveWebAppDir({
  env = process.env,
  fsImpl = fs,
  runtimeRoot = path.resolve(__dirname, ".."),
} = {}) {
  const override = normalizeNonEmptyString(env.DOMAENG_WEB_APP_DIR || env.REMODEX_WEB_APP_DIR);
  if (override) {
    return override;
  }

  const bundledWebDist = path.join(runtimeRoot, "bundled", "web");
  if (fsImpl.existsSync(bundledWebDist)) {
    return bundledWebDist;
  }

  const repoWebDist = path.join(path.resolve(runtimeRoot, ".."), "web", "dist");
  if (fsImpl.existsSync(repoWebDist)) {
    return repoWebDist;
  }

  return repoWebDist;
}

function writeLocalRelayLaunchAgentPlist({
  env = process.env,
  fsImpl = fs,
  osImpl = os,
  nodePath = process.execPath,
  cliPath = path.resolve(__dirname, "..", "bin", "remodex.js"),
  runtimeRoot = path.resolve(__dirname, ".."),
  relayServerModule,
  webAppDir,
  port = DEFAULT_LOCAL_RELAY_PORT,
  bindHost = DEFAULT_LOCAL_RELAY_BIND_HOST,
} = {}) {
  const plistPath = resolveLocalRelayLaunchAgentPlistPath({ env, osImpl });
  const homeDir = env.HOME || osImpl.homedir();
  const logsDir = path.join(resolveStateDir({ env, osImpl }), "logs");
  fsImpl.mkdirSync(logsDir, { recursive: true });

  const serialized = buildLocalRelayLaunchAgentPlist({
    homeDir,
    pathEnv: env.PATH || "",
    nodePath,
    cliPath,
    runtimeRoot,
    relayServerModule,
    webAppDir,
    port,
    bindHost,
    stdoutLogPath: path.join(logsDir, "relay.stdout.log"),
    stderrLogPath: path.join(logsDir, "relay.stderr.log"),
  });

  fsImpl.mkdirSync(path.dirname(plistPath), { recursive: true });
  fsImpl.writeFileSync(plistPath, serialized, "utf8");
  return plistPath;
}

function buildLocalRelayLaunchAgentPlist({
  homeDir,
  pathEnv,
  nodePath,
  cliPath,
  runtimeRoot,
  relayServerModule,
  webAppDir,
  port,
  bindHost,
  stdoutLogPath,
  stderrLogPath,
}) {
  const nodePathEnv = path.join(runtimeRoot, "node_modules");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(SERVICE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(cliPath)}</string>
    <string>run-local-relay-service</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>WorkingDirectory</key>
  <string>${escapeXml(homeDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapeXml(homeDir)}</string>
    <key>PATH</key>
    <string>${escapeXml(pathEnv)}</string>
    <key>NODE_PATH</key>
    <string>${escapeXml(nodePathEnv)}</string>
    <key>DOMAENG_RELAY_SERVER_MODULE</key>
    <string>${escapeXml(relayServerModule)}</string>
    <key>DOMAENG_WEB_APP_DIR</key>
    <string>${escapeXml(webAppDir)}</string>
    <key>DOMAENG_LOCAL_RELAY_PORT</key>
    <string>${escapeXml(port)}</string>
    <key>RELAY_BIND_HOST</key>
    <string>${escapeXml(bindHost)}</string>
    <key>DOMAENG_ENABLE_PUSH_SERVICE</key>
    <string>true</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrLogPath)}</string>
</dict>
</plist>
`;
}

function restartLocalRelayLaunchAgent({
  env = process.env,
  execFileSyncImpl = execFileSync,
  plistPath,
} = {}) {
  bootoutLocalRelayLaunchAgent({
    env,
    execFileSyncImpl,
    ignoreMissing: true,
  });
  execFileSyncImpl("launchctl", [
    "bootstrap",
    launchAgentDomain(env),
    plistPath,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  execFileSyncImpl("launchctl", [
    "kickstart",
    "-k",
    launchAgentLabelDomain(env),
  ], { stdio: ["ignore", "ignore", "pipe"] });
}

function bootoutLocalRelayLaunchAgent({
  env = process.env,
  execFileSyncImpl = execFileSync,
  ignoreMissing = false,
} = {}) {
  const bootoutTargets = [
    [launchAgentDomain(env), resolveLocalRelayLaunchAgentPlistPath({ env })],
    [launchAgentLabelDomain(env)],
  ];
  let lastError = null;

  for (const targetArgs of bootoutTargets) {
    try {
      execFileSyncImpl("launchctl", [
        "bootout",
        ...targetArgs,
      ], { stdio: ["ignore", "ignore", "pipe"] });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (ignoreMissing && isMissingLaunchAgentError(lastError)) {
    return;
  }
  throw lastError;
}

function resolveLocalRelayLaunchAgentPlistPath({ env = process.env, osImpl = os } = {}) {
  const homeDir = env.HOME || osImpl.homedir();
  return path.join(homeDir, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

async function isLocalRelayHealthy({
  port = DEFAULT_LOCAL_RELAY_PORT,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: "127.0.0.1",
      port,
      path: "/health",
      timeout: timeoutMs,
    }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

function resolveStateDir({ env = process.env, osImpl = os } = {}) {
  return normalizeNonEmptyString(env.DOMAENG_DEVICE_STATE_DIR)
    || normalizeNonEmptyString(env.REMODEX_DEVICE_STATE_DIR)
    || path.join(env.HOME || osImpl.homedir(), ".remodex");
}

function readOptionalBooleanEnv(keys, env = process.env) {
  for (const key of keys) {
    const value = normalizeNonEmptyString(env?.[key]).toLowerCase();
    if (!value) {
      continue;
    }
    if (["1", "true", "yes", "on"].includes(value)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(value)) {
      return false;
    }
  }
  return null;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertDarwinPlatform(platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error("macOS local relay service management is only available on macOS.");
  }
}

function launchAgentDomain(env) {
  return `gui/${resolveUid(env)}`;
}

function launchAgentLabelDomain(env) {
  return `${launchAgentDomain(env)}/${SERVICE_LABEL}`;
}

function resolveUid(env) {
  if (typeof process.getuid === "function") {
    return process.getuid();
  }

  const uid = Number.parseInt(env.UID || "", 10);
  if (Number.isFinite(uid)) {
    return uid;
  }

  throw new Error("Could not determine the current macOS user id for launchctl.");
}

function isMissingLaunchAgentError(error) {
  const combined = [
    error?.message,
    error?.stderr?.toString?.("utf8"),
    error?.stdout?.toString?.("utf8"),
  ].filter(Boolean).join("\n").toLowerCase();
  return combined.includes("could not find service")
    || combined.includes("service could not be found")
    || combined.includes("no such process");
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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
  buildLocalRelayLaunchAgentPlist,
  resolveLocalRelayLaunchAgentPlistPath,
  resolveLocalRelayPort,
  resolveRelayServerModule,
  runLocalRelayService,
  shouldManageLocalRelay,
  startLocalRelayService,
  stopLocalRelayService,
};
