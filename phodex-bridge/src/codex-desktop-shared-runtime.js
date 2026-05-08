// FILE: codex-desktop-shared-runtime.js
// Purpose: Points Codex.app at the bridge-managed local app-server so Desktop and mobile share one runtime.
// Layer: CLI helper
// Exports: CodexDesktopSharedRuntime
// Depends on: child_process, path

const { execFile, spawn } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const DEFAULT_APP_PATH = "/Applications/Codex.app";
const DEFAULT_PLATFORM = process.platform;
const DEFAULT_ENV_KEY = "CODEX_APP_SERVER_WS_URL";
const DEFAULT_APP_BOOT_WAIT_MS = 1_200;
const DEFAULT_RELAUNCH_WAIT_MS = 300;
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;

class CodexDesktopSharedRuntime {
  constructor({
    enabled = false,
    platform = DEFAULT_PLATFORM,
    appPath = DEFAULT_APP_PATH,
    envKey = DEFAULT_ENV_KEY,
    logPrefix = "[domaeng]",
    executor = execFileAsync,
    spawnImpl = spawn,
    sleepFn = sleep,
    launchDesktop = true,
    relaunchIfRunning = true,
    setLaunchctlEnvironment = false,
    appBootWaitMs = DEFAULT_APP_BOOT_WAIT_MS,
    relaunchWaitMs = DEFAULT_RELAUNCH_WAIT_MS,
    commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    isAppRunning = null,
  } = {}) {
    this.enabled = enabled;
    this.platform = platform;
    this.appPath = appPath;
    this.envKey = envKey;
    this.logPrefix = logPrefix;
    this.executor = executor;
    this.spawnImpl = spawnImpl;
    this.sleepFn = sleepFn;
    this.launchDesktop = launchDesktop;
    this.relaunchIfRunning = relaunchIfRunning;
    this.setLaunchctlEnvironment = setLaunchctlEnvironment;
    this.appBootWaitMs = appBootWaitMs;
    this.relaunchWaitMs = relaunchWaitMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.isAppRunning = isAppRunning;

    this.activeEndpoint = "";
    this.didSetLaunchctlEnvironment = false;
  }

  async activate(endpoint) {
    const normalizedEndpoint = typeof endpoint === "string" ? endpoint.trim() : "";
    if (!this.enabled || this.platform !== "darwin" || !normalizedEndpoint) {
      return { activated: false };
    }

    if (this.activeEndpoint === normalizedEndpoint) {
      return { activated: true, endpoint: normalizedEndpoint, unchanged: true };
    }

    if (this.setLaunchctlEnvironment) {
      try {
        await this.executor("launchctl", ["setenv", this.envKey, normalizedEndpoint], {
          timeout: this.commandTimeoutMs,
        });
        this.didSetLaunchctlEnvironment = true;
      } catch (error) {
        console.warn(`${this.logPrefix} could not set Codex.app launch environment: ${error.message}`);
      }
    }

    if (this.launchDesktop) {
      await this.relaunchDesktop(normalizedEndpoint);
    }

    this.activeEndpoint = normalizedEndpoint;
    console.log(`${this.logPrefix} Codex.app shared runtime active: ${normalizedEndpoint}`);
    return { activated: true, endpoint: normalizedEndpoint };
  }

  async shutdown() {
    if (!this.didSetLaunchctlEnvironment || this.platform !== "darwin") {
      return;
    }

    try {
      await this.executor("launchctl", ["unsetenv", this.envKey], {
        timeout: this.commandTimeoutMs,
      });
    } catch (error) {
      console.warn(`${this.logPrefix} could not clear Codex.app shared runtime environment: ${error.message}`);
    } finally {
      this.didSetLaunchctlEnvironment = false;
      this.activeEndpoint = "";
    }
  }

  async relaunchDesktop(endpoint) {
    const appRunning = typeof this.isAppRunning === "function"
      ? await this.isAppRunning(this.appPath)
      : await detectRunningCodexApp(this.appPath, this.executor, this.commandTimeoutMs);

    if (appRunning && this.relaunchIfRunning) {
      await quitCodexApp(this.appPath, this.executor, this.commandTimeoutMs);
      await waitForAppExit({
        appPath: this.appPath,
        executor: this.executor,
        isAppRunning: this.isAppRunning,
        sleepFn: this.sleepFn,
        timeoutMs: this.commandTimeoutMs,
      });
      await this.sleepFn(this.relaunchWaitMs);
    }

    if (!appRunning || this.relaunchIfRunning) {
      try {
        launchCodexAppWithEndpoint({
          appPath: this.appPath,
          endpoint,
          envKey: this.envKey,
          spawnImpl: this.spawnImpl,
        });
      } catch (error) {
        if (!this.didSetLaunchctlEnvironment) {
          throw error;
        }
        await this.executor("open", ["-a", this.appPath], {
          timeout: this.commandTimeoutMs,
        });
      }
      await this.sleepFn(this.appBootWaitMs);
    }
  }
}

async function detectRunningCodexApp(appPath, executor, commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  const appName = path.basename(appPath, ".app");

  try {
    await executor("pgrep", ["-x", appName], {
      timeout: commandTimeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

async function quitCodexApp(appPath, executor, commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  const appName = path.basename(appPath, ".app");

  try {
    await executor("pkill", ["-x", appName], {
      timeout: commandTimeoutMs,
    });
  } catch (error) {
    if (error?.code !== 1) {
      throw error;
    }
  }
}

async function waitForAppExit({
  appPath,
  executor,
  isAppRunning,
  sleepFn,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const running = typeof isAppRunning === "function"
      ? await isAppRunning(appPath)
      : await detectRunningCodexApp(appPath, executor, timeoutMs);
    if (!running) {
      return;
    }
    await sleepFn(100);
  }
}

function launchCodexAppWithEndpoint({
  appPath,
  endpoint,
  envKey = DEFAULT_ENV_KEY,
  spawnImpl = spawn,
}) {
  const executablePath = path.join(appPath, "Contents", "MacOS", path.basename(appPath, ".app"));
  const child = spawnImpl(executablePath, [], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      [envKey]: endpoint,
    },
  });
  child.unref?.();
  return child;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  CodexDesktopSharedRuntime,
  detectRunningCodexApp,
  launchCodexAppWithEndpoint,
};
