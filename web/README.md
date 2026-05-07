# Remodex Web

React + Vite PWA client for controlling a paired Remodex bridge through the self-hosted relay.

```sh
npm install
npm run build
```

The production build is emitted to `web/dist` and is served by the relay at `/app/`.

Key implementation points:

- Browser WebSocket connections use `/relay/{sessionId}?role=iphone`.
- Pairing, trusted reconnect, and JSON-RPC application traffic remain end-to-end encrypted.
- Trusted Mac identity, phone identity, replay cursor, and runtime settings are origin-scoped in IndexedDB.
