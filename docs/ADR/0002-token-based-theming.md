# ADR 0002: Token-Based Theming

- Status: Accepted
- Date: 2026-07-27

## Context

The crafted-tabletop design requires light and dark presentation while preserving suit meaning, bitmap textures, Canvas output, and accessible contrast. Page-level inversion corrupts semantic colors and media.

## Decision

Themes override semantic CSS custom properties on the root element, such as `html[data-theme="dark"]`. Components consume only semantic tokens for shared surfaces and state colors. Page-level `filter: invert()` is prohibited.

Canvas rendering receives resolved theme tokens and redraws when theme changes. Gameplay always has an accessible DOM representation.

## Consequences

- Themes require deliberate token coverage.
- Assets may need light/dark variants or neutral treatment.
- Suit and status colors remain stable and testable.
