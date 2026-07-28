# ADR 0008: Matchmaking And Ranked Rating

- Status: Accepted
- Date: 2026-07-27
- Supersedes: the deferred matchmaking scope in ADR 0001

## Context

The home screen requires public matchmaking and separate Normal and Quick ladders. Guests may match without registration, but resettable guest identities must not affect ranked ratings.

## Decision

Normal and Quick use separate two-player queues and separate ratings. Guests and accounts may share a queue. A match is ranked only when both participants are registered accounts; every match containing a guest is unranked.

Account ratings use Glicko-2 with initial rating 1500, rating deviation 350, volatility 0.06, tau 0.5, and immediate per-match updates. The first five completed ranked matches display as provisional and are excluded from the Top 10 leaderboard.

Rating tiers are:

- Bronze: below 1200;
- Silver: 1200-1399;
- Gold: 1400-1599;
- Platinum: 1600-1799;
- Diamond: 1800-1999;
- Champion: 2000 and above.

Candidate opponents begin within 100 rating points. The range grows by 50 every 10 seconds to a maximum of 500. Guests use an implicit matching rating of 1500 only for queue selection.

A candidate match opens a 15-second acceptance window. Both players must accept before the authoritative room starts. A player may cancel or reject without penalty. If one accepts and the other declines or times out, the accepting player returns to the queue with the original enqueue time.

Redis owns queue order, acceptance deadlines, and atomic pairing. PostgreSQL owns durable account ratings and completed ranked results. The home leaderboard shows the selected mode's Top 10 plus the current account's own position.

## Consequences

- Private rooms remain 2-12 players and never affect rating unless a future decision says otherwise.
- Queue recovery and acceptance deadlines require persisted workers and idempotent room creation.
- Glicko-2 calculations require deterministic tests against published reference vectors.
- Leaderboards require completed provisional placement and stable tie ordering.
