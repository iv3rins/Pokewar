import type { Card, JokerCard, OrdinaryRank, PhysicalCard, Suit } from '../model/cards.js';
import type { RandomState } from '../random/prng.js';
import { shuffle } from '../random/prng.js';

export interface DeckState {
  readonly drawPile: readonly Card[];
  readonly discardPile: readonly Card[];
  readonly removedJokers: readonly JokerCard[];
}

export interface DrawResult {
  readonly cards: readonly Card[];
  readonly deck: DeckState;
  readonly random: RandomState;
}

const SUITS: readonly Suit[] = ['spade', 'heart', 'diamond', 'club'];
const RANKS: readonly OrdinaryRank[] = ['A', 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function deckCountForPlayers(playerCount: number): number {
  if (!Number.isSafeInteger(playerCount) || playerCount < 2 || playerCount > 12) {
    throw new Error('PLAYER_COUNT_OUT_OF_RANGE');
  }
  return Math.ceil(playerCount / 4);
}

export function createDeck(playerCount: number, random: RandomState): DrawResult {
  const cards: Card[] = [];
  for (let deckIndex = 0; deckIndex < deckCountForPlayers(playerCount); deckIndex += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const card: PhysicalCard = {
          kind: 'physical',
          id: `deck-${String(deckIndex)}-${suit}-${String(rank)}`,
          suit,
          rank,
        };
        cards.push(card);
      }
    }
    cards.push(
      { kind: 'joker', id: `deck-${String(deckIndex)}-joker-1` },
      { kind: 'joker', id: `deck-${String(deckIndex)}-joker-2` },
    );
  }
  const shuffled = shuffle(cards, random);
  return {
    cards: [],
    deck: { drawPile: shuffled.value, discardPile: [], removedJokers: [] },
    random: shuffled.random,
  };
}

export function drawCards(deck: DeckState, requested: number, random: RandomState): DrawResult {
  if (!Number.isSafeInteger(requested) || requested < 0) throw new Error('INVALID_DRAW_COUNT');
  let drawPile = [...deck.drawPile];
  let discardPile = [...deck.discardPile];
  let nextRandom = random;
  const cards: Card[] = [];

  while (cards.length < requested) {
    if (drawPile.length === 0 && discardPile.length > 0) {
      const shuffled = shuffle(discardPile, nextRandom);
      drawPile = [...shuffled.value];
      discardPile = [];
      nextRandom = shuffled.random;
    }
    const card = drawPile.shift();
    if (!card) break;
    cards.push(card);
  }

  return {
    cards,
    deck: { drawPile, discardPile, removedJokers: deck.removedJokers },
    random: nextRandom,
  };
}
