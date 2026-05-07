// FILE: codex-transport.js
// Purpose: Abstracts the Codex-side transport so the bridge can talk to either a spawned app-server or an existing WebSocket endpoint.
// Layer: CLI helper
// Exports: createCodexTransport
// Depends on: child_process, fs, path, ws

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const WebSocket = require("ws");

function createCodexTransport({
  endpoint = "",
  managedWebSocket = false,
  managedWebSocketHost = "127.0.0.1",
  managedWebSocketPort = 0,
  env = process.env,
  appPath = "",
  spawnImpl = spawn,
  WebSocketImpl = WebSocket,
  netImpl = net,
} = {}) {
  if (endpoint) {
    return createWebSocketTransport({ endpoint, WebSocketImpl });
  }

  if (managedWebSocket) {
    return createManagedWebSocketTransport({
      env,
      appPath,
      spawnImpl,
      WebSocketImpl,
      netImpl,
      host: managedWebSocketHost,
      port: managedWebSocketPort,
    });
  }

  return createSpawnTransport({ env, appPath, spawnImpl });
}

function createSpawnTransport({ env, appPath, spawnImpl = spawn }) {
  const launchPlans = createCodexLaunchPlans({ env, appPath });
  let launchIndex = -1;
  let activeLaunch = null;
  let codex = null;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let didRequestShutdown = false;
  let didReportError = false;
  const listeners = createListenerBag();

  spawnNextLaunch();

  return {
    mode: "spawn",
    describe() {
      return activeLaunch?.description || launchPlans[0]?.description || "`codex app-server`";
    },
    send(message) {
      if (!codex.stdin.writable || codex.stdin.destroyed || codex.stdin.writableEnded) {
        return;
      }

      codex.stdin.write(message.endsWith("\n") ? message : `${message}\n`);
    },
    onMessage(handler) {
      listeners.onMessage = handler;
    },
    onClose(handler) {
      listeners.onClose = handler;
    },
    onError(handler) {
      listeners.onError = handler;
    },
    onStarted(handler) {
      listeners.onStarted = handler;
    },
    shutdown() {
      didRequestShutdown = true;
      shutdownCodexProcess(codex);
    },
  };

  // Retries the launch once with the bundled desktop binary when the shell-visible
  // `codex` command is unavailable in daemon environments like launchd.
  function spawnNextLaunch() {
    launchIndex += 1;
    activeLaunch = launchPlans[launchIndex] || null;
    if (!activeLaunch) {
      return;
    }

    stdoutBuffer = "";
    stderrBuffer = "";
    codex = spawnImpl(activeLaunch.command, activeLaunch.args, activeLaunch.options);
    attachChildListeners(codex, activeLaunch);
  }

  function attachChildListeners(child, launch) {
    child.on("spawn", () => {
      if (child !== codex) {
        return;
      }

      listeners.emitStarted({
        mode: "spawn",
        launchDescription: launch.description,
      });
    });
    child.on("error", (error) => {
      if (child !== codex) {
        return;
      }

      if (!didRequestShutdown && shouldRetryLaunchError(error, launchIndex, launchPlans)) {
        spawnNextLaunch();
        return;
      }

      didReportError = true;
      listeners.emitError(error);
    });
    child.on("close", (code, signal) => {
      if (child !== codex) {
        return;
      }

      if (!didRequestShutdown && !didReportError && code !== 0) {
        didReportError = true;
        listeners.emitError(createCodexCloseError({
          code,
          signal,
          stderrBuffer,
          launchDescription: launch.description,
        }));
        return;
      }

      listeners.emitClose(code, signal);
    });
    // Ignore broken-pipe shutdown noise once the child is already going away.
    child.stdin.on("error", (error) => {
      if (child !== codex) {
        return;
      }

      if (didRequestShutdown && isIgnorableStdinShutdownError(error)) {
        return;
      }

      if (isIgnorableStdinShutdownError(error)) {
        return;
      }

      didReportError = true;
      listeners.emitError(error);
    });
    // Keep stderr muted during normal operation, but preserve enough output to
    // explain launch failures when the child exits before the bridge can use it.
    child.stderr.on("data", (chunk) => {
      if (child !== codex) {
        return;
      }
      stderrBuffer = appendOutputBuffer(stderrBuffer, chunk.toString("utf8"));
    });

    child.stdout.on("data", (chunk) => {
      if (child !== codex) {
        return;
      }
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine) {
          listeners.emitMessage(trimmedLine);
        }
      }
    });
  }
}

