# ADR 0001: Authoritative Domain And Monorepo

- Status: Accepted
- Date: 2026-07-27

## Context

PokeWar is a hidden-information, timer-driven multiplayer card game. The reference architecture separates a React client and Node server in a pnpm workspace, uses Socket.IO for rooms, Redis for realtime coordination, and PostgreSQL for durable data. PokeWar additionally needs rule logic that can be validated without transport or storage.

## Decision

Use a TypeScript pnpm monorepo with:

- `apps/web`: React and Vite;
- `apps/server`: Express and Socket.IO;
- `packages/domain`: pure deterministic game state machine;
- `packages/protocol`: Zod wire contracts;
- Redis for active room state, locks, idempotency, deadlines, and cross-instance fan-out;
- PostgreSQL for completed match summaries.

The server is authoritative. Clients submit intent and receive viewer-specific projections. Domain transitions are deterministic through injected time, IDs, shuffled input, and random choices.

## Consequences

- Rules can be tested exhaustively without starting infrastructure.
- Hidden information has a dedicated projection boundary.
- Realtime mutations require lock and idempotency handling.
- Shared domain/protocol packages add workspace setup but avoid divergent client/server contracts.
- PostgreSQL is kept out of the per-action hot path.
