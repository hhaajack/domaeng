# Menu Bar Control

`DomaengMenuBar.app` is an optional native macOS control panel for people who do not want to keep using Terminal.

It is intentionally thin:

- it does not embed a WebView
- it does not bundle Web App assets
- it does not run a second Web App copy
- it reads status from `domaeng status --json`
- it controls the same launchd-backed bridge and local relay used by `domaeng up`

## Install And Open

Published npm packages can ship a prebuilt app. During packaging, `prepack` copies `macos/DomaengMenuBar/build/DomaengMenuBar.app` into `bundled/menubar/` when that build exists.

On a user machine, installation only copies that prebuilt app into the user's home directory:

```sh
domaeng menubar install
domaeng menubar open
```

`domaeng menubar install` also enables login startup by writing `~/Library/LaunchAgents/com.domaeng.menubar.plist`. It does not touch `/Applications`, does not ask for sudo, and does not try to build on the user's Mac. If the package was installed without a prebuilt app, the command reports that clearly.

Use this to change the startup preference:

```sh
domaeng menubar login on
domaeng menubar login off
```

## What It Shows

- bridge and relay status
- Web App URL served by the relay at `/app/`
- pairing code and QR
- Start, Stop, Restart, Renew Pairing, Open Web App, and copy actions

`domaeng up` starts the bridge and pairing flow as usual. If a prebuilt `DomaengMenuBar.app` is bundled and the user has not disabled open-at-login, `domaeng up` installs it to `~/Applications`, enables the login LaunchAgent, and opens it. If no prebuilt app is bundled, `domaeng up` continues normally with Terminal output only.

## Source Build

Maintainers can build a prebuilt app bundle from source:

```sh
./macos/DomaengMenuBar/scripts/build-app.sh
```

The output goes to `macos/DomaengMenuBar/build/DomaengMenuBar.app`. npm packaging copies that bundle when it exists. The app bundle must not contain `web/dist` or any other Web App copy.
