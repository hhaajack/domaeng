# macOS Menu Bar Companion

The macOS menu bar companion is the small Domaeng control center that lives in the macOS status/menu bar.

It is optional. You can use Domaeng entirely from the CLI and Web App.

Current packaging status: the public repo does not publish a signed `.app`, `.dmg`, or `.zip` release yet. The menu bar companion is source-build only for now.

## What It Does

The companion wraps the existing local `domaeng` CLI. It can:

- start and stop the macOS bridge service
- show daemon and bridge connection status
- show or renew pairing QR/code details
- switch between local and Tailscale relay paths
- manage trusted browser devices
- open stdout/stderr logs for debugging
- reopen the most recently active thread in `Codex.app`

It does not replace Codex, and it does not run a hosted service. The bridge and Codex runtime still run locally on your Mac.

## Requirements

- macOS
- the global `domaeng` CLI installed and visible to the app shell environment
- Xcode 16+ if you are building the companion from source

Install the CLI first:

```sh
npm install -g domaeng@latest
```

## Build And Run From Xcode

From the repo root:

```sh
cd CodexMobile
open CodexMobile.xcodeproj
```

Then:

1. Select the `DomaengMenuBar` scheme.
2. Build and run with Cmd+R.
3. Open the Domaeng icon from the macOS status/menu bar.
4. Use Start to start the local relay and bridge service.

The historical iOS client is not the active path in this source tree. The active companion source lives in `CodexMobile/DomaengMenuBar/`.

## Command-Line Source Build

From the repo root:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild -project CodexMobile/CodexMobile.xcodeproj \
  -scheme DomaengMenuBar \
  -configuration Debug \
  -destination 'platform=macOS' \
  -derivedDataPath .build/xcode-derived \
  CODE_SIGNING_ALLOWED=NO build
```

If you want the companion to serve the bundled Web App assets, build the web client first:

```sh
cd web
npm install
npm run build
```

For day-to-day user installs, prefer the npm CLI path until a signed app release exists.

## Popover Controls

The compact status/menu bar popover shows:

- `Service`: whether the launchd-backed bridge service is loaded.
- `Connection`: the bridge connection state.
- `Relay`: whether the current relay looks local or remote.
- `Start`: starts the local relay/bridge flow.
- `Stop`: stops the bridge service.
- `Refresh`: reloads status from the CLI.
- `Control Center`: opens the full window.
- `Quit App`: quits only the companion app, not necessarily the bridge service.

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

The companion can open the local Domaeng state/log folder and the stdout/stderr logs used by the background service.

Avoid posting raw logs publicly if they include live pairing details, private hostnames, or local paths you do not want to disclose.
