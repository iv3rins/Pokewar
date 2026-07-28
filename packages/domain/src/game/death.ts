import type { Card, FusedCard, JokerCard } from '../model/cards.js';
import { CHARACTER_MAX_HP } from '../model/characters.js';
import { randomInt } from '../random/prng.js';
import type {
  DeclineRescueCommand,
  DomainEvent,
  GameErrorCode,
  GamePlayer,
  GameState,
  ReplacementTimeoutCommand,
  RescueOfferTimeoutCommand,
  RescueWithJokerCommand,
  SelectReplacementCommand,
} from './model.js';
import {
  advanceTurn,
  applyDiamondDraws,
  drawForPlayer,
  finishTurn,
  replacePlayer,
} from './playing.js';

const RESCUE_OFFER_MS = 5_000;
const REPLACEMENT_MS = 15_000;

type DeathCommand =
  | RescueWithJokerCommand
  | DeclineRescueCommand
  | RescueOfferTimeoutCommand
  | SelectReplacementCommand
  | ReplacementTimeoutCommand;

type DeathResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly DomainEvent[] }
  | { readonly ok: false; readonly code: GameErrorCode };

function playerById(state: GameState, playerId: string): GamePlayer | undefined {
  return state.players.find((player) => player.id === playerId);
}

function recyclableCards(hand: readonly (Card | FusedCard)[]): readonly Card[] {
  return hand.filter((card): card is Card => card.kind !== 'fused');
}

function activeCharacter(player: GamePlayer) {
  return player.characters.find((character) => character.id === player.activeCharacterId);
}

export function finalizeDeferredEffects(
  state: GameState,
  now: number,
  rescued: boolean,
): { state: GameState; events: readonly DomainEvent[] } {
  const pending = state.pendingDeath;
  if (!pending) throw new Error('PENDING_DEATH_REQUIRED');
  let nextState: GameState = { ...state, phase: 'PLAYING', pendingDeath: null };
  const events: DomainEvent[] = [];

  if (pending.diamondDrawCount > 0) {
    const diamond = applyDiamondDraws(nextState, pending.attackerSeat, pending.diamondDrawCount);
    nextState = diamond.state;
    events.push(...diamond.events);
  }

  if (!rescued && pending.rewardKiller) {
    const reward = drawForPlayer(nextState, pending.attackerPlayerId, 3, 'elimination-reward');
    nextState = reward.state;
    if (reward.event) events.push(reward.event);
  }

  const attacker = playerById(nextState, pending.attackerPlayerId);
  if (attacker?.seat === null || attacker === undefined) throw new Error('ATTACKER_NOT_FOUND');
  const finished = pending.supplyAttacker
    ? finishTurn(nextState, attacker, now)
    : advanceTurn(nextState, attacker.seat, now);
  return { state: finished.state, events: [...events, ...finished.events] };
}

function rescueWithJoker(state: GameState, command: RescueWithJokerCommand): DeathResult {
  const pending = state.pendingDeath;
  if (state.phase !== 'WAITING_FOR_JOKER' || !pending) return { ok: false, code: 'INVALID_PHASE' };
  const offeredPlayerId = pending.rescueQueue[pending.rescueIndex];
  if (offeredPlayerId !== command.playerId) return { ok: false, code: 'NOT_RESCUE_ACTOR' };
  if (command.now > pending.rescueDeadline) return { ok: false, code: 'DEADLINE_EXPIRED' };
  const rescuer = playerById(state, command.playerId);
  const victim = playerById(state, pending.victimPlayerId);
  if (!rescuer || !victim || !state.deck) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  const joker = rescuer.hand.find(
    (card): card is JokerCard => card.id === command.jokerCardId && card.kind === 'joker',
  );
  if (!joker) return { ok: false, code: 'JOKER_NOT_IN_HAND' };
  const victimCharacter = activeCharacter(victim);
  if (!victimCharacter) throw new Error('VICTIM_CHARACTER_NOT_FOUND');

  let players = state.players;
  const updatedRescuer: GamePlayer = {
    ...rescuer,
    hand: rescuer.hand.filter((card) => card.id !== joker.id),
  };
  players = replacePlayer(players, updatedRescuer);
  const victimAfterRescuer = updatedRescuer.id === victim.id ? updatedRescuer : victim;
  const discarded = recyclableCards(victimAfterRescuer.hand);
  const rescuedVictim: GamePlayer = {
    ...victimAfterRescuer,
    hand: [],
    characters: victimAfterRescuer.characters.map((character) =>
      character.id === victimCharacter.id
        ? { ...character, hp: CHARACTER_MAX_HP[character.rank], shield: 0 }
        : character,
    ),
  };
  players = replacePlayer(players, rescuedVictim);
  let nextState: GameState = {
    ...state,
    players,
    deck: { ...state.deck, discardPile: [...state.deck.discardPile, joker, ...discarded] },
  };
  const draw = drawForPlayer(nextState, victim.id, 5, 'rescue');
  nextState = draw.state;
  const events: DomainEvent[] = [
    { kind: 'joker:rescued', rescuerPlayerId: rescuer.id, victimPlayerId: victim.id },
  ];
  if (draw.event) events.push(draw.event);
  const finished = finalizeDeferredEffects(nextState, command.now, true);
  return { ok: true, state: finished.state, events: [...events, ...finished.events] };
}

