# Menu Bar Control

The menu bar control is the small Domaeng control center that lives in the macOS status/menu bar.

It is optional. You can use Domaeng entirely from the CLI and Web App.

Packaging status: the npm package can include an optional `DomaengMenuBar.app`, but it is unsigned/adhoc-signed and not notarized. macOS may block it the first time you open it. That is expected for now.

If you do not want a menu bar control, skip this page. `domaeng up` is enough for the normal CLI + Web App path.

## Install From npm

First install the normal CLI:

```sh
npm install -g domaeng@latest
```

Then check whether this npm build contains the optional app:

```sh
domaeng menubar status
```

If it reports a bundled app, install and open it:

```sh
domaeng menubar install
domaeng menubar open
```

By default this copies the app to `~/Applications/DomaengMenuBar.app`.

Because the app is unsigned/adhoc-signed, macOS can show a warning such as "cannot be opened because the developer cannot be verified." If that happens, open **System Settings -> Privacy & Security**, allow the blocked app, then open it again. You can also Control-click the app in Finder and choose **Open**.

This warning is about Apple signing/notarization only. It does not mean the app uses a hosted Domaeng service. The bridge, relay, and Codex runtime still run locally unless you explicitly configure your own remote relay.

## What It Does

The menu bar control wraps the existing local `domaeng` CLI. It can:

- start and stop the macOS bridge service
- show daemon and bridge connection status
- show or renew pairing QR/code details
- switch between local and Tailscale relay paths
- manage trusted browser devices
- open stdout/stderr logs for debugging
- reopen the most recently active thread in `Codex.app`

It does not replace Codex, and it does not run a hosted service. The bridge and Codex runtime still run locally on your Mac.

## Source Setup Prompt

If the npm build does not include the app yet, or you are developing from a source checkout, open Codex in this repository and paste this prompt:

```text
Set up the Domaeng macOS menu bar control from this local repository.

Please keep the project local-first and do not introduce hosted-service assumptions or hardcoded relay domains.

Before changing or running anything, inspect the current README, Docs/menu-bar.md, package scripts, and CONTRIBUTING.md so you use the repo's current setup flow.

Do not run Xcode tests. Do not change unrelated files. Do not commit or print QR payloads, pairing codes, live relay session IDs, private hostnames, or raw `domaeng status --json` output.

If needed, install or update the local `domaeng` CLI, build the Web App assets, build only the `DomaengMenuBar` macOS app target, install it locally, copy the matching Web App assets into the app bundle, open the app, and verify that Start, Stop, Refresh, pairing, and relay switching behave as expected.

If any step needs permission because it writes outside the repo, asks for network access, or touches `/Applications`, explain the command and ask me first.
```

That prompt keeps the build details in Codex's hands while still telling it the important safety rules.

Advanced source-build notes for maintainers live in [CONTRIBUTING.md](../CONTRIBUTING.md).

## How To Use It

1. Open the Domaeng icon in the macOS status/menu bar.
2. Click `Start` to start the local relay and bridge.
3. Open the Web App URL shown by the control, or scan the pairing QR/code.
4. Use `Refresh` when the status looks stale.
5. Use `Stop` when you want the bridge service off.

## Popover Controls

The compact status/menu bar popover shows:

- `Service`: whether the launchd-backed bridge service is loaded.
- `Connection`: the bridge connection state.
- `Relay`: whether the current relay looks local or remote.
- `Start`: starts the local relay/bridge flow.
- `Stop`: stops the bridge service.
- `Refresh`: reloads status from the CLI.
- `Control Center`: opens the full window.
- `Quit App`: quits only the menu bar app, not necessarily the bridge service.

## Control Center

The full control center groups the same local actions into sections.

### Service

- `Daemon`: whether the launchd service is loaded.
- `Connection`: the bridge runtime connection state.
- `PID`: process identifier when available.
- `Start`: starts the bridge using the current relay setting.
- `Stop`: stops the bridge service.
- `Resume Thread`: reopens the most recently active thread in `Codex.app`.
- `Refresh`: reloads the status snapshot.

### Connection

- `Tailscale Web`: Web App URL derived from the Tailscale host.
- `Local LAN Web`: Web App URL derived from the Mac's local address.
- `Tailscale Relay`: relay URL derived from the Tailscale host.
- `Local LAN Relay`: relay URL derived from the Mac's local address.
- `Use Tailscale Relay`: switches the bridge to the Tailscale relay URL.
- `Use Local Relay`: switches back to the local LAN relay URL.
- `Save Tailscale Address`: saves a manually entered Tailscale host.
- `Auto Detect`: clears the manual host and uses detected local data.
- `Save Relay Override`: saves a custom relay URL.
- `Use Defaults`: clears the relay override.

### Pairing

- QR/code details appear when the bridge publishes a pairing session.
- `Renew Pairing` asks the daemon for a fresh QR/code.
- `Reset Pairing` clears saved pairing state and starts a fresh trust flow.

Do not share live QR codes or pairing codes publicly.

### Trusted Devices

Trusted devices are browsers that completed the first pairing handshake for the current web origin.

- `Disable` keeps the device in history but prevents trusted reconnect.
- `Enable` allows a disabled device to reconnect again.
- `Remove` revokes that trusted device.

### Logs

The menu bar control can open the local Domaeng state/log folder and the stdout/stderr logs used by the background service.

Avoid posting raw logs publicly if they include live pairing details, private hostnames, or local paths you do not want to disclose.
