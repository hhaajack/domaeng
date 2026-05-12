// FILE: local-relay-url.test.js
// Purpose: Verifies LAN-advertised local relay URL resolution for phone-first onboarding.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/local-relay-url

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveAdvertisedLocalRelayHost,
  resolveDefaultLocalRelayUrl,
} = require("../src/local-relay-url");

test("resolveDefaultLocalRelayUrl advertises a LAN IPv4 address before loopback", () => {
  const osImpl = osWithInterfaces({
    lo0: [{ address: "127.0.0.1", internal: true }],
    utun9: [{ address: "100.64.1.5" }],
    en0: [{ address: "192.168.1.44" }],
  });

  assert.equal(resolveAdvertisedLocalRelayHost({ env: {}, osImpl }), "192.168.1.44");
  assert.equal(resolveDefaultLocalRelayUrl({ env: {}, osImpl }), "ws://192.168.1.44:9000/relay");
});

test("resolveDefaultLocalRelayUrl prefers Tailscale CGNAT before other non-LAN IPv4 addresses", () => {
  const osImpl = osWithInterfaces({
    en0: [{ address: "203.0.113.5" }],
    utun9: [{ address: "100.64.1.5" }],
  });

  assert.equal(resolveAdvertisedLocalRelayHost({ env: {}, osImpl }), "100.64.1.5");
  assert.equal(resolveDefaultLocalRelayUrl({ env: {}, osImpl }), "ws://100.64.1.5:9000/relay");
});

test("resolveDefaultLocalRelayUrl supports explicit advertise host and port overrides", () => {
  assert.equal(
    resolveDefaultLocalRelayUrl({
      env: {
        DOMAENG_LOCAL_RELAY_ADVERTISE_HOST: "macbook.local",
        DOMAENG_LOCAL_RELAY_PORT: "9100",
      },
      osImpl: osWithInterfaces({}),
    }),
    "ws://macbook.local:9100/relay"
  );
});

test("resolveDefaultLocalRelayUrl falls back to loopback when no LAN address is available", () => {
  assert.equal(
    resolveDefaultLocalRelayUrl({
      env: {},
      osImpl: osWithInterfaces({
        lo0: [{ address: "127.0.0.1", internal: true }],
      }),
    }),
    "ws://127.0.0.1:9000/relay"
  );
});

function osWithInterfaces(interfaces) {
  return {
    networkInterfaces() {
      return Object.fromEntries(
        Object.entries(interfaces).map(([name, entries]) => [
          name,
          entries.map((entry) => ({
            family: "IPv4",
            internal: false,
            ...entry,
          })),
        ])
      );
    },
  };
}
