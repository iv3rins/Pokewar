import { describe, expect, it } from 'vitest';
import { createDeck, deckCountForPlayers, drawCards, type DeckState } from './deck.js';
import type { RandomState } from '../random/prng.js';

const random = (): RandomState => ({ seed: 'deck-seed', cursor: 0 });

describe('deck model', () => {
  it.each([
    [2, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
    [12, 3],
  ])('uses %i deck(s) for %i players', (players, decks) => {
    expect(deckCountForPlayers(players)).toBe(decks);
  });

  it('creates 40 ordinary cards and 2 Jokers per deck', () => {
    const result = createDeck(5, random());
    expect(result.deck.drawPile).toHaveLength(84);
    expect(result.deck.drawPile.filter((card) => card.kind === 'joker')).toHaveLength(4);
  });

  it('reshuffles recyclable discards and draws partially when exhausted', () => {
    const deck: DeckState = {
      drawPile: [{ kind: 'physical', id: 'draw-1', suit: 'spade', rank: 2 }],
      discardPile: [
        { kind: 'physical', id: 'discard-1', suit: 'heart', rank: 3 },
        { kind: 'joker', id: 'discard-joker' },
      ],
      removedJokers: [{ kind: 'joker', id: 'removed-joker' }],
    };
    const result = drawCards(deck, 5, random());
    expect(result.cards).toHaveLength(3);
    expect(new Set(result.cards.map((card) => card.id))).toEqual(
      new Set(['draw-1', 'discard-1', 'discard-joker']),
    );
    expect(result.deck.removedJokers).toEqual(deck.removedJokers);
  });
});
