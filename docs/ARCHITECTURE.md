# Architecture

## Goals

PokeWar uses a TypeScript pnpm monorepo based on the separation demonstrated by `shnlfriberg/csgofriberg`, with an additional pure domain package and a shared protocol package. The split keeps multiplayer authority on the server while making the rules independently testable.

## Planned Tree

```text
pokewar-final/
├── AGENTS.md
├── RULES.md                     # pointer to normative rules
├── design.md
├── references/
│   └── RULES.md                 # read-only normative rules
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEVELOPMENT.md
│   ├── OPEN_QUESTIONS.md
│   └── ADR/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/             # bootstrap, providers, routes
│   │       ├── api/             # HTTP and Socket.IO adapters
│   │       ├── assets/          # app-specific local assets
│   │       ├── components/      # reusable accessible UI
│   │       ├── features/        # lobby, room, starter, game, results
│   │       ├── scenes/          # full-screen visual compositions
│   │       ├── state/           # client projection/presentation state
│   │       ├── styles/          # tokens, themes, responsive rules
│   │       └── test/
│   └── server/
│       └── src/
│           ├── config/
│           ├── db/              # PostgreSQL migrations/repositories
│           ├── http/            # health and guest-session routes
│           ├── identity/
│           ├── realtime/        # Socket.IO gateway and handlers
│           ├── rooms/           # orchestration, locks, projections
│           ├── scheduler/       # persisted deadline recovery
│           ├── storage/         # Redis room and idempotency adapters
│           └── test/
├── packages/
│   ├── domain/
│   │   └── src/
│   │       ├── cards/           # deck, combination, A fusion
│   │       ├── characters/
│   │       ├── commands/
│   │       ├── engine/          # reducer and phase transitions
│   │       ├── events/
│   │       ├── model/
│   │       └── testing/
│   └── protocol/
│       └── src/
│           ├── commands/
│           ├── events/
│           ├── projections/
│           └── errors.ts
├── tests/e2e/
├── assets/                       # shared source textures/audio
├── infra/                        # Docker and deployment manifests
└── scripts/
```

Directories are populated only when owned behavior exists; placeholder folders do not justify speculative abstractions.

## Runtime Topology

```text
Browser
  | HTTPS: guest session, health, room bootstrap
  | WebSocket: commands, snapshots, patches, notices
  v
Node server instances
  |-- domain engine (pure in-process package)
  |-- Redis: active rooms, identity index, locks, action results, deadlines
  |-- PostgreSQL: completed match summaries and operational records
  `-- Socket.IO Redis adapter: cross-instance fan-out
```

Production serves the built web app and API from one origin. Development runs Vite and the server separately with an explicit origin allowlist.

## Authoritative Command Flow

1. Web sends a typed command containing `roomId`, `actionId`, expected room `version`, command kind, and payload.
2. Protocol schema rejects malformed input at the gateway.
3. Server authenticates identity and acquires a per-room distributed lock.
4. Server loads canonical room state and checks idempotency and expected version.
5. Domain engine validates phase, actor, deadline, cards, target, and rule invariants.
6. Domain returns a new state plus explicit domain events, or a stable error code.
7. Server atomically stores the new state and cached action result.
8. Server projects viewer-specific snapshots/patches and emits them.
9. Asynchronous persistence records completed match data in PostgreSQL.

## State Model

Top-level phases are planned as:

```text
LOBBY
  -> SELECTING_STARTER
  -> PLAYING
  -> WAITING_FOR_JOKER (ordered one-pass rescue offers)
  -> SELECTING_REPLACEMENT (normal mode only)
  -> PLAYING
  -> GAME_OVER
```

A double-Joker execution goes directly from `PLAYING` to replacement selection or player elimination and cannot be rescued. Detailed transition semantics belong in the rules source and domain tests.

## Hidden Information

Canonical room state contains all hands, decks, and character rosters. It never crosses the network directly.

- Owner sees their full hand and all of their characters.
- Other players see current public character state and hand count.
- Reserve character rank, suit, and status remain hidden until played.
- Commands receive only the actor's legal context; logs must not serialize private state by default.
- Reconnect sends a fresh viewer projection, not cached output created for another identity.

## Cards And Decks

Each physical or fused hand entity has a stable unique ID. A fused A card persists in hand and records its two source cards, selected suit, summed value, and immunity-bypass flag. Source cards are already in the recyclable discard pile; the synthetic fused entity is never inserted into draw/discard piles.

The deck service is deterministic and injected with a shuffled card order. Recoverable discard cards can be reshuffled when a draw needs more cards. Jokers used for execution move to a permanently removed zone.

## Timers And Recovery

Server time is authoritative. State stores absolute deadlines for turn, character selection, rescue offer, and disconnect recovery. Local timers are wake-up optimizations only. Any instance can recover overdue work under the room lock and issue a system command.

## Scaling Baseline

The MVP should remain correct with multiple server instances even if initially deployed as one instance:

- Redis-backed room state and identity-room indexes.
- Per-room distributed lock for all mutations.
- Socket.IO Redis adapter for fan-out.
- Idempotent command results keyed by identity and action ID.
- Persisted deadlines and startup/periodic recovery.

PostgreSQL is not in the hot path for each card action.

## Current Implementation Status

The server and first usable browser lobby are operational:

- automatically generated immutable guest names from a reviewed 100-prefix and 100-noun vocabulary;
- signed 30-day guest identity cookies;
- PostgreSQL accounts with private login names, scrypt password hashes, two initial rating rows, and revocable 30-day multi-device sessions;
- guest-to-account identity upgrades that preserve identity IDs and authorization;
- Express health, guest-session, registration, login, logout, and replay endpoints;
- room create/join/ready/mode/kick/start workflows;
- a `RoomStore` interface with an in-memory development/test adapter;
- per-room in-process serialization through `RoomLock`;
- Socket.IO authoritative command validation and domain delegation;
- viewer-specific snapshots that redact deck, seed, command log, opponent hands, and reserve characters;
- latest-socket control ownership for duplicate guest connections;
- a Chinese-first three-column home with personal/rating information, a central animated POKEWAR matchmaking stage, private room controls, account modal, and rules drawer;
- create/join, mode, ready, kick, start, and reconnect flows;
- browser Socket.IO transport with acknowledgement timeout, protocol-validated snapshots, connection/read-only states, and no web-to-domain dependency.

Production infrastructure adapters are now available:

- Redis-backed guest identities with rolling 30-day TTL;
- reconnectable identity-to-room membership with 24-hour TTL and automatic private snapshot recovery;
- Redis room snapshots with 30-minute lobby, 24-hour active, and 10-minute finished TTLs;
- Redis per-room locks using `SET NX PX` and token-checked Lua release;
- Socket.IO Redis adapter using dedicated publisher/subscriber connections;
- PostgreSQL replay upserts, participant-only access, and hourly payload cleanup;
- Redis sorted-set deadline indexing atomically updated with room snapshots;
- Socket disconnect/reconnect commands that create and clear canonical 30-second recovery deadlines;
- startup and periodic deadline recovery for disconnect, Joker, starter, replacement, and turn timeouts;
- full replay payload and participant authorization data retained for exactly 14 days, while anonymized summaries remain.

Development still defaults to the in-memory adapters when `REDIS_URL` and `DATABASE_URL` are empty. Production startup requires both.

The current development machine does not provide Redis, PostgreSQL, or Docker executables. Adapter contracts, serialization, TTLs, lock acquisition/release, replay SQL, authorization, and cleanup behavior are covered by strict mock-backed tests, but a real-service integration suite must be run in CI or a provisioned environment before production deployment.
