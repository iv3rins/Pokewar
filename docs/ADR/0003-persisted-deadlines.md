# ADR 0003: Persisted Deadlines And Recovery

- Status: Accepted
- Date: 2026-07-27

## Context

Turn limits, 5-second ordered Joker offers, 15-second character selection, and 30-second disconnect recovery must remain correct across process restarts and multiple server instances. In-memory timers alone lose transitions and can fire twice.

## Decision

Store absolute deadlines and pending transition identity in canonical Redis room state. Derive a Redis sorted-set index from each canonical room snapshot. A Lua transaction atomically replaces the room snapshot, room TTL, and that room's deadline index members so a process failure cannot commit one without the other.

A worker scans every 250 milliseconds and once immediately on startup. It acquires the room lock and submits a deterministic idempotent system command whose action ID includes room, deadline kind, actor, absolute deadline, and expected game version. The domain revalidates phase, actor, version, and deadline. Stale entries are removed; infrastructure failures retain the entry for retry.

Equal-time tasks are ordered as disconnect, Joker offer, starter/replacement selection, then turn timeout. Successful automatic transitions replace the deadline index and broadcast fresh viewer-specific projections.

Client countdowns use server timestamps for display only and never decide expiry.

## Consequences

- Timeout behavior is recoverable and horizontally scalable.
- Domain commands must model timeout outcomes explicitly.
- Storage needs an efficient due-deadline index and stale-entry cleanup.