// Builds a single, platform-aware launch path so the bridge never "guesses"
// between multiple commands and accidentally starts duplicate runtimes.
function createCodexLaunchPlans({
  env,
  appPath = "",
  platform = process.platform,
  fsImpl = fs,
  pathImpl = path,
  appServerArgs = ["app-server"],
} = {}) {
  const sharedOptions = {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...env },
  };

  if (platform === "win32") {
    return [{
      command: env.ComSpec || "cmd.exe",
      args: ["/d", "/c", ["codex", ...appServerArgs].join(" ")],
      options: {
        ...sharedOptions,
        windowsHide: true,
      },
      description: `\`cmd.exe /d /c codex ${appServerArgs.join(" ")}\``,
    }];
  }

  const launches = [{
    command: "codex",
    args: appServerArgs,
    options: sharedOptions,
    description: `\`codex ${appServerArgs.join(" ")}\``,
  }];

  const bundledCommand = buildBundledCodexPath(appPath, { fsImpl, pathImpl });
  if (bundledCommand) {
    launches.push({
      command: bundledCommand,
      args: appServerArgs,
      options: sharedOptions,
      description: `\`${bundledCommand} ${appServerArgs.join(" ")}\``,
    });
  }

  return launches;
}

function buildBundledCodexPath(appPath, { fsImpl = fs, pathImpl = path } = {}) {
  if (typeof appPath !== "string" || !appPath.trim()) {
    return "";
  }

  const candidate = pathImpl.join(appPath.trim(), "Contents", "Resources", "codex");
  return isLaunchableFile(candidate, { fsImpl }) ? candidate : "";
}

