# DomaengMenuBar

Thin macOS menu bar control panel for Domaeng.

This app does not embed a WebView, does not bundle Web App assets, and does not run its own relay. It reads status from the installed `domaeng` CLI and controls the same launchd-backed bridge/local relay path used by `domaeng up`.

Build a prebuilt app bundle for packaging:

```sh
./macos/DomaengMenuBar/scripts/build-app.sh
```

The bundle is written to `macos/DomaengMenuBar/build/DomaengMenuBar.app`. npm packaging copies that bundle when it exists.

At runtime the app polls `domaeng status --json` and `domaeng menubar status --json`. It shows the installed Domaeng CLI version, and its Update button calls `domaeng update --json`. The Open at Login toggle calls `domaeng menubar login on|off`, which is backed by the user's `~/Library/LaunchAgents/com.domaeng.menubar.plist`.
