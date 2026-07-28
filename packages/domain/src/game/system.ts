import type { Card, FusedCard, JokerCard } from '../model/cards.js';
import { randomInt } from '../random/prng.js';
import { eliminateCharacter, finalizeDeferredEffects, forceDeclineRescue } from './death.js';
import type {
  DisconnectTimeoutCommand,
  DomainEvent,
  ExecuteCharacterCommand,
  GameErrorCode,
  GamePlayer,
  GameState,
  LeaveMatchCommand,
  PlayerDisconnectedCommand,
  PlayerReconnectedCommand,
  TurnTimeoutCommand,
} from './model.js';
import { advanceTurn, replacePlayer } from './playing.js';

const DISCONNECT_MS = 30_000;
const RESCUE_OFFER_MS = 5_000;

type SystemCommand =
  | ExecuteCharacterCommand
  | TurnTimeoutCommand
  | PlayerDisconnectedCommand
  | PlayerReconnectedCommand
  | DisconnectTimeoutCommand
  | LeaveMatchCommand;

type SystemResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly DomainEvent[] }
  | { readonly ok: false; readonly code: GameErrorCode };

function playerById(state: GameState, playerId: string): GamePlayer | undefined {
  return state.players.find((player) => player.id === playerId);
}

function activeCharacter(player: GamePlayer) {
  return player.characters.find((character) => character.id === player.activeCharacterId);
}

function recyclableCards(hand: readonly (Card | FusedCard)[]): readonly Card[] {
  return hand.filter((card): card is Card => card.kind !== 'fused');
}

function finishGameIfOneSurvivor(
  state: GameState,
  events: readonly DomainEvent[],
): { readonly state: GameState; readonly events: readonly DomainEvent[] } | null {
  const survivors = state.players.filter((player) => !player.eliminated);
  if (survivors.length !== 1) return null;
  const winner = survivors[0];
  if (!winner) throw new Error('WINNER_NOT_FOUND');
  return {
    state: {
      ...state,
      phase: 'GAME_OVER',
      currentPlayerId: null,
      turnDeadline: null,
      pendingDeath: null,
    },
    events: [...events, { kind: 'game:over', winnerPlayerId: winner.id }],
  };
}

function forceEliminatePlayer(
  state: GameState,
  playerId: string,
  now: number,
  reason: 'disconnect' | 'left',
): SystemResult {
  const player = playerById(state, playerId);
  if (!player) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (player.eliminated) return { ok: false, code: 'INVALID_TARGET' };
  if (!state.deck) throw new Error('DECK_REQUIRED');
  const wasCurrentPlayer = state.currentPlayerId === player.id;
  const discarded = recyclableCards(player.hand);
  const updatedPlayer: GamePlayer = {
    ...player,
    hand: [],
    activeCharacterId: null,
    characters: player.characters.map((character) => ({
      ...character,
      hp: 0,
      shield: 0,
      eliminated: true,
    })),
    eliminated: true,
    connected: false,
    disconnectDeadline: null,
  };
  let nextState: GameState = {
    ...state,
    players: replacePlayer(state.players, updatedPlayer),
    deck: { ...state.deck, discardPile: [...state.deck.discardPile, ...discarded] },
  };
  const events: DomainEvent[] = [{ kind: 'player:eliminated', playerId, reason }];
  const gameOver = finishGameIfOneSurvivor(nextState, events);
  if (gameOver) return { ok: true, ...gameOver };

  const pending = nextState.pendingDeath;
  if (pending?.victimPlayerId === playerId) {
    nextState = {
      ...nextState,
      phase: 'PLAYING',
      pendingDeath: { ...pending, rewardKiller: false },
    };
    const finished = finalizeDeferredEffects(nextState, now, false);
    return { ok: true, state: finished.state, events: [...events, ...finished.events] };
  }

  if (nextState.phase === 'WAITING_FOR_JOKER' && pending) {
    const queue = pending.rescueQueue.filter((candidate) => candidate !== playerId);
    const oldOffered = pending.rescueQueue[pending.rescueIndex];
    let rescueIndex = Math.min(pending.rescueIndex, Math.max(0, queue.length - 1));
    let rescueDeadline = pending.rescueDeadline;
    if (oldOffered === playerId) {
      rescueDeadline = now + RESCUE_OFFER_MS;
      rescueIndex = Math.min(pending.rescueIndex, Math.max(0, queue.length - 1));
      events.push({ kind: 'joker:rescue-declined', playerId, reason: 'timeout' });
    }
    nextState = {
      ...nextState,
      pendingDeath: { ...pending, rescueQueue: queue, rescueIndex, rescueDeadline },
    };
    if (queue.length === 0) {
      const eliminated = eliminateCharacter(nextState, now);
      return { ok: true, state: eliminated.state, events: [...events, ...eliminated.events] };
    }
    const offered = queue[rescueIndex];
    if (oldOffered === playerId && offered) {
      events.push({
        kind: 'joker:rescue-started',
        victimPlayerId: pending.victimPlayerId,
        offeredPlayerId: offered,
        deadline: rescueDeadline,
      });
    }
    return { ok: true, state: nextState, events };
  }

  if (wasCurrentPlayer && player.seat !== null && nextState.phase === 'PLAYING') {
    const advanced = advanceTurn(nextState, player.seat, now);
    return { ok: true, state: advanced.state, events: [...events, ...advanced.events] };
  }
  return { ok: true, state: nextState, events };
}

