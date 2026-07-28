# ADR 0007: Guest And Account Identities

- Status: Accepted
- Date: 2026-07-27
- Supersedes: the guest-only identity scope in ADR 0001

## Context

PokeWar must remain immediately usable without registration while allowing players to create durable ranked accounts. Public names cannot accept arbitrary user text. Existing signed guest identities already own room membership and replay authorization, so registration must not replace that identity.

## Decision

Every first visit automatically creates a 30-day rolling guest identity. The server chooses an immutable public display name from 100 reviewed prefixes and 100 reviewed nouns, then appends a four-character system tag. Guests never submit or edit names.

Accounts use a private normalized login name containing 4-24 lowercase ASCII letters, digits, or underscores and a password of 8-72 characters containing at least one letter and one digit. Login names are never public. Passwords use Node `scrypt` with a unique random salt and timing-safe verification.

Registration upgrades the current guest identity in place. The player may keep the generated combination or choose one prefix and one noun from the reviewed vocabulary exactly once during registration. Room membership, replay authorization, and match history remain attached to the same identity ID.

Account sessions use random opaque tokens, store only token hashes server-side, roll for 30 days, support multiple devices, and can be revoked. No email or password recovery is provided in the first account release. Login failures are limited per IP and normalized login name to five attempts per 15 minutes using Redis in production and an in-memory adapter in development.

## Consequences

- Public text is bounded by a reviewed local vocabulary.
- Login credentials and public identity are separate concepts.
- Account persistence and sessions require PostgreSQL migrations and repositories.
- Losing a password is unrecoverable in the first release and must be stated before registration.
- Registration, login, session rotation, and guest upgrade require authorization and concurrency tests.
