# ADR 0009: Avatar And Gameplay Presentation

- Status: Accepted
- Date: 2026-07-27

## Context

The account profile, room, leaderboard, and gameplay table need consistent player identification and responsive interaction rules. Arbitrary uploaded images would introduce moderation and storage requirements outside the current scope.

## Decision

Use 32 reviewed local original court-emblem avatars, eight for each suit. Guests receive a cryptographically random immutable avatar. New accounts choose one avatar during guest upgrade and cannot change it in the first release. Existing-account enrollment remains unresolved until final asset IDs are supplied.

Desktop gameplay uses radial opponent seating with the local player's hand fixed at the bottom. Mobile gameplay fixes the current target near the top and exposes other opponents in a horizontally scrollable strip. Players click cards, click a target when required, then use an explicit confirmation button. Combat feedback uses restrained particles, numeric changes, short event ribbons, and text equivalents. It never moves the hand tray or blocks input. Reduced-motion mode removes orbiting, shaking, and nonessential movement.

## Consequences

- Avatar IDs, not image bytes or URLs, are persisted.
- Runtime assets remain local and reviewed.
- Guest and registration creation need avatar validation after assets are finalized.
- Gameplay component tests must cover card selection, target selection, confirmation, keyboard operation, and mobile opponent navigation.
- Final implementation waits for annotated desktop and mobile designs supplied by the product owner.