function executeCharacter(state: GameState, command: ExecuteCharacterCommand): SystemResult {
  if (state.phase !== 'PLAYING') return { ok: false, code: 'INVALID_PHASE' };
  if (state.currentPlayerId !== command.playerId) return { ok: false, code: 'NOT_CURRENT_ACTOR' };
  if (state.turnDeadline !== null && command.now > state.turnDeadline) {
    return { ok: false, code: 'DEADLINE_EXPIRED' };
  }
  if (command.jokerCardIds[0] === command.jokerCardIds[1]) {
    return { ok: false, code: 'TWO_DISTINCT_JOKERS_REQUIRED' };
  }
  const attacker = playerById(state, command.playerId);
  const victim = playerById(state, command.targetPlayerId);
  if (!attacker) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (!victim || victim.eliminated || !victim.activeCharacterId) {
    return { ok: false, code: 'INVALID_TARGET' };
  }
  if (victim.id === attacker.id) return { ok: false, code: 'TARGET_NOT_ALLOWED' };
  const jokers = command.jokerCardIds.map((id) =>
    attacker.hand.find((card): card is JokerCard => card.id === id && card.kind === 'joker'),
  );
  if (jokers.some((joker) => joker === undefined)) return { ok: false, code: 'JOKER_NOT_IN_HAND' };
  if (!state.deck || attacker.seat === null) throw new Error('EXECUTION_STATE_INVALID');
  const victimCharacter = activeCharacter(victim);
  if (!victimCharacter) throw new Error('VICTIM_CHARACTER_NOT_FOUND');
  const spentJokers = jokers.filter((joker): joker is JokerCard => joker !== undefined);
  const updatedAttacker: GamePlayer = {
    ...attacker,
    hand: attacker.hand.filter((card) => !command.jokerCardIds.includes(card.id)),
  };
  const updatedVictim: GamePlayer = {
    ...victim,
    characters: victim.characters.map((character) =>
      character.id === victimCharacter.id ? { ...character, hp: 0 } : character,
    ),
  };
  const preparedState: GameState = {
    ...state,
    players: replacePlayer(replacePlayer(state.players, updatedAttacker), updatedVictim),
    deck: { ...state.deck, removedJokers: [...state.deck.removedJokers, ...spentJokers] },
    pendingDeath: {
      attackerPlayerId: attacker.id,
      victimPlayerId: victim.id,
      attackerSeat: attacker.seat,
      diamondDrawCount: 0,
      rewardKiller: true,
      supplyAttacker: true,
      rescueQueue: [],
      rescueIndex: 0,
      rescueDeadline: command.now,
      replacementDeadline: null,
    },
  };
  const eliminated = eliminateCharacter(preparedState, command.now);
  return {
    ok: true,
    state: eliminated.state,
    events: [
      { kind: 'character:executed', attackerPlayerId: attacker.id, victimPlayerId: victim.id },
      ...eliminated.events,
    ],
  };
}

