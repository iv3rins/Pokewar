export const SUITS = ['spade', 'heart', 'diamond', 'club'] as const;
export type Suit = (typeof SUITS)[number];

export type OrdinaryRank = 'A' | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface PhysicalCard {
  readonly kind: 'physical';
  readonly id: string;
  readonly suit: Suit;
  readonly rank: OrdinaryRank;
}

export interface JokerCard {
  readonly kind: 'joker';
  readonly id: string;
}

export interface FusedCard {
  readonly kind: 'fused';
  readonly id: string;
  readonly sourceCardIds: readonly [string, string];
  readonly suit: Suit;
  readonly value: number;
  readonly bypassSuitImmunity: true;
}

export type Card = PhysicalCard | JokerCard;
export type HandEntity = Card | FusedCard;
export type PlayableEntity = PhysicalCard | FusedCard;

export function cardValue(card: PlayableEntity): number {
  if (card.kind === 'fused') return card.value;
  return card.rank === 'A' ? 1 : card.rank;
}
