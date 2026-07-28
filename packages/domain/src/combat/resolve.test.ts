import { describe, expect, it } from 'vitest';
import { validateOrdinaryPlay, type ValidatedPlay } from '../cards/play.js';
import type { PhysicalCard } from '../model/cards.js';
import type { CharacterState } from '../model/characters.js';
import { resolvePlay } from './resolve.js';

const character = (overrides: Partial<CharacterState> = {}): CharacterState => ({
  id: 'character',
  rank: 'Q',
  suit: 'diamond',
  hp: 40,
  shield: 0,
  eliminated: false,
  ...overrides,
});

const play = (suit: PhysicalCard['suit'], rank: PhysicalCard['rank']): ValidatedPlay => {
  const result = validateOrdinaryPlay([{ kind: 'physical', id: 'card', suit, rank }]);
  if (!result.ok) throw new Error(result.code);
  return result.play;
};

describe('resolvePlay', () => {
  it('doubles spade damage before shield', () => {
    const result = resolvePlay(play('spade', 10), character(), character({ shield: 6, hp: 40 }));
    expect(result).toMatchObject({ resolvedDamage: 20, shieldLost: 6, hpLost: 14, targetHp: 26 });
  });

  it('same-suit immunity removes spade multiplier but not base damage', () => {
    const result = resolvePlay(play('spade', 10), character(), character({ suit: 'spade' }));
    expect(result).toMatchObject({
      immuneToSuitEffect: true,
      resolvedDamage: 10,
      hpLost: 10,
    });
  });

  it.each([1, 3, 5] as const)(
    'a fused card makes the complete %i-entity play bypass same-suit immunity',
    (entityCount) => {
      const fused = {
        kind: 'fused' as const,
        id: 'fusion',
        sourceCardIds: ['a', 'five'] as const,
        suit: 'spade' as const,
        value: 6,
        bypassSuitImmunity: true as const,
      };
      const companions = Array.from({ length: entityCount - 1 }, (_, index) => ({
        kind: 'physical' as const,
        id: `spade-${String(index)}`,
        suit: 'spade' as const,
        rank: 2 as const,
      }));
      const validation = validateOrdinaryPlay([fused, ...companions]);
      if (!validation.ok) throw new Error(validation.code);

      expect(resolvePlay(validation.play, character(), character({ suit: 'spade' }))).toMatchObject(
        {
          immuneToSuitEffect: false,
          resolvedDamage: (6 + companions.length * 2) * 2,
        },
      );
    },
  );

  it('a club character bypasses shield without consuming it', () => {
    const result = resolvePlay(
      play('heart', 10),
      character({ rank: 'J', suit: 'club', hp: 20 }),
      character({ shield: 30, hp: 40 }),
    );
    expect(result).toMatchObject({ shieldLost: 0, hpLost: 10, targetShield: 30, healing: 10 });
  });

  it('heart healing uses actual HP loss and respects maximum HP', () => {
    const result = resolvePlay(
      play('heart', 10),
      character({ rank: 'J', hp: 27 }),
      character({ hp: 2 }),
    );
    expect(result).toMatchObject({ hpLost: 2, healing: 2, attackerHp: 29 });
  });

  it('club cards grant shield and deal no damage', () => {
    const result = resolvePlay(
      play('club', 10),
      character({ suit: 'club', shield: 2 }),
      character({ hp: 40 }),
    );
    expect(result).toMatchObject({
      resolvedDamage: 0,
      hpLost: 0,
      shieldGained: 10,
      attackerShield: 12,
      targetHp: 40,
    });
  });

  it('diamond exposes the successful-draw budget unless immune', () => {
    expect(
      resolvePlay(play('diamond', 5), character(), character({ suit: 'heart' })).diamondDrawCount,
    ).toBe(5);
    expect(
      resolvePlay(play('diamond', 5), character(), character({ suit: 'diamond' })).diamondDrawCount,
    ).toBe(0);
  });
});
