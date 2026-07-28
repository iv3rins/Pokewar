# ADR 0004: Private Viewer Projections

- Status: Accepted
- Date: 2026-07-27

## Context

Hands and reserve characters are private. Broadcasting canonical room objects and hiding fields in the UI would leak information through browser state and network inspection.

## Decision

Canonical state remains server-side. After every accepted transition, the server builds a projection for each identity class. Players receive their own full hand and roster plus public information about others. Reconnect always produces a fresh projection. Public events use card/action summaries that contain only intentionally revealed data.

Projection code is tested independently for every phase, especially starter selection, replacement, Joker rescue, and game over.

## Consequences

- Broadcasting has additional CPU/serialization cost, acceptable for at most 12 players per room.
- Protocol schemas distinguish private snapshots from canonical domain state.
- Logs and metrics must not serialize canonical state by default.