function isLaunchableFile(candidatePath, { fsImpl = fs } = {}) {
  try {
    return fsImpl.statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

// Stops the exact process tree we launched on Windows so the shell wrapper
// does not leave a child Codex process running in the background.
function shutdownCodexProcess(codex) {
  if (codex.killed || codex.exitCode !== null) {
    return;
  }

  if (process.platform === "win32" && codex.pid) {
    const killer = spawn("taskkill", ["/pid", String(codex.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => {
      codex.kill();
    });
    return;
  }

  codex.kill("SIGTERM");
}

function createCodexCloseError({ code, signal, stderrBuffer, launchDescription }) {
  const details = stderrBuffer.trim();
  const reason = details || `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}.`;
  return new Error(`Codex launcher ${launchDescription} failed: ${reason}`);
}

function appendOutputBuffer(buffer, chunk) {
  const next = `${buffer}${chunk}`;
  return next.slice(-4_096);
}

function isIgnorableStdinShutdownError(error) {
  return error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED";
}

function shouldRetryLaunchError(error, launchIndex, launchPlans) {
  return error?.code === "ENOENT" && launchIndex < launchPlans.length - 1;
}

function createManagedWebSocketTransport({
  env,
  appPath,
  spawnImpl = spawn,
  WebSocketImpl = WebSocket,
  netImpl = net,
  host = "127.0.0.1",
  port = 0,
  connectTimeoutMs = 10_000,
  reconnectDelayMs = 120,
  pendingSendLimit = 1_000,
} = {}) {
  const listeners = createListenerBag();
  const openState = WebSocketImpl.OPEN ?? WebSocket.OPEN ?? 1;
  const connectingState = WebSocketImpl.CONNECTING ?? WebSocket.CONNECTING ?? 0;
  const pendingMessages = [];

  let endpoint = "";
  let launchPlans = [];
  let launchIndex = -1;
  let activeLaunch = null;
  let codex = null;
  let socket = null;
  let stderrBuffer = "";
  let didRequestShutdown = false;
  let didReportError = false;
  let didOpenSocket = false;
  let connectStartedAt = 0;
  let connectRetryTimer = null;
  let lastSocketError = null;

  beginLaunch().catch((error) => {
    reportFatalError(error);
  });

  return {
    mode: "managed-websocket",
    describe() {
      if (activeLaunch?.description && endpoint) {
        return `${activeLaunch.description} (${endpoint})`;
      }

      return activeLaunch?.description || endpoint || "`codex app-server --listen ws://127.0.0.1:<port>`";
    },
    send(message) {
      if (socket?.readyState === openState) {
        socket.send(message);
        return;
      }

      if (pendingMessages.length >= pendingSendLimit) {
        pendingMessages.shift();
      }
      pendingMessages.push(message);
    },
    onMessage(handler) {
      listeners.onMessage = handler;
    },
    onClose(handler) {
      listeners.onClose = handler;
    },
    onError(handler) {
      listeners.onError = handler;
    },
    onStarted(handler) {
      listeners.onStarted = handler;
    },
    shutdown() {
      didRequestShutdown = true;
      clearConnectRetryTimer();
      closeSocket();
      shutdownCodexProcess(codex);
    },
  };

  async function beginLaunch() {
    endpoint = await resolveManagedWebSocketEndpoint({ host, port, netImpl });
    launchPlans = createCodexLaunchPlans({
      env,
      appPath,
      appServerArgs: ["app-server", "--listen", endpoint],
    });
    spawnNextLaunch();
  }

  function spawnNextLaunch() {
    launchIndex += 1;
    activeLaunch = launchPlans[launchIndex] || null;
    if (!activeLaunch) {
      return;
    }

    stderrBuffer = "";
    didOpenSocket = false;
    lastSocketError = null;
    connectStartedAt = Date.now();
    codex = spawnImpl(activeLaunch.command, activeLaunch.args, activeLaunch.options);
    attachChildListeners(codex, activeLaunch);
  }

  function attachChildListeners(child, launch) {
    child.on("spawn", () => {
      if (child !== codex) {
        return;
      }
      openSocketWithRetry();
    });

    child.on("error", (error) => {
      if (child !== codex) {
        return;
      }

      if (!didRequestShutdown && shouldRetryLaunchError(error, launchIndex, launchPlans)) {
        spawnNextLaunch();
        return;
      }

      reportFatalError(error);
    });

    child.on("close", (code, signal) => {
      if (child !== codex) {
        return;
      }

      clearConnectRetryTimer();
      if (!didRequestShutdown && !didOpenSocket && code !== 0 && launchIndex < launchPlans.length - 1) {
        spawnNextLaunch();
        return;
      }

      if (!didRequestShutdown && !didReportError && !didOpenSocket && code !== 0) {
        reportFatalError(createCodexCloseError({
          code,
          signal,
          stderrBuffer,
          launchDescription: launch.description,
        }));
        return;
      }

      listeners.emitClose(code, signal);
    });

    child.stderr.on("data", (chunk) => {
      if (child !== codex) {
        return;
      }
      stderrBuffer = appendOutputBuffer(stderrBuffer, chunk.toString("utf8"));
    });

    child.stdout.on("data", () => {
      // The WebSocket endpoint carries protocol traffic; stdout is only drained
      // here so a verbose app-server never blocks on a full pipe.
    });
  }

  function openSocketWithRetry() {
    if (didRequestShutdown || didOpenSocket) {
      return;
    }

    clearConnectRetryTimer();
    socket = new WebSocketImpl(endpoint);

    socket.on("message", (chunk) => {
      const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (message.trim()) {
        listeners.emitMessage(message);
      }
    });

    socket.on("open", () => {
      didOpenSocket = true;
      lastSocketError = null;
      flushPendingMessages();
      listeners.emitStarted({
        mode: "managed-websocket",
        launchDescription: activeLaunch?.description || endpoint,
        endpoint,
      });
    });

    socket.on("close", (code, reason) => {
      const safeReason = reason ? reason.toString("utf8") : "no reason";
      if (!didOpenSocket && !didRequestShutdown) {
        scheduleSocketRetry();
        return;
      }
      listeners.emitClose(code, safeReason);
    });

    socket.on("error", (error) => {
      if (!didOpenSocket && !didRequestShutdown) {
        lastSocketError = error;
        return;
      }
      listeners.emitError(error);
    });
  }

  function scheduleSocketRetry() {
    if (Date.now() - connectStartedAt >= connectTimeoutMs) {
      const detail = lastSocketError?.message || stderrBuffer.trim() || "Timed out waiting for the managed WebSocket endpoint.";
      reportFatalError(new Error(`Codex managed WebSocket did not become ready at ${endpoint}: ${detail}`));
      return;
    }

    connectRetryTimer = setTimeout(() => {
      connectRetryTimer = null;
      openSocketWithRetry();
    }, reconnectDelayMs);
    connectRetryTimer.unref?.();
  }

  function flushPendingMessages() {
    while (pendingMessages.length > 0 && socket?.readyState === openState) {
      socket.send(pendingMessages.shift());
    }
  }

  function closeSocket() {
    if (socket?.readyState === openState || socket?.readyState === connectingState) {
      socket.close();
    }
  }

  function clearConnectRetryTimer() {
    if (!connectRetryTimer) {
      return;
    }
    clearTimeout(connectRetryTimer);
    connectRetryTimer = null;
  }

  function reportFatalError(error) {
    if (didRequestShutdown || didReportError) {
      return;
    }
    didReportError = true;
    clearConnectRetryTimer();
    listeners.emitError(error);
  }
}

function resolveManagedWebSocketEndpoint({ host, port, netImpl = net }) {
  const normalizedHost = host || "127.0.0.1";
  const normalizedPort = Number.parseInt(String(port || 0), 10);
  if (Number.isInteger(normalizedPort) && normalizedPort > 0) {
    return Promise.resolve(`ws://${normalizedHost}:${normalizedPort}`);
  }

  return new Promise((resolve, reject) => {
    const server = netImpl.createServer();
    server.once("error", reject);
    server.listen(0, normalizedHost, () => {
      const address = server.address();
      const selectedPort = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(`ws://${normalizedHost}:${selectedPort}`);
      });
    });
  });
}

function createWebSocketTransport({ endpoint, WebSocketImpl = WebSocket }) {
  const socket = new WebSocketImpl(endpoint);
  const listeners = createListenerBag();
  const openState = WebSocketImpl.OPEN ?? WebSocket.OPEN ?? 1;
  const connectingState = WebSocketImpl.CONNECTING ?? WebSocket.CONNECTING ?? 0;

  socket.on("message", (chunk) => {
    const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (message.trim()) {
      listeners.emitMessage(message);
    }
  });
  socket.on("open", () => {
    listeners.emitStarted({
      mode: "websocket",
      launchDescription: endpoint,
      endpoint,
    });
  });

  socket.on("close", (code, reason) => {
    const safeReason = reason ? reason.toString("utf8") : "no reason";
    listeners.emitClose(code, safeReason);
  });

  socket.on("error", (error) => listeners.emitError(error));

  return {
    mode: "websocket",
    describe() {
      return endpoint;
    },
    send(message) {
      if (socket.readyState === openState) {
        socket.send(message);
      }
    },
    onMessage(handler) {
      listeners.onMessage = handler;
    },
    onClose(handler) {
      listeners.onClose = handler;
    },
    onError(handler) {
      listeners.onError = handler;
    },
    onStarted(handler) {
      listeners.onStarted = handler;
    },
    shutdown() {
      if (socket.readyState === openState || socket.readyState === connectingState) {
        socket.close();
      }
    },
  };
}

function createListenerBag() {
  return {
    onMessage: null,
    onClose: null,
    onError: null,
    onStarted: null,
    emitMessage(message) {
      this.onMessage?.(message);
    },
    emitClose(...args) {
      this.onClose?.(...args);
    },
    emitError(error) {
      this.onError?.(error);
    },
    emitStarted(info) {
      this.onStarted?.(info);
    },
  };
}

module.exports = {
  createCodexLaunchPlans,
  createCodexTransport,
  resolveManagedWebSocketEndpoint,
};
