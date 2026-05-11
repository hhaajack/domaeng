# Getting Started With Domaeng

This guide is for a first successful run. It avoids the advanced knobs until you need them.

Domaeng is local-first:

- Codex runs on your Mac.
- Git and workspace actions run on your Mac.
- Your browser is the remote control.
- The local relay only moves pairing, reconnect, and encrypted control traffic.

## What You Need

- A Mac that will host Codex and Domaeng.
- Node.js 18 or newer.
- npm available in your shell.
- Codex CLI installed and available in your shell `PATH`.
- A browser on the same Mac or on a device that can reach your relay/private network.

You do not need a separate mobile app. The browser client is the app.

## The Short Version

Install the bridge CLI on the Mac that runs Codex:

```sh
npm install -g domaeng@latest
domaeng up
```

`domaeng up` starts the local relay and bridge service, then prints the Web App URL plus QR or pairing information.

Open the printed Web App URL, usually the `/app/` route, then scan the QR code or enter the pairing code.

## First Pairing

1. Keep `domaeng up` running until it prints pairing details.
2. Open the printed Web App URL from the browser you want to use.
3. Scan the QR code or enter the pairing code.
4. Start a thread in the Web App.
5. Send a small test prompt and confirm Codex streams a response.

After the first successful pairing, the browser stores the trusted Mac for that web origin. Later sessions can reconnect through the configured relay without forcing a fresh QR every time.

## What Success Looks Like

You should see:

- a trusted connection to the Mac in the Web App
- live assistant output streaming from the Mac-hosted Codex runtime
- the ability to stop or continue a run from the browser
- local git/workspace actions running against the checkout on the Mac

If you can do those things, the basic setup is working.

## Optional Existing-Relay CLI

If you already have a reachable relay, Tailscale endpoint, or reverse proxy, you can use the npm-installed CLI directly:

```sh
DOMAENG_RELAY="wss://your-relay.example.com/relay" domaeng up
```

On macOS, `domaeng up` uses the launchd-backed bridge path.

## Optional Source CLI

If you are developing from a checkout and want the source version of the `domaeng` command:

```sh
git clone https://github.com/hhaajack/domaeng.git
cd domaeng
npm install -g ./phodex-bridge
domaeng up
```

For a first try, the source launcher is still the smoother route because it starts the local relay and foreground bridge together.

For regular cross-device use, prefer a stable private network such as Tailscale over plain best-effort LAN discovery. See [Tailscale setup](tailscale.md).

## When To Read The Other Guides

- If another device cannot reach the Mac, read [Tailscale setup](tailscale.md).
- If you want a macOS status/menu bar control, read [Menu bar control](menu-bar.md).
- If you want to understand each button, read [Operations guide](operations.md).
- If you want to run your own relay or reverse proxy, read [Self-hosting Domaeng](self-hosting.md).
- If you need commands, environment variables, or security notes, read [Advanced reference](reference.md).

## Common First-Run Problems

### The browser cannot open the Web App

Make sure the URL is reachable from that device. A URL that works on the Mac is not always reachable from a phone on another network. For cross-device use, use a LAN address, a Tailscale address, or your own reachable relay endpoint.

### Pairing details are missing or expired

If you installed the local CLI, run:

```sh
domaeng renew-pairing
```

On macOS, you can also stop and start the bridge again:

```sh
domaeng stop
domaeng up
```

### The menu bar control says the CLI is missing

Install the bridge CLI first:

```sh
npm install -g domaeng@latest
```

If you are developing from a checkout, install the local source version instead:

```sh
cd domaeng
npm install -g ./phodex-bridge
```

Then use the control's Retry action.

### You need to report a bug

Do not post QR codes, pairing codes, or raw `domaeng status --json` output publicly. They can contain live pairing or bearer-like details.
