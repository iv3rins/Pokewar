import { describe, expect, it } from 'vitest';
import { createFusedCard } from './fusion.js';
import type { HandEntity } from '../model/cards.js';

const ace: HandEntity = { kind: 'physical', id: 'ace-heart', suit: 'heart', rank: 'A' };
const five: HandEntity = { kind: 'physical', id: 'five-spade', suit: 'spade', rank: 5 };

describe('createFusedCard', () => {
  it.each(['heart', 'spade'] as const)('creates value 6 with source suit %s', (selectedSuit) => {
    expect(createFusedCard([ace, five], selectedSuit, 'fusion-1')).toEqual({
      ok: true,
      card: {
        kind: 'fused',
        id: 'fusion-1',
        sourceCardIds: ['ace-heart', 'five-spade'],
        suit: selectedSuit,
        value: 6,
        bypassSuitImmunity: true,
      },
    });
  });

  it('rejects two aces', () => {
    const otherAce: HandEntity = { kind: 'physical', id: 'ace-club', suit: 'club', rank: 'A' };
    expect(createFusedCard([ace, otherAce], 'club', 'fusion-1')).toEqual({
      ok: false,
      code: 'FUSION_REQUIRES_ONE_ACE',
    });
  });

  it('rejects a selected suit not present on either source', () => {
    expect(createFusedCard([ace, five], 'diamond', 'fusion-1')).toEqual({
      ok: false,
      code: 'INVALID_FUSION_SUIT',
    });
  });
});
