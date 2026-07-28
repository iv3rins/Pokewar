# ADR 0011: Ephemeral In-Game Chat

- Status: Accepted
- Date: 2026-07-28

## Decision

Add text chat only to started human rooms. PVE rooms do not expose chat. Messages are private to current room members, stored in Redis as the latest 50 messages, and are not written to PostgreSQL or replays. Chat keys follow room lifetime: active rooms 24 hours, finished rooms 10 minutes, and are deleted with the room.

Messages are normalized plain text: trim, collapse whitespace, remove line breaks/control characters, maximum 200 Unicode code points. Each identity may send at most one message every two seconds. The first release has no sensitive-word filter, links remain plain text, and no moderation/reporting UI is provided.

The web client renders a collapsible right-side drawer, keyboard-accessible input/send controls, aria-live message updates, unread count without sound, and a persistent per-sender local mute list. Muted senders' messages are not rendered and do not increment unread count. Public display name and avatar are shown; login names are never sent.

## Consequences

Redis is the source of ephemeral chat history and broadcast remains Socket.IO. Reconnect fetches the latest room chat history. Chat is presentation state and does not affect authoritative game versions or domain rules. Rate limits and payload validation remain server-owned.