export function eliminateCharacter(
  state: GameState,
  now: number,
): { state: GameState; events: readonly DomainEvent[] } {
  const pending = state.pendingDeath;
  if (!pending || !state.deck) throw new Error('PENDING_DEATH_REQUIRED');
  const victim = playerById(state, pending.victimPlayerId);
  if (!victim) throw new Error('VICTIM_NOT_FOUND');
  const victimCharacter = activeCharacter(victim);
  if (!victimCharacter) throw new Error('VICTIM_CHARACTER_NOT_FOUND');
  const eliminatedCharacter = { ...victimCharacter, hp: 0, shield: 0, eliminated: true };
  const discarded = recyclableCards(victim.hand);
  const available = victim.characters.filter(
    (character) => character.id !== victimCharacter.id && !character.eliminated,
  );
  let updatedVictim: GamePlayer = {
    ...victim,
    hand: [],
    activeCharacterId: null,
    characters: victim.characters.map((character) =>
      character.id === victimCharacter.id ? eliminatedCharacter : character,
    ),
  };
  let nextState: GameState = {
    ...state,
    players: replacePlayer(state.players, updatedVictim),
    deck: { ...state.deck, discardPile: [...state.deck.discardPile, ...discarded] },
  };
  const events: DomainEvent[] = [
    { kind: 'character:eliminated', playerId: victim.id, characterId: victimCharacter.id },
  ];

  if (available.length > 0 && state.mode === 'normal') {
    const replacementDeadline = now + REPLACEMENT_MS;
    nextState = {
      ...nextState,
      phase: 'SELECTING_REPLACEMENT',
      pendingDeath: { ...pending, replacementDeadline },
    };
    events.push({
      kind: 'replacement:started',
      playerId: victim.id,
      deadline: replacementDeadline,
    });
    return { state: nextState, events };
  }

  updatedVictim = { ...updatedVictim, eliminated: true };
  nextState = { ...nextState, players: replacePlayer(nextState.players, updatedVictim) };
  events.push({ kind: 'player:eliminated', playerId: victim.id });
  const survivors = nextState.players.filter((player) => !player.eliminated);
  if (survivors.length === 1) {
    const winner = survivors[0];
    if (!winner) throw new Error('WINNER_NOT_FOUND');
    let terminalState: GameState = nextState;
    if (pending.diamondDrawCount > 0) {
      const diamond = applyDiamondDraws(
        terminalState,
        pending.attackerSeat,
        pending.diamondDrawCount,
      );
      terminalState = diamond.state;
      events.push(...diamond.events);
    }
    if (pending.rewardKiller) {
      const reward = drawForPlayer(
        terminalState,
        pending.attackerPlayerId,
        3,
        'elimination-reward',
      );
      terminalState = reward.state;
      if (reward.event) events.push(reward.event);
    }
    return {
      state: {
        ...terminalState,
        phase: 'GAME_OVER',
        currentPlayerId: null,
        turnDeadline: null,
        pendingDeath: null,
      },
      events: [...events, { kind: 'game:over', winnerPlayerId: winner.id }],
    };
  }
  const finished = finalizeDeferredEffects(nextState, now, false);
  return { state: finished.state, events: [...events, ...finished.events] };
}

export function declineOrTimeout(
  state: GameState,
  command: DeclineRescueCommand | RescueOfferTimeoutCommand,
): DeathResult {
  const pending = state.pendingDeath;
  if (state.phase !== 'WAITING_FOR_JOKER' || !pending) return { ok: false, code: 'INVALID_PHASE' };
  const offeredPlayerId = pending.rescueQueue[pending.rescueIndex];
  if (offeredPlayerId !== command.playerId) return { ok: false, code: 'NOT_RESCUE_ACTOR' };
  if (command.kind === 'game:decline-rescue' && command.now > pending.rescueDeadline) {
    return { ok: false, code: 'DEADLINE_EXPIRED' };
  }
  if (command.kind === 'system:rescue-offer-timeout' && command.now <= pending.rescueDeadline) {
    return { ok: false, code: 'DEADLINE_NOT_REACHED' };
  }
  const reason = command.kind === 'game:decline-rescue' ? 'declined' : 'timeout';
  return forceDeclineRescue(state, command.playerId, command.now, reason);
}

