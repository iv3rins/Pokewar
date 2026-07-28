import type { GameCommand, GamePlayer, GameState, HandEntity, OrdinaryRank } from '@pokewar/domain';
import { randomUUID } from 'node:crypto';

export type BotDifficulty = 'beginner';

export type BotStrategy = (
  state: GameState,
  botPlayerId: string,
  now: number,
) => GameCommand | null;

function pickLowestCard(hand: readonly HandEntity[]): string | null {
  const playable = hand.filter(
    (entity): entity is Extract<HandEntity, { kind: 'physical' }> => entity.kind === 'physical',
  );
  if (playable.length === 0) return null;
  const sorted = [...playable].sort((a, b) => {
    const toNum = (r: OrdinaryRank): number => (r === 'A' ? 1 : r);
    return toNum(a.rank) - toNum(b.rank);
  });
  return sorted[0]?.id ?? null;
}

function pickAvailableCharacter(player: GamePlayer): string | null {
  return (
    player.characters.find(
      (character) => !character.eliminated && character.id !== player.activeCharacterId,
    )?.id ?? null
  );
}

function firstAvailableCharacter(player: GamePlayer): string | null {
  return player.characters.find((character) => !character.eliminated)?.id ?? null;
}

function firstAliveOpponent(state: GameState, botPlayerId: string): string | null {
  return (
    state.players.find((player) => player.id !== botPlayerId && !player.eliminated)?.id ?? null
  );
}

export const beginnerStrategy: BotStrategy = (state, botPlayerId, now) => {
  const base = {
    playerId: botPlayerId,
    now,
    actionId: randomUUID(),
    expectedVersion: state.version,
  };

  const player = state.players.find((p) => p.id === botPlayerId);
  if (!player || player.eliminated) return null;

  if (state.phase === 'SELECTING_STARTER') {
    if (player.activeCharacterId !== null) return null;
    const characterId = firstAvailableCharacter(player);
    if (!characterId) return null;
    return { ...base, kind: 'game:select-starter', characterId };
  }

  if (state.phase === 'PLAYING' && state.currentPlayerId === botPlayerId) {
    const cardId = pickLowestCard(player.hand);
    if (!cardId) return null;
    const card = player.hand.find((candidate) => candidate.id === cardId);
    const targetPlayerId = firstAliveOpponent(state, botPlayerId);
    return {
      ...base,
      kind: 'game:play-cards',
      cardIds: [cardId],
      ...(card?.kind === 'physical' && card.suit !== 'club' && targetPlayerId
        ? { targetPlayerId }
        : {}),
    };
  }

  if (state.phase === 'WAITING_FOR_JOKER' && state.pendingDeath) {
    const offerIndex = state.pendingDeath.rescueIndex;
    const offered = state.pendingDeath.rescueQueue[offerIndex];
    if (offered !== botPlayerId) return null;
    return { ...base, kind: 'game:decline-rescue' };
  }

  if (state.phase === 'SELECTING_REPLACEMENT' && state.pendingDeath) {
    if (state.pendingDeath.victimPlayerId !== botPlayerId) return null;
    const characterId = pickAvailableCharacter(player);
    if (!characterId) return null;
    return { ...base, kind: 'game:select-replacement', characterId };
  }

  return null;
};
