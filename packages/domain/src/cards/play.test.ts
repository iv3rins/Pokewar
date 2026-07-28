import { describe, expect, it } from 'vitest';
import { validateOrdinaryPlay } from './play.js';
import type { FusedCard, HandEntity, PhysicalCard } from '../model/cards.js';

const card = (
  id: string,
  suit: PhysicalCard['suit'],
  rank: PhysicalCard['rank'],
): PhysicalCard => ({
  kind: 'physical',
  id,
  suit,
  rank,
});

const fused: FusedCard = {
  kind: 'fused',
  id: 'fused-6',
  sourceCardIds: ['ace-heart', 'five-spade'],
  suit: 'spade',
  value: 6,
  bypassSuitImmunity: true,
};

describe('validateOrdinaryPlay', () => {
  it.each([1, 3, 5] as const)('accepts exactly %i same-suit entities', (count) => {
    const entities = Array.from({ length: count }, (_, index) =>
      card(`c${String(index)}`, 'heart', 2),
    );
    const result = validateOrdinaryPlay(entities);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.play.value).toBe(count * 2);
  });

  it.each([0, 2, 4, 6])('rejects %i entities', (count) => {
    const entities = Array.from({ length: count }, (_, index) =>
      card(`c${String(index)}`, 'heart', 2),
    );
    expect(validateOrdinaryPlay(entities)).toEqual({ ok: false, code: 'INVALID_CARD_COUNT' });
  });

  it('allows a fused entity in a three-entity same-suit play', () => {
    const result = validateOrdinaryPlay([fused, card('s2', 'spade', 2), card('s3', 'spade', 3)]);
    expect(result).toMatchObject({
      ok: true,
      play: { value: 11, entityCount: 3, bypassSuitImmunity: true },
    });
  });

  it('rejects mixed suits and Jokers', () => {
    expect(validateOrdinaryPlay([card('s2', 'spade', 2), card('h2', 'heart', 2), fused])).toEqual({
      ok: false,
      code: 'MIXED_SUITS',
    });
    const joker: HandEntity = { kind: 'joker', id: 'joker-1' };
    expect(validateOrdinaryPlay([joker])).toEqual({ ok: false, code: 'JOKER_NOT_ALLOWED' });
  });

  it('classifies clubs as defense', () => {
    expect(validateOrdinaryPlay([card('club-10', 'club', 10)])).toMatchObject({
      ok: true,
      play: { kind: 'defense', value: 10 },
    });
  });
});
