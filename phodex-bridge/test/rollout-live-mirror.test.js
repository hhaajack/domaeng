// FILE: rollout-live-mirror.test.js
// Purpose: Verifies desktop-origin rollout replay/live tailing emits thinking and tool-call notifications for iPhone only.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/rollout-live-mirror

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: wait } = require("node:timers/promises");

const {
  createRolloutLiveMirrorController,
  isDesktopRolloutOrigin,
} = require("../src/rollout-live-mirror");

test("desktop-origin active runs replay thinking and exec command activity on resume", async (t) => {
  const { homeDir, rolloutPath } = createTemporaryRolloutHome({
    threadId: "thread-desktop",
    originator: "Codex Desktop",
    source: "vscode",
    lines: [
      taskStarted("turn-live"),
      functionCall("call-1", "exec_command", {
        cmd: "git status",
        workdir: "/repo",
      }),
      functionCallOutput("call-1", "On branch main"),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    pollIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  controller.observeInbound(JSON.stringify({
    method: "thread/resume",
    params: {
      threadId: "thread-desktop",
    },
  }));

  await wait(30);

  assert.equal(rolloutPath.includes("thread-desktop"), true);
  assert.deepEqual(
    outbound.map((message) => message.method),
    [
      "turn/started",
      "item/reasoning/textDelta",
      "codex/event/exec_command_begin",
      "codex/event/exec_command_output_delta",
      "codex/event/exec_command_end",
    ]
  );
  assert.equal(outbound[1].params.delta, "Thinking...");
  assert.equal(outbound[2].params.command, "git status");
  assert.equal(outbound[3].params.chunk, "On branch main");
});

test("desktop-origin active mirrors replay running state for later web reads", async (t) => {
  const { homeDir } = createTemporaryRolloutHome({
    threadId: "thread-reread",
    originator: "Codex Desktop",
    source: "vscode",
    lines: [
      taskStarted("turn-live"),
      functionCall("call-1", "exec_command", {
        cmd: "npm test",
        workdir: "/repo",
      }),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    pollIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  const readRequest = JSON.stringify({
    method: "thread/read",
    params: {
      threadId: "thread-reread",
    },
  });
  controller.observeInbound(readRequest);
  await wait(30);
  outbound.length = 0;

  controller.observeInbound(readRequest);
  await wait(10);

  assert.deepEqual(outbound.map((message) => message.method), ["turn/started"]);
  assert.equal(outbound[0].params.threadId, "thread-reread");
  assert.equal(outbound[0].params.turnId, "turn-live");
});

test("desktop-origin active rollouts are discovered without a web thread read", async (t) => {
  const { homeDir } = createTemporaryRolloutHome({
    threadId: "thread-auto",
    originator: "Codex Desktop",
    source: "vscode",
    lines: [
      userMessage("Desktop started this"),
      taskStarted("turn-auto"),
      functionCall("call-auto", "exec_command", {
        cmd: "npm test",
        workdir: "/repo",
      }),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    autoDiscoverActiveRollouts: true,
    pollIntervalMs: 5,
    discoveryIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  await wait(30);

  assert.deepEqual(
    outbound.map((message) => message.method),
      [
        "codex/event/user_message",
        "turn/started",
        "item/reasoning/textDelta",
        "codex/event/exec_command_begin",
      ]
    );
  assert.equal(outbound[0].params.threadId, "thread-auto");
  assert.equal(outbound[3].params.command, "npm test");
});

test("desktop-origin response-item rollouts are discovered as running without task events", async (t) => {
  const { homeDir } = createTemporaryRolloutHome({
    threadId: "thread-response-active",
    originator: "remodex_web",
    source: "vscode",
    lines: [
      responseUserMessage("Please keep running"),
      functionCall("call-response", "exec_command", {
        cmd: "sleep 20",
        workdir: "/repo",
      }),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    autoDiscoverActiveRollouts: true,
    pollIntervalMs: 5,
    discoveryIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  await wait(30);

  assert.deepEqual(
    outbound.map((message) => message.method),
    [
      "turn/started",
      "item/reasoning/textDelta",
      "codex/event/exec_command_begin",
    ]
  );
  assert.equal(outbound[0].params.threadId, "thread-response-active");
  assert.equal(outbound[0].params.turnId, "__running__");
  assert.equal(outbound[2].params.command, "sleep 20");
});

test("desktop-origin discovery recovers active runs behind oversized user payloads", async (t) => {
  const { homeDir } = createTemporaryRolloutHome({
    threadId: "thread-large-active",
    originator: "Codex Desktop",
    source: "vscode",
    lines: [
      taskStarted("turn-large"),
      userMessage("x".repeat(700 * 1024)),
      agentMessage("still working", "commentary"),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    autoDiscoverActiveRollouts: true,
    pollIntervalMs: 5,
    discoveryIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  await wait(30);

  assert.deepEqual(outbound.map((message) => message.method).slice(0, 2), [
    "turn/started",
    "item/reasoning/textDelta",
  ]);
  assert.equal(outbound[0].params.threadId, "thread-large-active");
  assert.equal(outbound[0].params.turnId, "turn-large");
});

test("desktop-origin live mirror sends completion when final assistant text arrives", async (t) => {
  const { homeDir, rolloutPath } = createTemporaryRolloutHome({
    threadId: "thread-chat",
    originator: "Codex Desktop",
    source: "desktop",
    lines: [
      userMessage("Please review this diff"),
      taskStarted("turn-chat"),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    pollIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  controller.observeInbound(JSON.stringify({
    method: "thread/resume",
    params: {
      threadId: "thread-chat",
    },
  }));

  await wait(30);
  outbound.length = 0;

  appendRolloutLines(rolloutPath, [
    agentMessage("Review complete", "final_answer"),
  ]);
  await wait(30);

  assert.deepEqual(
    outbound.map((message) => message.method),
    [
      "codex/event/agent_message",
      "turn/completed",
    ]
  );
  assert.equal(outbound[0].params.message, "Review complete");
  assert.equal(outbound[1].params.turnId, "turn-chat");
  assert.equal(
    outbound[0].params.itemId,
    "rollout-agent-message:thread-chat:turn-chat:2026-03-15T19:47:40.000Z:73e01b91e228"
  );
});

test("desktop-origin active runs mirror generated image previews", async (t) => {
  const { homeDir } = createTemporaryRolloutHome({
    threadId: "thread-image",
    originator: "Codex Desktop",
    source: "desktop",
    lines: [
      taskStarted("turn-image"),
      imageGenerationCall("ig_123"),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    pollIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  controller.observeInbound(JSON.stringify({
    method: "thread/resume",
    params: {
      threadId: "thread-image",
    },
  }));

  await wait(30);

  assert.deepEqual(
    outbound.map((message) => message.method),
    [
      "turn/started",
      "item/reasoning/textDelta",
      "codex/event/image_generation_end",
    ]
  );
  assert.equal(outbound[2].params.call_id, "ig_123");
  assert.equal(outbound[2].params.itemId, "ig_123");
  assert.equal(outbound[2].params.turnId, "turn-image");
  assert.equal(
    outbound[2].params.saved_path,
    path.join(homeDir, "generated_images", "thread-image", "ig_123.png")
  );
});

test("desktop-origin active runs mirror imageView items", async (t) => {
  const { homeDir } = createTemporaryRolloutHome({
    threadId: "thread-image-view",
    originator: "Codex Desktop",
    source: "desktop",
    lines: [
      taskStarted("turn-image-view"),
      imageViewItem("view_123", "/tmp/generated view.png"),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    pollIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  controller.observeInbound(JSON.stringify({
    method: "thread/resume",
    params: {
      threadId: "thread-image-view",
    },
  }));

  await wait(30);

  assert.deepEqual(
    outbound.map((message) => message.method),
    [
      "turn/started",
      "item/reasoning/textDelta",
      "codex/event/image_generation_end",
    ]
  );
  assert.equal(outbound[2].params.call_id, "view_123");
  assert.equal(outbound[2].params.saved_path, "/tmp/generated view.png");
});

test("desktop-origin active runs mirror image_generation items", async (t) => {
  const { homeDir } = createTemporaryRolloutHome({
    threadId: "thread-image-generation",
    originator: "Codex Desktop",
    source: "desktop",
    lines: [
      taskStarted("turn-image-generation"),
      imageGenerationItem("ig_generation", "/tmp/generated item.png"),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    pollIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  controller.observeInbound(JSON.stringify({
    method: "thread/resume",
    params: {
      threadId: "thread-image-generation",
    },
  }));

  await wait(30);

  assert.deepEqual(
    outbound.map((message) => message.method),
    [
      "turn/started",
      "item/reasoning/textDelta",
      "codex/event/image_generation_end",
    ]
  );
  assert.equal(outbound[2].params.call_id, "ig_generation");
  assert.equal(outbound[2].params.saved_path, "/tmp/generated item.png");
});

test("desktop-origin active runs mirror generated image end events without response items", async (t) => {
  const { homeDir } = createTemporaryRolloutHome({
    threadId: "thread-image-event",
    originator: "Codex Desktop",
    source: "desktop",
    lines: [
      taskStarted("turn-image-event"),
      imageGenerationEnd("turn-image-event", "ig_event", "/tmp/generated event.png"),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    pollIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  controller.observeInbound(JSON.stringify({
    method: "thread/resume",
    params: {
      threadId: "thread-image-event",
    },
  }));

  await wait(30);

  assert.deepEqual(
    outbound.map((message) => message.method),
    [
      "turn/started",
      "item/reasoning/textDelta",
      "codex/event/image_generation_end",
    ]
  );
  assert.equal(outbound[2].params.call_id, "ig_event");
  assert.equal(outbound[2].params.itemId, "ig_event");
  assert.equal(outbound[2].params.turnId, "turn-image-event");
  assert.equal(outbound[2].params.saved_path, "/tmp/generated event.png");
});

test("phone-origin rollouts do not emit mirrored updates", async (t) => {
  const { homeDir } = createTemporaryRolloutHome({
    threadId: "thread-phone",
    originator: "codexmobile_ios",
    source: "ios",
    lines: [
      taskStarted("turn-live"),
      functionCall("call-1", "exec_command", {
        cmd: "git status",
        workdir: "/repo",
      }),
    ],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    pollIntervalMs: 5,
    idleTimeoutMs: 50,
  });
  t.after(() => controller.stopAll());

  controller.observeInbound(JSON.stringify({
    method: "thread/read",
    params: {
      threadId: "thread-phone",
    },
  }));

  await wait(30);

  assert.deepEqual(outbound, []);
});

test("desktop-origin idle watchers stream new rollout growth after the phone reopens the thread", async (t) => {
  const { homeDir, rolloutPath } = createTemporaryRolloutHome({
    threadId: "thread-grow",
    originator: "codex_vscode",
    source: "vscode",
    lines: [],
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const outbound = [];
  const controller = createRolloutLiveMirrorController({
    sendApplicationResponse(message) {
      outbound.push(JSON.parse(message));
    },
    pollIntervalMs: 5,
    idleTimeoutMs: 100,
  });
  t.after(() => controller.stopAll());

  controller.observeInbound(JSON.stringify({
    method: "thread/resume",
    params: {
      threadId: "thread-grow",
    },
  }));
  await wait(20);

  appendRolloutLines(rolloutPath, [
    taskStarted("turn-next"),
    functionCall("call-2", "apply_patch", {}),
  ]);
  await wait(30);

  assert.deepEqual(
    outbound.map((message) => message.method),
    [
      "turn/started",
      "item/reasoning/textDelta",
      "codex/event/background_event",
    ]
  );
  assert.equal(outbound[2].params.message, "Applying patch");
});

test("desktop-origin detection stays narrow", () => {
  assert.equal(isDesktopRolloutOrigin({ originator: "Codex Desktop", source: "vscode" }), true);
  assert.equal(isDesktopRolloutOrigin({ originator: "codex_vscode", source: "vscode" }), true);
  assert.equal(isDesktopRolloutOrigin({ originator: "codexmobile_ios", source: "ios" }), false);
});

function createTemporaryRolloutHome({ threadId, originator, source, lines }) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-live-mirror-"));
  const threadDir = path.join(homeDir, "sessions", "2026", "03", "15");
  fs.mkdirSync(threadDir, { recursive: true });
  const rolloutPath = path.join(threadDir, `rollout-2026-03-15T19-47-36-${threadId}.jsonl`);
  const header = JSON.stringify({
    timestamp: "2026-03-15T19:47:36.019Z",
    type: "session_meta",
    payload: {
      id: threadId,
      cwd: "/repo",
      originator,
      source,
    },
  });
  fs.writeFileSync(rolloutPath, [header, ...lines, ""].join("\n"));
  return { homeDir, rolloutPath };
}

function appendRolloutLines(rolloutPath, lines) {
  fs.appendFileSync(rolloutPath, `${lines.join("\n")}\n`);
}

function taskStarted(turnId) {
  return JSON.stringify({
    timestamp: "2026-03-15T19:47:37.000Z",
    type: "event_msg",
    payload: {
      type: "task_started",
      turn_id: turnId,
      model_context_window: 258400,
    },
  });
}

function userMessage(message) {
  return JSON.stringify({
    timestamp: "2026-03-15T19:47:36.500Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message,
    },
  });
}

function responseUserMessage(message) {
  return JSON.stringify({
    timestamp: "2026-03-15T19:47:36.500Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: message,
        },
      ],
    },
  });
}

function agentMessage(message, phase = "final_answer") {
  return JSON.stringify({
    timestamp: "2026-03-15T19:47:40.000Z",
    type: "event_msg",
    payload: {
      type: "agent_message",
      message,
      phase,
    },
  });
}

function functionCall(callId, name, argumentsObject) {
  return JSON.stringify({
    timestamp: "2026-03-15T19:47:38.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      call_id: callId,
      name,
      arguments: JSON.stringify(argumentsObject),
    },
  });
}

function functionCallOutput(callId, output) {
  return JSON.stringify({
    timestamp: "2026-03-15T19:47:39.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: callId,
      output,
    },
  });
}

function imageGenerationCall(itemId) {
  return JSON.stringify({
    timestamp: "2026-03-15T19:47:39.500Z",
    type: "response_item",
    payload: {
      id: itemId,
      type: "image_generation_call",
      status: "completed",
      result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    },
  });
}

function imageGenerationEnd(turnId, callId, savedPath) {
  return JSON.stringify({
    timestamp: "2026-03-15T19:47:39.500Z",
    type: "event_msg",
    payload: {
      type: "image_generation_end",
      id: turnId,
      turn_id: turnId,
      call_id: callId,
      saved_path: savedPath,
      result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    },
  });
}

function imageViewItem(itemId, imagePath) {
  return JSON.stringify({
    timestamp: "2026-03-15T19:47:39.500Z",
    type: "response_item",
    payload: {
      id: itemId,
      type: "imageView",
      path: imagePath,
    },
  });
}

function imageGenerationItem(itemId, imagePath) {
  return JSON.stringify({
    timestamp: "2026-03-15T19:47:39.500Z",
    type: "response_item",
    payload: {
      id: itemId,
      type: "image_generation",
      path: imagePath,
      result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    },
  });
}

function restoreCodexHome(previousCodexHome) {
  if (previousCodexHome == null) {
    delete process.env.CODEX_HOME;
    return;
  }
  process.env.CODEX_HOME = previousCodexHome;
}
