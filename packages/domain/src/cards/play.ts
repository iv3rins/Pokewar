import { cardValue, type HandEntity, type PlayableEntity, type Suit } from '../model/cards.js';

export type PlayKind = 'attack' | 'defense';

export interface ValidatedPlay {
  readonly entities: readonly PlayableEntity[];
  readonly suit: Suit;
  readonly value: number;
  readonly entityCount: 1 | 3 | 5;
  readonly kind: PlayKind;
  readonly bypassSuitImmunity: boolean;
}

export type PlayError = 'JOKER_NOT_ALLOWED' | 'INVALID_CARD_COUNT' | 'MIXED_SUITS';
export type ValidatePlayResult =
  | { readonly ok: true; readonly play: ValidatedPlay }
  | { readonly ok: false; readonly code: PlayError };

export function validateOrdinaryPlay(entities: readonly HandEntity[]): ValidatePlayResult {
  if (entities.some((entity) => entity.kind === 'joker')) {
    return { ok: false, code: 'JOKER_NOT_ALLOWED' };
  }

  if (entities.length !== 1 && entities.length !== 3 && entities.length !== 5) {
    return { ok: false, code: 'INVALID_CARD_COUNT' };
  }

  const playable = entities as readonly PlayableEntity[];
  const suit = playable[0]?.suit;
  if (!suit || playable.some((entity) => entity.suit !== suit)) {
    return { ok: false, code: 'MIXED_SUITS' };
  }

  return {
    ok: true,
    play: {
      entities: playable,
      suit,
      value: playable.reduce((total, entity) => total + cardValue(entity), 0),
      entityCount: entities.length,
      kind: suit === 'club' ? 'defense' : 'attack',
      bypassSuitImmunity: playable.some((entity) => entity.kind === 'fused'),
    },
  };
}
