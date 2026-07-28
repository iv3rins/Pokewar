import type {
  CharacterState,
  DomainEvent,
  GamePlayer,
  GameState,
  HandEntity,
} from '@pokewar/domain';
import {
  roomProjectionSchema,
  type BattleNotice,
  type GameProjection,
  type RoomProjection,
} from '@pokewar/protocol';
import type { RoomEventBatch, RoomState } from './model.js';

interface PublicCharacter {
  readonly id: string;
  readonly rank: CharacterState['rank'];
  readonly suit: CharacterState['suit'];
  readonly hp: number;
  readonly shield: number;
  readonly eliminated: boolean;
}

interface PlayerProjection {
  readonly id: string;
  readonly displayName: string;
  readonly seat: number | null;
  readonly connected: boolean;
  readonly eliminated: boolean;
  readonly handCount: number;
  readonly hand?: readonly HandEntity[];
  readonly activeCharacter: PublicCharacter | null;
  readonly characters?: readonly PublicCharacter[];
}

function characterProjection(character: CharacterState): PublicCharacter {
  return {
    id: character.id,
    rank: character.rank,
    suit: character.suit,
    hp: character.hp,
    shield: character.shield,
    eliminated: character.eliminated,
  };
}

function projectPlayer(player: GamePlayer, viewerId: string): PlayerProjection {
  const owner = player.id === viewerId;
  const active = player.characters.find((character) => character.id === player.activeCharacterId);
  return {
    id: player.id,
    displayName: player.displayName,
    seat: player.seat,
    connected: player.connected,
    eliminated: player.eliminated,
    handCount: player.hand.length,
    ...(owner ? { hand: player.hand, characters: player.characters.map(characterProjection) } : {}),
    activeCharacter: active ? characterProjection(active) : null,
  };
}

function eventNotice(event: DomainEvent, gameVersion: number, index: number): BattleNotice | null {
  const id = `${String(gameVersion)}:${event.kind}:${String(index)}`;
  switch (event.kind) {
    case 'cards:played':
      return {
        id,
        kind: 'play',
        actorPlayerId: event.playerId,
        targetPlayerId: event.targetPlayerId,
        value: event.totalValue,
        cards: event.cards,
      };
    case 'combat:resolved':
      return {
        id,
        kind: 'combat',
        actorPlayerId: event.attackerPlayerId,
        targetPlayerId: event.targetPlayerId,
        value: event.hpLost || event.shieldGained,
        hpLost: event.hpLost,
        shieldLost: event.shieldLost,
        healing: event.healing,
        shieldGained: event.shieldGained,
      };
    case 'fusion:created':
      return {
        id,
        kind: 'fusion',
        actorPlayerId: event.playerId,
        targetPlayerId: null,
        value: event.card.value,
      };
    case 'joker:rescued':
      return {
        id,
        kind: 'rescue',
        actorPlayerId: event.rescuerPlayerId,
        targetPlayerId: event.victimPlayerId,
        value: null,
      };
    case 'character:eliminated':
    case 'player:eliminated':
      return {
        id,
        kind: 'elimination',
        actorPlayerId: null,
        targetPlayerId: event.playerId,
        value: null,
      };
    case 'replacement:selected':
      return {
        id,
        kind: 'replacement',
        actorPlayerId: event.playerId,
        targetPlayerId: null,
        value: null,
      };
    case 'turn:timed-out':
      return {
        id,
        kind: 'timeout',
        actorPlayerId: event.playerId,
        targetPlayerId: null,
        value: event.hpLost,
      };
    case 'turn:started':
      return { id, kind: 'turn', actorPlayerId: event.playerId, targetPlayerId: null, value: null };
    case 'game:over':
      return {
        id,
        kind: 'game-over',
        actorPlayerId: event.winnerPlayerId,
        targetPlayerId: null,
        value: null,
      };
    default:
      return null;
  }
}

export function projectGame(
  game: GameState,
  viewerId: string,
  eventHistory: readonly RoomEventBatch[] = [],
): GameProjection {
  const pending = game.pendingDeath;
  return {
    id: game.id,
    version: game.version,
    mode: game.mode,
    phase: game.phase,
    currentPlayerId: game.currentPlayerId,
    turnDeadline: game.turnDeadline,
    players: game.players.map((player) => projectPlayer(player, viewerId)),
    notices: eventHistory.flatMap((batch) =>
      batch.events.flatMap((event, index) => {
        const notice = eventNotice(event, batch.gameVersion, index);
        return notice ? [notice] : [];
      }),
    ),
    pendingAction: pending
      ? {
          victimPlayerId: pending.victimPlayerId,
          offeredPlayerId: pending.rescueQueue[pending.rescueIndex] ?? null,
          rescueDeadline: pending.rescueDeadline,
          replacementDeadline: pending.replacementDeadline,
        }
      : null,
  };
}

export function projectRoom(room: RoomState, viewerId: string): RoomProjection {
  return roomProjectionSchema.parse({
    id: room.id,
    version: room.version,
    hostIdentityId: room.hostIdentityId,
    kind: room.kind ?? 'private',
    mode: room.mode,
    members: room.members.map((member) => ({
      identityId: member.identityId,
      displayName: member.displayName,
      ready: member.identityId === room.hostIdentityId ? true : member.ready,
      connected: member.connected,
      isSelf: member.identityId === viewerId,
    })),
    game: room.game ? projectGame(room.game, viewerId, room.eventHistory) : null,
  });
}