function turnTimeout(state: GameState, command: TurnTimeoutCommand): SystemResult {
  if (state.phase !== 'PLAYING') return { ok: false, code: 'INVALID_PHASE' };
  if (state.currentPlayerId !== command.playerId) return { ok: false, code: 'NOT_CURRENT_ACTOR' };
  if (state.turnDeadline === null || command.now <= state.turnDeadline) {
    return { ok: false, code: 'DEADLINE_NOT_REACHED' };
  }
  const player = playerById(state, command.playerId);
  if (player?.seat === null || player === undefined) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  const playerSeat = player.seat;
  const character = activeCharacter(player);
  if (!character || !state.deck) throw new Error('TURN_TIMEOUT_STATE_INVALID');

  let random = state.random;
  let discarded: Card | FusedCard | undefined;
  if (player.hand.length > 0) {
    const draw = randomInt(random, player.hand.length);
    random = draw.random;
    discarded = player.hand[draw.value];
  }
  const hp = Math.max(0, character.hp - 5);
  const updatedPlayer: GamePlayer = {
    ...player,
    hand: discarded ? player.hand.filter((card) => card.id !== discarded.id) : player.hand,
    characters: player.characters.map((candidate) =>
      candidate.id === character.id ? { ...candidate, hp } : candidate,
    ),
  };
  const recyclable = discarded && discarded.kind !== 'fused' ? [discarded] : [];
  let nextState: GameState = {
    ...state,
    players: replacePlayer(state.players, updatedPlayer),
    deck: { ...state.deck, discardPile: [...state.deck.discardPile, ...recyclable] },
    random,
  };
  const events: DomainEvent[] = [
    {
      kind: 'turn:timed-out',
      playerId: player.id,
      hpLost: character.hp - hp,
      discardedCardId: discarded?.id ?? null,
    },
  ];
  if (hp === 0) {
    const rescueQueue = [...nextState.players]
      .filter((candidate) => !candidate.eliminated && candidate.seat !== null)
      .sort((left, right) => {
        const leftDistance =
          ((left.seat ?? 0) - playerSeat + nextState.players.length) % nextState.players.length;
        const rightDistance =
          ((right.seat ?? 0) - playerSeat + nextState.players.length) % nextState.players.length;
        return leftDistance - rightDistance;
      })
      .map((candidate) => candidate.id);
    const offered = rescueQueue[0];
    if (!offered) throw new Error('RESCUE_PLAYER_NOT_FOUND');
    const deadline = command.now + RESCUE_OFFER_MS;
    nextState = {
      ...nextState,
      phase: 'WAITING_FOR_JOKER',
      turnDeadline: null,
      pendingDeath: {
        attackerPlayerId: player.id,
        victimPlayerId: player.id,
        attackerSeat: playerSeat,
        diamondDrawCount: 0,
        rewardKiller: false,
        supplyAttacker: false,
        rescueQueue,
        rescueIndex: 0,
        rescueDeadline: deadline,
        replacementDeadline: null,
      },
    };
    events.push({
      kind: 'joker:rescue-started',
      victimPlayerId: player.id,
      offeredPlayerId: offered,
      deadline,
    });
    return { ok: true, state: nextState, events };
  }
  const advanced = advanceTurn(nextState, playerSeat, command.now);
  return { ok: true, state: advanced.state, events: [...events, ...advanced.events] };
}

function disconnectPlayer(state: GameState, command: PlayerDisconnectedCommand): SystemResult {
  if (state.phase === 'GAME_OVER') return { ok: false, code: 'INVALID_PHASE' };
  const player = playerById(state, command.playerId);
  if (!player) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (!player.connected) return { ok: false, code: 'PLAYER_ALREADY_DISCONNECTED' };
  const deadline = command.now + DISCONNECT_MS;
  let nextState: GameState = {
    ...state,
    players: replacePlayer(state.players, {
      ...player,
      connected: false,
      disconnectDeadline: deadline,
    }),
  };
  const events: DomainEvent[] = [{ kind: 'player:disconnected', playerId: player.id, deadline }];
  const pending = nextState.pendingDeath;
  if (
    nextState.phase === 'WAITING_FOR_JOKER' &&
    pending?.rescueQueue[pending.rescueIndex] === player.id
  ) {
    const declined = forceDeclineRescue(nextState, player.id, command.now, 'declined');
    if (!declined.ok) return declined;
    nextState = declined.state;
    events.push(...declined.events);
  }
  return { ok: true, state: nextState, events };
}

function reconnectPlayer(state: GameState, command: PlayerReconnectedCommand): SystemResult {
  if (state.phase === 'GAME_OVER') return { ok: false, code: 'INVALID_PHASE' };
  const player = playerById(state, command.playerId);
  if (!player) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (player.connected) return { ok: false, code: 'PLAYER_ALREADY_CONNECTED' };
  if (player.disconnectDeadline === null || command.now > player.disconnectDeadline) {
    return { ok: false, code: 'DEADLINE_EXPIRED' };
  }
  return {
    ok: true,
    state: {
      ...state,
      players: replacePlayer(state.players, {
        ...player,
        connected: true,
        disconnectDeadline: null,
      }),
    },
    events: [{ kind: 'player:reconnected', playerId: player.id }],
  };
}

function disconnectTimeout(state: GameState, command: DisconnectTimeoutCommand): SystemResult {
  const player = playerById(state, command.playerId);
  if (!player) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (player.connected) return { ok: false, code: 'PLAYER_ALREADY_CONNECTED' };
  if (player.disconnectDeadline === null || command.now <= player.disconnectDeadline) {
    return { ok: false, code: 'DISCONNECT_DEADLINE_NOT_REACHED' };
  }
  return forceEliminatePlayer(state, player.id, command.now, 'disconnect');
}

function leaveMatch(state: GameState, command: LeaveMatchCommand): SystemResult {
  if (state.phase === 'GAME_OVER') return { ok: false, code: 'INVALID_PHASE' };
  return forceEliminatePlayer(state, command.playerId, command.now, 'left');
}

export function decideSystemBehavior(state: GameState, command: SystemCommand): SystemResult {
  switch (command.kind) {
    case 'game:execute-character':
      return executeCharacter(state, command);
    case 'system:turn-timeout':
      return turnTimeout(state, command);
    case 'system:player-disconnected':
      return disconnectPlayer(state, command);
    case 'system:player-reconnected':
      return reconnectPlayer(state, command);
    case 'system:disconnect-timeout':
      return disconnectTimeout(state, command);
    case 'game:leave-match':
      return leaveMatch(state, command);
  }
}
