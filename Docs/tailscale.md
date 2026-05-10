# Use Tailscale With Domaeng

Tailscale is optional. It is useful when your phone, tablet, or second computer cannot reliably reach the Mac over the same local Wi-Fi.

In Domaeng, Tailscale should be treated as a private network path to your own Mac or relay. It is not a required hosted Domaeng service.

## When To Use It

Use Tailscale when:

- the phone is not on the same Wi-Fi as the Mac
- local `.local` names or LAN IP addresses are unreliable
- you want a stable private address for the relay
- you want the setup to keep working across home, office, and travel networks

You can skip Tailscale when you only use the browser on the same Mac, or when your LAN setup is already reliable.

## Mental Model

The shape is still local-first:

```text
Browser device -> private Tailscale route -> your Mac relay/bridge -> local Codex
```

Codex still runs on the Mac. Git credentials and workspace files still stay on the Mac. Tailscale only helps the browser reach the relay path.

## Basic Setup

1. Install Tailscale on the Mac that hosts Domaeng.
2. Install Tailscale on the phone, tablet, or other browser device.
3. Sign both devices into the same tailnet.
4. Confirm the browser device can reach the Mac's Tailscale address.
5. Start Domaeng with a relay URL that the browser device can reach.
6. Open the `/app/` URL through that same reachable route and pair once.

The exact reachable URL depends on how you expose the local relay:

- Tailscale Serve or a private reverse proxy can expose an HTTPS/WSS address, commonly shaped like `https://your-mac.your-tailnet.ts.net/app/` for the Web App and `wss://your-mac.your-tailnet.ts.net/relay` for the relay.
- A direct tailnet/LAN address can work for local testing when the relay is reachable from the browser device.

Keep the actual hostname in your own local config. Do not commit personal tailnet names or private addresses to the public repo.

## With The Menu Bar Companion

The macOS menu bar control has a Connection section that can help with this flow:

- `Tailscale Web` shows the Web App URL derived from the detected or saved Tailscale address.
- `Tailscale Relay` shows the matching relay URL.
- `Use Tailscale Relay` switches the bridge to that relay path.
- `Save Tailscale Address` lets you paste a stable Tailscale host when auto-detection is not enough.
- `Auto Detect` clears the manual host and lets the control inspect the local machine again.

After switching relay paths, use the displayed QR or pairing code to trust the Mac from the Web App.

## With The CLI

If you run the installed CLI directly, point the bridge at the reachable relay URL:

```sh
DOMAENG_RELAY="wss://your-mac.your-tailnet.ts.net/relay" domaeng up
```

If you run from a source checkout and have a reachable HTTPS endpoint in front of the local relay:

```sh
./run-local-domaeng.sh --relay-url https://your-mac.your-tailnet.ts.net
```

The launcher converts HTTP(S) relay bases to the WebSocket relay path when needed.

## Troubleshooting

### The Web App opens on the Mac but not on the phone

The phone cannot reach that hostname or port. Use the Mac's reachable Tailscale address, a Tailscale Serve HTTPS address, or another private reverse proxy path.

### Pairing works once but reconnect fails later

Check that the bridge is still using the same reachable relay path. Trusted reconnect depends on the trusted browser finding the current live bridge session through the configured relay.

### The menu bar shows a blank Tailscale address

Paste the Mac's Tailscale host manually in `Tailscale Address`, save it, then use `Use Tailscale Relay`.

### Should I use a public VPS instead?

Use a public VPS relay only when you intentionally want to self-host on internet-facing infrastructure. For many personal setups, Tailscale is simpler because the relay remains reachable through a private network.
