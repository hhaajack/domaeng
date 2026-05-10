// FILE: relay.test.js
// Purpose: Verifies relay websocket liveness behavior under slow or stalled mobile links.
// Layer: Unit test
// Depends on: node:test, node:assert/strict, node:events, ./relay

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { setupRelay } = require("./relay");

test("relay heartbeat tolerates more than one missed pong before terminating", () => {
  let tick = null;
  const wss = new EventEmitter();
  const ws = {
    _relayAlive: false,
    _relayRole: "iphone",
    _relaySessionId: "session-slow",
    pings: 0,
    terminated: 0,
    ping() {
      this.pings += 1;
    },
    terminate() {
      this.terminated += 1;
    },
  };
  wss.clients = new Set([ws]);

  setupRelay(wss, {
    heartbeatIntervalMs: 1,
    heartbeatMissLimit: 3,
    setIntervalFn(callback) {
      tick = callback;
      return { unref() {} };
    },
    clearIntervalFn() {},
  });

  tick();
  tick();
  assert.equal(ws.terminated, 0);
  assert.equal(ws.pings, 2);

  tick();
  assert.equal(ws.terminated, 1);
});
