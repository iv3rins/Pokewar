# Development Standard

## Toolchain Baseline

Planned stack:

- Node.js 22+
- pnpm workspace
- TypeScript in strict mode
- React + Vite for `apps/web`
- Express + Socket.IO for `apps/server`
- Zod for runtime contracts
- Vitest and Testing Library
- Playwright for critical end-to-end journeys
- Redis for active multiplayer state
- PostgreSQL for completed results and 14-day participant replays

Local development uses in-memory identity, room-membership, room, lock, and deadline-index adapters when `REDIS_URL` and `DATABASE_URL` are unset. Production requires both external services. Initialize the replay schema with `pnpm --filter @pokewar/server migrate` before production startup.

Exact dependency versions are selected when workspace manifests are generated and then pinned by the lockfile.

## Domain Design

The domain package exposes commands, state, errors, and transitions. It does not expose mutating class instances or infrastructure concepts.

Use this shape conceptually:

```ts
type Transition =
  { ok: true; state: GameState; events: DomainEvent[] } | { ok: false; code: DomainErrorCode };

function decide(state: GameState, command: GameCommand, context: CommandContext): Transition;
```

`CommandContext` supplies authoritative `now`, deterministic IDs, and random selections. Domain functions must not call `Date.now()`, `Math.random()`, databases, or network APIs.

State invariants are checked at construction and after transitions in tests. Important invariants include unique card location, hand limit, one active character per live player, valid turn holder, monotonic version, and private information never entering public events.

## Protocol Design

- Define Zod schemas first and infer TypeScript types from them.
- Commands use intent names such as `game:play-cards`, not UI names such as `button:clicked`.
- Every acknowledgement is a discriminated union with either new version/result or a stable error code.
- Protocol changes that break old clients require a compatibility plan or explicit version bump.
- Do not duplicate protocol interfaces independently in web and server.

## Server Design

- Gateway code parses, authenticates, rate-limits, and delegates; it does not implement game rules.
- Room orchestration owns locking, persistence, idempotency, projections, and broadcasting.
- Store adapters hide Redis key construction and serialization.
- PostgreSQL repositories are separate from active-room storage.
- Errors returned to clients contain codes and safe metadata, never stack traces.
- Production startup validates secrets, allowed origins, PostgreSQL, and required Redis.
- Graceful shutdown stops accepting commands, drains sockets, closes workers, then closes storage clients.

## Web Design

- Feature folders own screens and workflows; generic components remain rule-agnostic.
- The client stores only its current server projection plus presentation state such as selected cards and open drawers.
- A command pending state must prevent accidental duplicate input but retain the same `actionId` for retries.
- Reconnection requests a fresh snapshot and reconciles by room version.
- Animation responds to domain event data and never delays authoritative state application.
- Use Lucide icons for familiar controls and tooltips for unfamiliar icon-only actions.

## Security And Privacy

- Guest identity uses an HttpOnly, Secure-in-production, SameSite cookie with a signed opaque identifier and a server-generated reviewed-vocabulary name.
- Account passwords use salted scrypt hashes. Account cookies contain random opaque tokens; PostgreSQL stores only token hashes.
- Enforce origin checks for mutating HTTP and Socket.IO handshakes.
- Rate-limit guest-session creation, room create/join, and gameplay commands.
- Validate membership and current actor on every command; never trust client player IDs.
- Redact hands, reserve characters, tokens, cookies, and secrets from logs.
- Cap payload sizes and text fields even when a feature appears internal.

## Testing Strategy

### Domain

Use table-driven tests for:

- legal and illegal 1/3/5-card plays;
- persistent A fusion and suit selection;
- suit immunity and immunity bypass;
- spade damage, heart healing, diamond distribution, club shield;
- club-character shield penetration;
- hand cap and deck/discard exhaustion;
- timeout penalties and death transitions;
- single-Joker ordered rescue and double-Joker execution;
- normal/quick elimination and winner selection.

Add property-based testing later for card conservation and invariant preservation if it proves useful; do not block the initial implementation on it.

### Server

Test malformed payloads, wrong actor, stale version, duplicate action ID, concurrent commands, reconnect within/after 30 seconds, deadline recovery, and viewer-specific redaction.

### Web

Test keyboard card selection, legal-combination feedback, focus-trapped modals, reconnect UI, reduced motion, and non-overlap at target viewport sizes. Critical multiplayer flows use two or more Playwright browser contexts.

## Completion Gate

A phase is complete only when relevant commands pass:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e   # when the phase includes an integrated browser flow
```

If a command cannot run because infrastructure is unavailable, document exactly what was not verified.

## Documentation Discipline

- New rule: explicit approval, update `references/RULES.md`, tests, and possibly an ADR.
- New architectural choice: add an ADR.
- New command/event/error: update protocol documentation or generated contract reference.
- New environment variable: update `.env.example` and deployment docs.
- New unresolved ambiguity: add it to `docs/OPEN_QUESTIONS.md`; do not encode an assumption.
