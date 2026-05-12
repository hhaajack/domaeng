# Domaeng Reference

This page keeps the details out of the front-page README. Start with [README.md](../README.md) if you only want the normal install path.

## Related Guides

- [Getting started](getting-started.md): first install, first pairing, and first successful run.
- [Tailscale setup](tailscale.md): private cross-device access without hardcoded hosted-service assumptions.
- [Menu bar control](menu-bar.md): optional native macOS control panel for the background service.
- [Operations guide](operations.md): user-facing explanations of common actions.
- [Self-hosting Domaeng](self-hosting.md): local LAN, private relay, reverse proxy, and troubleshooting.

## Commands

| Command | What it does |
| --- | --- |
| `domaeng up` | Friendly start command. On macOS it starts the background bridge service and prints pairing information. |
| `domaeng start` | Start the macOS bridge service. |
| `domaeng stop` | Stop the macOS bridge service. |
| `domaeng restart` | Restart the macOS bridge service. |
| `domaeng status` | Show bridge status. Avoid posting raw JSON status publicly because it can include live pairing data. |
| `domaeng reset-pairing` | Clear local pairing state when you intentionally want to trust a new client. |
| `domaeng resume` | Reopen the most recently active thread in `Codex.app`. |
| `domaeng watch [threadId]` | Watch local rollout updates for a thread. |
| `domaeng menubar status` | Check whether the optional native MenuBar app is bundled or installed. |
| `domaeng menubar install` | Install the bundled prebuilt `DomaengMenuBar.app` to `~/Applications` and enable login startup. |
| `domaeng menubar open` | Open the installed or bundled `DomaengMenuBar.app`. |
| `domaeng menubar login on\|off` | Enable or disable MenuBar open-at-login. |

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOMAENG_RELAY` | Local bundled relay in npm installs, empty in source checkouts | Relay URL used for QR bootstrap, trusted-session resolve, and client/Mac routing. Set this for Tailscale or self-hosting. |
| `DOMAENG_CODEX_ENDPOINT` | Empty | Connect to an existing Codex WebSocket instead of spawning a local `codex app-server`. |
| `DOMAENG_SHARED_CODEX_RUNTIME` | `true` on macOS | Start the bridge-owned Codex runtime as a localhost WebSocket app-server. |
| `DOMAENG_SHARED_CODEX_RUNTIME_PORT` | `0` | Localhost port for the shared Codex runtime. `0` chooses a free port. |
| `DOMAENG_REFRESH_ENABLED` | `false` | Enable the optional `Codex.app` desktop refresh workaround. |
| `DOMAENG_DESKTOP_SHARED_RUNTIME` | `false` | Experimental: relaunch `Codex.app` onto the bridge/shared Codex WebSocket endpoint. |
| `DOMAENG_PUSH_SERVICE_URL` | Empty | Enable push only when your self-hosted relay also exposes a configured push service. |
| `DOMAENG_TRUST_PROXY` | Empty | Use only behind a trusted reverse proxy such as Traefik, Nginx, or Caddy. |

## Security Notes

- Domaeng is local-first: Codex, git operations, and workspace actions run on your Mac.
- The web app is a paired remote control. It does not become the Codex runtime.
- The relay forwards transport traffic. After pairing, application payloads are end-to-end encrypted between the browser and the Mac bridge.
- The relay can still see connection metadata and handshake control messages, so the tightest trust model is to run it yourself.
- QR codes and pairing codes contain short-lived live session information. Do not post them publicly.
- Do not paste raw `domaeng status --json` output into public issues because it can include live pairing data.

## Integrations

### Git

The bridge intercepts `git/*` JSON-RPC calls from the paired client and executes them locally on the Mac. That keeps repository credentials and workspace access on the host machine.

### Workspace

Workspace-scoped operations, including patch previews and revert flows, happen through the bridge against the local checkout.

### Codex Desktop

Domaeng works with both the Codex CLI and `Codex.app`. The bridge talks to a `codex app-server` process, and conversations are persisted as JSONL rollout files under `~/.codex/sessions`.

The desktop app can read the same history from disk. True live desktop mirroring is still experimental and requires opt-in shared-runtime settings.

## Source Build

For a full local source install, build the web app first:

```sh
cd web
npm install
npm run build
```

Then install the bridge CLI from this checkout:

```sh
cd ..
npm install -g ./phodex-bridge
domaeng --version
```

If npm reports a user-cache ownership error, retry with a temporary cache:

```sh
npm --cache /private/tmp/domaeng-npm-cache install -g ./phodex-bridge
```
