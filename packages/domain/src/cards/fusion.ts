import type { FusedCard, HandEntity, PhysicalCard, Suit } from '../model/cards.js';

export type FusionError =
  'FUSION_REQUIRES_EXACTLY_TWO_PHYSICAL_CARDS' | 'FUSION_REQUIRES_ONE_ACE' | 'INVALID_FUSION_SUIT';

export type FusionResult =
  | { readonly ok: true; readonly card: FusedCard }
  | { readonly ok: false; readonly code: FusionError };

export function createFusedCard(
  cards: readonly HandEntity[],
  selectedSuit: Suit,
  fusedCardId: string,
): FusionResult {
  if (cards.length !== 2 || cards.some((card) => card.kind !== 'physical')) {
    return { ok: false, code: 'FUSION_REQUIRES_EXACTLY_TWO_PHYSICAL_CARDS' };
  }

  const physicalCards = cards as readonly [PhysicalCard, PhysicalCard];
  const ace = physicalCards.find(
    (card): card is PhysicalCard & { readonly rank: 'A' } => card.rank === 'A',
  );
  const numbered = physicalCards.find(
    (card): card is PhysicalCard & { readonly rank: Exclude<PhysicalCard['rank'], 'A'> } =>
      card.rank !== 'A',
  );
  if (!ace || !numbered) return { ok: false, code: 'FUSION_REQUIRES_ONE_ACE' };

  if (selectedSuit !== ace.suit && selectedSuit !== numbered.suit) {
    return { ok: false, code: 'INVALID_FUSION_SUIT' };
  }

  return {
    ok: true,
    card: {
      kind: 'fused',
      id: fusedCardId,
      sourceCardIds: [ace.id, numbered.id],
      suit: selectedSuit,
      value: numbered.rank + 1,
      bypassSuitImmunity: true,
    },
  };
}
