# ADR 0005: Seeded Command Replay

- Status: Accepted
- Date: 2026-07-27

## Context

PokeWar uses random character suits, seats, first player, deck order, reshuffles, timeout discards, and automatic character choices. Multiplayer disputes and rule regressions require exact reproduction without persisting a full state snapshot after every transition.

## Decision

At match creation, the server uses cryptographically secure randomness to create a private seed. The pure domain package expands that seed through a deterministic PRNG and stores an explicit random cursor in canonical game state. All game randomness must consume this state; direct calls to `Math.random()` or runtime crypto APIs are prohibited inside `packages/domain`.

Replay storage contains the initial match configuration, private seed, and every accepted player or system command in authoritative order. Re-executing them with the same domain version must produce the same terminal state and domain events. One accepted command is one atomic transition and increments room version exactly once, regardless of how many domain events it emits.

Full replay data, including seed and hidden information, is visible only to participants after match completion and is retained for 14 days. Long-term summaries are anonymized.

## Consequences

- Tests can reproduce every random outcome exactly.
- Random state is part of serialization and migration compatibility.
- Replays require domain version metadata and future compatibility handling.
- Security-sensitive seed generation remains an infrastructure responsibility; deterministic expansion remains a domain responsibility.
