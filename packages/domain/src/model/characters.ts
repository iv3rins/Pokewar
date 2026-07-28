import type { Suit } from './cards.js';

export const CHARACTER_RANKS = ['J', 'Q', 'K'] as const;
export type CharacterRank = (typeof CHARACTER_RANKS)[number];

export const CHARACTER_MAX_HP: Readonly<Record<CharacterRank, number>> = {
  J: 30,
  Q: 40,
  K: 50,
};

export interface CharacterState {
  readonly id: string;
  readonly rank: CharacterRank;
  readonly suit: Suit;
  readonly hp: number;
  readonly shield: number;
  readonly eliminated: boolean;
}
