# Domaeng CLI

`domaeng` is the local bridge package for Domaeng. It runs on the machine where Codex is installed, prints a first-pairing QR/code, and relays encrypted traffic between Codex and a paired Domaeng Web client.

Domaeng is local-first: the Codex runtime, credentials, repo access, and bridge state stay on your machine. The relay can be run locally, on a private network, or on infrastructure you control.

## Install

```sh
npm install -g domaeng@latest
```

Then start the bridge:

```sh
domaeng up
```

On macOS, `domaeng up` installs or restarts the launchd-backed background bridge service, then waits for and prints a pairing QR/code. On other operating systems, run the bridge in the foreground or wrap it with your own service manager.

## Pairing

Open Domaeng Web from the relay-served `/app/` route, then scan the QR or enter the short pairing code printed by `domaeng up`.

After the first secure handshake:

- the browser stores the trusted Mac for that web origin
- the bridge keeps its device identity locally
- trusted reconnect can resolve the current live bridge session through the configured relay
- QR/code pairing remains available as a recovery path

## Self-hosted Relay

Point the bridge at your relay explicitly:

```sh
DOMAENG_RELAY="ws://localhost:9000/relay" domaeng up
```

For another device on your network, use a relay URL that device can reach, such as a LAN hostname, a Tailscale hostname, or a reverse-proxied `wss://` endpoint:

```sh
DOMAENG_RELAY="wss://api.example.com/domaeng/relay" domaeng up
```

If you enable push notifications on your own relay, also set:

```sh
DOMAENG_PUSH_SERVICE_URL="https://api.example.com/domaeng/v1/push" domaeng up
```

Managed push remains off unless you configure it explicitly.

## Commands

- `domaeng up` starts the bridge or macOS bridge service and prints pairing details.
- `domaeng status` shows current daemon and bridge status.
- `domaeng status --json` prints machine-readable status for companion apps.
- `domaeng renew-pairing` asks the macOS daemon for a fresh pairing QR/code.
- `domaeng trusted-device disable` disables trusted reconnect without deleting pairing history.
- `domaeng restart` restarts the macOS bridge service.
- `domaeng-jsonl-diagnose` inspects Codex JSONL session files for debugging.

## State and Compatibility

Domaeng is based on Remodex, originally created by Emanuele Di Pietro. This package keeps the Apache-2.0 license and NOTICE attribution while using the Domaeng public package name and branding.

Some internal files and state paths intentionally keep legacy `remodex` or `phodex` names so this package can stay compatible with existing bridge state and upstream Remodex comparisons. For example, bridge state is stored under the legacy-compatible `~/.remodex/` directory.

Those internal names are not the public distribution name. The npm package, CLI command, app UI, web UI, and public docs use Domaeng.

## Development

From the package directory:

```sh
npm ci
npm test
npm pack --dry-run
```

The package tarball should contain only `bin/`, `src/`, `README.md`, `LICENSE`, `NOTICE`, and `package.json`. It should not contain generated build output, test fixtures, local relay sessions, pairing secrets, or private packaged defaults.
