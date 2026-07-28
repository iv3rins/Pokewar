# PokeWar Agent Guide

This is the mandatory entry point for humans and coding agents working in this repository.

## Read Order

Before changing code, read these files in order:

1. `AGENTS.md`
2. `references/RULES.md` for normative game semantics
3. `design.md` for UI, motion, responsive, and accessibility constraints
4. `docs/ARCHITECTURE.md` for module ownership and data flow
5. `docs/DEVELOPMENT.md` for implementation and verification rules
6. Relevant files in `docs/ADR/`
7. `docs/OPEN_QUESTIONS.md`; unresolved items must not be guessed

If a nested directory later contains another `AGENTS.md`, its rules add to this file for that subtree.

## Source Of Truth

Conflicts are resolved in this order:

1. `references/RULES.md`
2. Accepted `docs/ADR/*.md`
3. Absolute prohibitions in `AGENTS.md`
4. `design.md`
5. `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT.md`
6. Tests
7. Existing code

Code and tests do not silently redefine the rules.

## Product Baseline

- Online tabletop game for 2-12 players.
- Modes: normal mode uses three characters; quick mode uses one character.
- Room-code flow; host chooses mode; all players must be ready.
- Automatic guest identity is the default. Durable accounts and two-player public matchmaking are in scope; spectators and chat remain deferred.
- The server is authoritative. The client sends intent and renders server projections.
- Active room state is stored in Redis; completed match summaries are stored in PostgreSQL.
- A disconnected player has 30 seconds to recover before elimination.

## Repository Boundaries

- `apps/web`: React UI, input, animation, accessibility, and local presentation state.
- `apps/server`: HTTP/Socket.IO transport, identity, rooms, timers, persistence, and projections.
- `packages/domain`: deterministic game rules and state transitions. No DOM, React, networking, database, Redis, timers, randomness APIs, audio, or Three.js imports.
- `packages/protocol`: Zod schemas and inferred wire types shared by web and server. No game-rule execution.
- `references`: normative product sources. Do not edit during ordinary feature work.
- `docs/ADR`: accepted architectural decisions. Never rewrite an accepted ADR to hide a changed decision; supersede it.

Dependency direction is one-way:

```text
apps/web ------> packages/protocol
apps/server ---> packages/protocol + packages/domain
packages/domain -> no workspace package
packages/protocol -> no workspace package
```

The web app must never import server internals or decide whether an action succeeds.

## Non-Negotiable Engineering Rules

- Represent every game mutation as a validated command processed by the domain reducer/state machine.
- Inject time, IDs, shuffled decks, and random choices. Domain tests must be deterministic.
- Commands carry an `actionId`; server handling must be idempotent to survive retries and reconnects.
- Every room state has a monotonic `version`. Client patches include base and next versions; mismatch triggers a full snapshot request.
- Private state is projected per viewer. Never broadcast the canonical room state or another player's hand/reserve characters.
- Persist deadlines, not process-local timer truth. On restart, overdue transitions are recovered from stored state.
- Validate every HTTP body, Socket.IO payload, environment variable, and persistence boundary with a schema.
- Use stable error codes over the wire. User-facing text belongs in the web app.
- Do not use floating point arithmetic for HP, damage, shield, card values, or deadlines.
- Do not add a rule because it seems conventional. Add it to `docs/OPEN_QUESTIONS.md` and obtain a decision.
- Do not modify `references/RULES.md` without explicit approval.

## Frontend Rules

- Follow `design.md`; the first screen is the usable lobby, not a marketing page.
- Keep gameplay state in accessible DOM. Canvas is an optional particle layer and never the only representation.
- Use local assets only at runtime. Do not add CDN fonts, scripts, or textures.
- Support 360px through 1920px without overlap. Controls are at least 44x44px.
- Support keyboard control, focus restoration, `prefers-reduced-motion`, and text equivalents for combat feedback.
- Use CSS token overrides for themes. Never use page-level `filter: invert()`.
- Avoid nested cards, decorative gradients, bokeh, and animations that move the hand tray or lock input.

## Testing Gate

For each behavior change:

1. Add or update domain unit tests for legal and illegal transitions.
2. Add protocol schema tests when wire payloads change.
3. Add server integration tests for authorization, private projections, idempotency, reconnect, and timers where relevant.
4. Add web component tests for interaction and accessibility.
5. Add Playwright coverage for a critical user journey when the workflow changes.
6. Run formatting, lint, typecheck, tests, and build before declaring completion.

Rules involving deck exhaustion, elimination, Joker windows, disconnects, hidden information, or concurrent commands require explicit edge-case tests.

## Change Discipline

- Keep changes scoped; do not refactor unrelated modules.
- Update documentation in the same change when contracts, commands, events, storage, or operational behavior change.
- Add an ADR before introducing a new runtime dependency, persistence strategy, cross-package dependency, or authoritative-state model.
- Never commit secrets, generated database data, build output, or copied brand assets.
