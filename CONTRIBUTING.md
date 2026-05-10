# Contributing to Domaeng

I am not actively accepting contributions right now.

This project is very early. Things change fast, priorities shift, and I'm still figuring out the right direction. If you open a PR or issue, there's a good chance I close it, defer it, or never get to it. That's not personal — I just need to stay focused.

## If you still want to contribute

Read this whole file first.

### What I'm most likely to accept

- Small, focused bug fixes
- Small reliability or performance improvements
- Typo and documentation fixes

### What I'm least likely to accept

- Large PRs
- Drive-by feature work
- Opinionated rewrites or refactors
- Scope expansion I didn't ask for

### Before opening a PR

- **Open an issue first** for anything non-trivial. Describe the problem, not your solution.
- Keep changes minimal. One fix per PR.
- Explain exactly what changed and exactly why.
- If it touches UI, include a screenshot or video.

Opening a PR does not create an obligation on my side. I may close it. I may ignore it. I may take the idea and implement it differently. That's how early-stage projects work.

---

## Local Development Setup

### Prerequisites

- **Node.js** v18+
- **[Codex CLI](https://github.com/openai/codex)** installed and working
- **[Codex desktop app](https://openai.com/index/codex/)** (optional — for viewing threads on Mac)
- **macOS** (required for desktop refresh; core bridge works on any OS)
- **Xcode 16+** only if you choose to work on the macOS menu bar companion

### Bridge setup

```sh
# Clone the repo
git clone https://github.com/your-org/domaeng.git
cd domaeng

# Start a local relay + bridge together
./run-local-domaeng.sh
```

This launcher:
1. Spawns a Codex `app-server` process
2. Starts a local relay on `/relay/{sessionId}`
3. Points the bridge at that relay
4. Prints a QR code in your terminal for the initial trust bootstrap

For a temporary public tunnel to that local relay, start the tunnel in one terminal:

```sh
cloudflared tunnel --url http://127.0.0.1:9000
```

Then pass the generated URL to the launcher in another terminal:

```sh
./run-local-domaeng.sh --relay-url https://<random>.trycloudflare.com
```

If you only want the bridge process:

```sh
cd phodex-bridge
npm install
DOMAENG_RELAY="ws://localhost:9000/relay" npm start
```

That runs `domaeng up`, which:
1. Spawns a Codex `app-server` process
2. Connects to the configured relay
3. On macOS, starts the built-in background bridge service
4. Prints a QR code in your terminal when first-time pairing or recovery is needed

Open the web app served by the relay, then scan the QR code or enter the pairing code to trust that Mac.

### macOS menu bar companion

```sh
cd CodexMobile
open CodexMobile.xcodeproj
```

1. Select the `DomaengMenuBar` scheme
2. Build and run (Cmd+R)

The historical iOS client is archived outside the active source tree. Keep menu bar changes scoped to `CodexMobile/DomaengMenuBar/` and its build support.

### Testing a full local session

1. Start the local launcher: `./run-local-domaeng.sh`
2. Open the relay-served web app and scan the QR code or enter the pairing code
3. Create a new thread from the web app
4. Send a message — you should see Codex respond in real-time
5. Try git operations from the web app (commit, push, branch switching)
6. Reopen the web app and verify that the trusted reconnect path is used instead of forcing a fresh QR immediately

### Environment variables

For OSS/local development, prefer the launcher above. If you want to point the bridge process at your own relay manually without the launcher, export `DOMAENG_RELAY` in your shell:

```sh
# Connect to an existing Codex instance instead of spawning one
DOMAENG_CODEX_ENDPOINT=ws://localhost:8080 npm start

# Use your own self-hosted relay endpoint (`ws://` is unencrypted)
DOMAENG_RELAY="ws://localhost:9000/relay" npm start

# Enable auto-refresh of Codex.app on Mac
DOMAENG_REFRESH_ENABLED=true npm start
```

### Project structure

```
domaeng/
├── phodex-bridge/          # Node.js CLI bridge (npm package)
│   ├── bin/remodex.js      # CLI entrypoint exposed as `domaeng`
│   └── src/
│       ├── bridge.js               # Core relay + message forwarding
│       ├── codex-transport.js      # Spawn vs WebSocket abstraction
│       ├── codex-desktop-refresher.js  # Debounced Codex.app refresh
│       ├── git-handler.js          # Git command execution from the paired client
│       ├── workspace-handler.js    # Workspace/cwd management
│       ├── session-state.js        # Thread persistence
│       ├── rollout-watch.js        # Thread event log tailing
│       └── qr.js                   # QR code generation
│
├── CodexMobile/            # macOS DomaengMenuBar Xcode project
│   ├── DomaengMenuBar/     # menu bar app source
│   ├── BuildSupport/       # menu bar build settings and Info.plist
│   └── CodexMobile/        # shared app assets retained for the menu bar target
```

### Code style

- **Bridge**: CommonJS, no transpilation, no TypeScript. Keep it simple.
- **Menu bar**: SwiftUI/AppKit, async/await, MainActor isolation. Keep source changes in `CodexMobile/DomaengMenuBar/` unless build support or assets are required.
- No linter or formatter is enforced — just match what's already there.

### Trust model

- The first QR pairing is possession-based: it contains the relay URL and a live session ID.
- After that first handshake, the web app stores a trusted Mac record and can ask the relay for the Mac's current live session again.
- Set `DOMAENG_RELAY` to a relay you control when you are not using the local launcher, or pass the relay URL to the launcher with `--relay-url`. Use `wss://` when you want TLS in transit.
- Domaeng uses an authenticated end-to-end encrypted transport after pairing completes. The relay code is public for inspection, but deployed relay details should stay in private config.
- The built-in daemon / background service path is currently macOS-only. Linux and Windows can still run the bridge, but contributors should treat the daemon logic as platform-specific.
