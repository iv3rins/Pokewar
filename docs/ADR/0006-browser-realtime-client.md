# ADR 0006: Browser Realtime Client

- Status: Accepted
- Date: 2026-07-27

## Context

The browser must participate in the existing Socket.IO room protocol, including acknowledgements, reconnects, control-loss events, and viewer-specific snapshots. Reimplementing the Engine.IO and Socket.IO framing over WebSocket would create an incompatible transport and unnecessary reliability risk.

The web package may depend on the protocol package but must not import the domain or server packages.

## Decision

Use `socket.io-client` in `apps/web` as the browser transport. Keep all wire schemas and inferred snapshot types in `packages/protocol`. The browser validates incoming room snapshots before rendering and sends only intent payloads. It never runs authoritative game rules.

Create the socket only after a signed guest HTTP session exists. Use cookie credentials, WebSocket transport, automatic reconnect, acknowledgement timeouts, and explicit UI states for disconnected and read-only duplicate tabs.

## Consequences

- Browser reconnect behavior remains compatible with the server transport.
- Runtime dependency versions must remain compatible with the server Socket.IO major version.
- Protocol changes require schema tests and coordinated server/web updates.
- Authoritative state and hidden information remain server-owned.
