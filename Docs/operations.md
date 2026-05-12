# Domaeng Operations Guide

This page explains the common Domaeng operations from a user point of view. It is not an API reference.

## Runtime Operations

| Operation | What it means |
| --- | --- |
| Start | Start the local bridge flow so the Web App can reach Codex through the configured relay. On macOS this uses the launchd-backed service path. |
| Stop | Stop the macOS bridge service. The Web App will lose its live connection until the bridge starts again. |
| Restart | Start the bridge service again using the saved/current configuration. |
| Refresh | Ask the CLI for a fresh status snapshot. This does not reset trust or pairing state. |
| Status | Show bridge, daemon, connection, relay, and pairing state. Do not post raw JSON status publicly. |

## Pairing And Trust

| Operation | What it means |
| --- | --- |
| Pair | The first trust bootstrap between one browser and one Mac. Use the QR code or short pairing code. |
| Renew Pairing | Ask the bridge for a fresh short-lived QR/code without intentionally clearing trusted devices. |
| Reset Pairing | Clear local pairing state when you want to start over or trust a new client from scratch. |
| Trusted Reconnect | After a successful first pairing, the browser can find the current live Mac session through the configured relay and reconnect without a new QR. |
| Disable Trusted Device | Keep the trusted device record, but stop it from reconnecting. |
| Enable Trusted Device | Allow a disabled trusted device to reconnect again. |
| Remove Trusted Device | Revoke that browser/device from trusted reconnect. |

Pairing codes and QR payloads are short-lived but sensitive. Treat them like bearer-style access material while they are valid.

## Web App Operations

| Operation | What it means |
| --- | --- |
| Start a run | Send a prompt to the Mac-hosted Codex runtime. |
| Steer a run | Send follow-up guidance while working in the same thread. |
| Stop a run | Ask Codex to interrupt the active turn. On recovery paths, the bridge may resolve the active turn from thread state before interrupting. |
| Resume a thread | Continue an existing thread instead of starting a new one. |
| Queue a follow-up | Add another prompt while the current turn is still running. |
| Attach an image | Send an image attachment through the paired Web App to the local runtime. |
| Browser notifications | Let the browser notify you when a turn completes or needs attention. Push is optional and off by default unless self-hosted push is configured. |

## Git And Workspace Operations

Git and workspace actions are local actions. The paired browser asks the bridge to perform them on the Mac.

| Operation | What it means |
| --- | --- |
| Git status | Inspect the local repository state on the Mac. |
| Commit | Create a local git commit from the selected changes. |
| Push | Push from the Mac's local git checkout using the credentials available there. |
| Pull | Pull into the Mac's local checkout. |
| Branch switch | Switch branches in the local checkout. |
| Patch preview/revert | Inspect or apply workspace changes through the bridge against the local files. |

The relay does not execute git commands and should not receive repository credentials.

## Connection Operations

| Operation | What it means |
| --- | --- |
| Local LAN Relay | Use a relay URL reachable on the same local network. This is simple but can be unreliable across routers, Wi-Fi isolation, or changing IPs. |
| Tailscale Relay | Use a private Tailscale-reachable relay path for cross-device access. This is often smoother than plain LAN routing. |
| Custom Relay Override | Point the bridge at a relay endpoint you control, such as a private reverse proxy or VPS relay. |
| Self-hosted Relay | Run the relay yourself. Codex still runs on the Mac; the relay remains transport only. |

## Logs And Diagnostics

Use logs when the bridge starts but the Web App cannot pair or reconnect.

Useful checks:

- `domaeng status`
- `domaeng status --json` for local machine-readable diagnostics only
- relay `/health` endpoint when running a local or self-hosted relay

Avoid posting live relay session IDs, QR payloads, pairing codes, raw JSON status, private relay hostnames, or credentials in public issues.

## Which Operation Should I Use?

- Use `Renew Pairing` when the QR/code expired.
- Use `Reset Pairing` when you intentionally want to discard local trust and pair again.
- Use `Stop` when you want the bridge service off.
- Use `Refresh` when the UI looks stale.
- Use `Tailscale Relay` when another device cannot reliably reach the Mac over normal Wi-Fi.
- Use `Self-hosted Relay` only when you want to operate your own relay endpoint.
