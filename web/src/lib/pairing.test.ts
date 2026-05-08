import { describe, expect, it } from "vitest";
import {
  canonicalTailscaleWebAppURL,
  defaultRelayEntryModeFromWebAppLocation,
  normalizeRelayURLInput,
  relayEntryOptionsFromWebAppLocation,
  parsePairingPayload,
  relayURLFromWebAppLocation,
  relayWebSocketURL,
  trustedResolveURL
} from "./pairing";

describe("pairing helpers", () => {
  it("parses QR payload JSON", () => {
    const payload = parsePairingPayload(JSON.stringify({
      v: 2,
      relay: "wss://tailnet.example/relay",
      sessionId: "session",
      macDeviceId: "mac",
      macIdentityPublicKey: "key",
      expiresAt: 123
    }));
    expect(payload.sessionId).toBe("session");
  });

  it("builds browser-safe relay websocket URLs", () => {
    expect(relayWebSocketURL("wss://tailnet.example/remodex/relay", "session 1")).toBe(
      "wss://tailnet.example/remodex/relay/session%201?role=iphone"
    );
  });

  it("derives trusted resolve URL from relay path", () => {
    expect(trustedResolveURL("wss://tailnet.example/remodex/relay")).toBe(
      "https://tailnet.example/remodex/v1/trusted/session/resolve"
    );
  });

  it("derives Tailscale HTTPS relay URLs from mistaken :9000 app URLs", () => {
    expect(relayURLFromWebAppLocation("http://mac.tailnet-example.ts.net:9000/app/")).toBe(
      "wss://mac.tailnet-example.ts.net/relay"
    );
    expect(canonicalTailscaleWebAppURL("http://mac.tailnet-example.ts.net:9000/app/")).toBe(
      "https://mac.tailnet-example.ts.net/app/"
    );
  });

  it("normalizes relay URL input pasted from the app URL", () => {
    expect(normalizeRelayURLInput("https://mac.tailnet-example.ts.net/app/")).toBe(
      "wss://mac.tailnet-example.ts.net/relay"
    );
    expect(normalizeRelayURLInput("wss://mac.tailnet-example.ts.net:9000/relay,")).toBe(
      "wss://mac.tailnet-example.ts.net/relay"
    );
  });

  it("surfaces both relay entry URLs from menu-bar query parameters", () => {
    const entries = relayEntryOptionsFromWebAppLocation(
      "http://mac.local:9000/app/?entry=local&localRelay=ws%3A%2F%2Fmac.local%3A9000%2Frelay&tailscaleRelay=wss%3A%2F%2Fmac.tailnet.ts.net%2Frelay"
    );
    expect(defaultRelayEntryModeFromWebAppLocation("http://mac.local:9000/app/?entry=tailscale")).toBe("tailscale");
    expect(entries.find((entry) => entry.mode === "local")?.relayURL).toBe("ws://mac.local:9000/relay");
    expect(entries.find((entry) => entry.mode === "tailscale")?.relayURL).toBe("wss://mac.tailnet.ts.net/relay");
  });
});