export function forceDeclineRescue(
  state: GameState,
  playerId: string,
  now: number,
  reason: 'declined' | 'timeout' = 'declined',
): DeathResult {
  const pending = state.pendingDeath;
  if (state.phase !== 'WAITING_FOR_JOKER' || !pending) return { ok: false, code: 'INVALID_PHASE' };
  if (pending.rescueQueue[pending.rescueIndex] !== playerId) {
    return { ok: false, code: 'NOT_RESCUE_ACTOR' };
  }
  const events: DomainEvent[] = [{ kind: 'joker:rescue-declined', playerId, reason }];
  const nextIndex = pending.rescueIndex + 1;
  if (nextIndex < pending.rescueQueue.length) {
    const nextPlayerId = pending.rescueQueue[nextIndex];
    if (!nextPlayerId) throw new Error('RESCUE_PLAYER_NOT_FOUND');
    const rescueDeadline = now + RESCUE_OFFER_MS;
    return {
      ok: true,
      state: {
        ...state,
        pendingDeath: { ...pending, rescueIndex: nextIndex, rescueDeadline },
      },
      events: [
        ...events,
        {
          kind: 'joker:rescue-started',
          victimPlayerId: pending.victimPlayerId,
          offeredPlayerId: nextPlayerId,
          deadline: rescueDeadline,
        },
      ],
    };
  }
  const eliminated = eliminateCharacter(state, now);
  return { ok: true, state: eliminated.state, events: [...events, ...eliminated.events] };
}

function selectReplacement(
  state: GameState,
  command: SelectReplacementCommand | ReplacementTimeoutCommand,
): DeathResult {
  const pending = state.pendingDeath;
  if (
    state.phase !== 'SELECTING_REPLACEMENT' ||
    pending?.replacementDeadline === null ||
    pending === null
  ) {
    return { ok: false, code: 'INVALID_PHASE' };
  }
  if (command.playerId !== pending.victimPlayerId)
    return { ok: false, code: 'NOT_REPLACEMENT_ACTOR' };
  const victim = playerById(state, command.playerId);
  if (!victim) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  const available = victim.characters.filter(
    (character) => !character.eliminated && character.id !== victim.activeCharacterId,
  );
  let selectedId: string;
  let random = state.random;
  let automatic = false;
  if (command.kind === 'game:select-replacement') {
    if (command.now > pending.replacementDeadline) return { ok: false, code: 'DEADLINE_EXPIRED' };
    if (!available.some((character) => character.id === command.characterId)) {
      return { ok: false, code: 'CHARACTER_NOT_AVAILABLE' };
    }
    selectedId = command.characterId;
  } else {
    if (command.now <= pending.replacementDeadline)
      return { ok: false, code: 'DEADLINE_NOT_REACHED' };
    const draw = randomInt(random, available.length);
    random = draw.random;
    const selected = available[draw.value];
    if (!selected) throw new Error('REPLACEMENT_NOT_FOUND');
    selectedId = selected.id;
    automatic = true;
  }
  const selected = available.find((character) => character.id === selectedId);
  if (!selected) throw new Error('REPLACEMENT_NOT_FOUND');
  const updatedVictim: GamePlayer = {
    ...victim,
    activeCharacterId: selected.id,
    characters: victim.characters.map((character) =>
      character.id === selected.id
        ? { ...character, hp: CHARACTER_MAX_HP[character.rank], shield: 0 }
        : character,
    ),
  };
  let nextState: GameState = {
    ...state,
    players: replacePlayer(state.players, updatedVictim),
    random,
    pendingDeath: { ...pending, replacementDeadline: null },
  };
  const draw = drawForPlayer(nextState, victim.id, 5, 'replacement');
  nextState = draw.state;
  const events: DomainEvent[] = [
    { kind: 'replacement:selected', playerId: victim.id, characterId: selected.id, automatic },
  ];
  if (draw.event) events.push(draw.event);
  const finished = finalizeDeferredEffects(nextState, command.now, false);
  return { ok: true, state: finished.state, events: [...events, ...finished.events] };
}

export function decideDeathPhase(state: GameState, command: DeathCommand): DeathResult {
  switch (command.kind) {
    case 'game:rescue-with-joker':
      return rescueWithJoker(state, command);
    case 'game:decline-rescue':
    case 'system:rescue-offer-timeout':
      return declineOrTimeout(state, command);
    case 'game:select-replacement':
    case 'system:replacement-timeout':
      return selectReplacement(state, command);
  }
}
