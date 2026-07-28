# ADR 0010: PVE Bot Opponents

- Status: Accepted
- Date: 2026-07-27

## Context

New players need a way to learn the game without waiting for human opponents. A PVE mode using deterministic bot opponents provides instant practice without affecting ladder ratings.

## Decision

Add a PVE entry in the right-side panel alongside private rooms. Players select a mode and target size (4, 8, or 12 players). The server creates a hidden matchmade-style room and fills all remaining slots with bot players instantly.

Bot players have `kind: 'bot'` identities with vocabulary display names suffixed with `[机器人]`. They are never counted as participants for Glicko-2 rating purposes. PVE matches are marked in the replay store and excluded from ladder queries.

Bot AI runs as deterministic server-side strategy functions outside the domain package. Strategies receive the bot player's projected game state and return a legal GameCommand. The beginner strategy is the only difficulty in the first release: it plays the lowest-value legal single card each turn, always declines Joker rescue offers, selects the first available starter and replacement, and never uses double-Joker execution.

Bot turns are submitted through the same `RoomService.command` path as human players, ensuring idempotency and version tracking. The deadline worker triggers bot turns when a bot's turn deadline expires, with zero reconnect delay since bots are always considered connected.

The first PVE match triggers a dismissible in-game step guide covering: starter selection, hand cards, playing cards, suit effects, and Joker rescue. Progress is persisted in localStorage; the guide can be reopened from rules.

PVE rooms are not shown to other players and do not appear in public room listings.

## Consequences

- Bot identities require a new `kind: 'bot'` discriminant alongside `guest` and `account`.
- Rating and replay repositories must filter PVE matches from ladder queries.
- Bot strategy must be tested with deterministic fixtures against known game states.
- The tutorial overlay must not block game commands during active turns.
