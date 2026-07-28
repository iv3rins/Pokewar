import { createFusedCard, type FusionError } from '../cards/fusion.js';
import { validateOrdinaryPlay, type PlayError } from '../cards/play.js';
import { resolvePlay } from '../combat/resolve.js';
import { drawCards, type DeckState } from '../deck/deck.js';
import { cardValue, type Card, type HandEntity, type PlayableEntity } from '../model/cards.js';
import type { CharacterState } from '../model/characters.js';
import type {
  CreateFusionCommand,
  DomainEvent,
  GameErrorCode,
  GamePlayer,
  GameState,
  PlayCardsCommand,
  PublicPlayedCard,
} from './model.js';

const TURN_MS = 30_000;
const RESCUE_OFFER_MS = 5_000;
const HAND_LIMIT = 7;

type PlayingResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly DomainEvent[] }
  | { readonly ok: false; readonly code: GameErrorCode };

function playerById(state: GameState, playerId: string): GamePlayer | undefined {
  return state.players.find((player) => player.id === playerId);
}

function activeCharacter(player: GamePlayer): CharacterState | undefined {
  return player.characters.find((character) => character.id === player.activeCharacterId);
}

export function replacePlayer(
  players: readonly GamePlayer[],
  replacement: GamePlayer,
): readonly GamePlayer[] {
  return players.map((player) => (player.id === replacement.id ? replacement : player));
}

function uniqueCardIds(cardIds: readonly string[]): boolean {
  return new Set(cardIds).size === cardIds.length;
}

function selectedHandEntities(
  player: GamePlayer,
  cardIds: readonly string[],
): readonly HandEntity[] | undefined {
  if (!uniqueCardIds(cardIds)) return undefined;
  const selected = cardIds.map((id) => player.hand.find((card) => card.id === id));
  return selected.every((card) => card !== undefined) ? selected : undefined;
}

function toPublicCard(card: PlayableEntity): PublicPlayedCard {
  return {
    kind: card.kind,
    suit: card.suit,
    value: cardValue(card),
    fused: card.kind === 'fused',
  };
}

function discardPlayedEntities(deck: DeckState, entities: readonly PlayableEntity[]): DeckState {
  const physicalCards = entities.filter(
    (entity): entity is Card & { readonly kind: 'physical' } => entity.kind === 'physical',
  );
  return { ...deck, discardPile: [...deck.discardPile, ...physicalCards] };
}

export function nextAlivePlayer(
  players: readonly GamePlayer[],
  afterSeat: number,
): GamePlayer | undefined {
  const alive = players.filter((player) => !player.eliminated && player.seat !== null);
  if (alive.length === 0) return undefined;
  return [...alive].sort((left, right) => {
    const leftDistance =
      ((left.seat ?? 0) - afterSeat + players.length) % players.length || players.length;
    const rightDistance =
      ((right.seat ?? 0) - afterSeat + players.length) % players.length || players.length;
    return leftDistance - rightDistance;
  })[0];
}

export function drawForPlayer(
  state: GameState,
  playerId: string,
  requested: number,
  reason: 'diamond' | 'empty-supply' | 'rescue' | 'replacement' | 'elimination-reward',
): { state: GameState; event?: DomainEvent } {
  const player = playerById(state, playerId);
  if (!player || !state.deck || player.hand.length >= HAND_LIMIT || requested <= 0)
    return { state };
  const count = Math.min(requested, HAND_LIMIT - player.hand.length);
  const draw = drawCards(state.deck, count, state.random);
  if (draw.cards.length === 0) return { state: { ...state, deck: draw.deck, random: draw.random } };
  const updated = { ...player, hand: [...player.hand, ...draw.cards] };
  return {
    state: {
      ...state,
      players: replacePlayer(state.players, updated),
      deck: draw.deck,
      random: draw.random,
    },
    event: { kind: 'cards:drawn', playerId, count: draw.cards.length, reason },
  };
}

export function applyDiamondDraws(
  state: GameState,
  attackerSeat: number,
  drawCount: number,
): { state: GameState; events: readonly DomainEvent[] } {
  let nextState = state;
  const events: DomainEvent[] = [];
  let remaining = drawCount;
  let seatCursor = attackerSeat - 1;
  let visitsWithoutDraw = 0;

  while (remaining > 0 && visitsWithoutDraw < state.players.length) {
    const player = nextAlivePlayer(nextState.players, seatCursor);
    if (player?.seat === null || player === undefined) break;
    seatCursor = player.seat;
    const before = player.hand.length;
    const result = drawForPlayer(nextState, player.id, 1, 'diamond');
    nextState = result.state;
    if (result.event) {
      events.push(result.event);
      remaining -= 1;
      visitsWithoutDraw = 0;
    } else {
      visitsWithoutDraw += 1;
      const deckExhausted =
        nextState.deck !== null &&
        nextState.deck.drawPile.length === 0 &&
        nextState.deck.discardPile.length === 0;
      if (before < HAND_LIMIT && deckExhausted) break;
    }
  }
  return { state: nextState, events };
}

export function advanceTurn(
  state: GameState,
  afterSeat: number,
  now: number,
): { state: GameState; events: readonly DomainEvent[] } {
  const nextPlayer = nextAlivePlayer(state.players, afterSeat);
  if (!nextPlayer) throw new Error('NEXT_PLAYER_NOT_FOUND');
  const deadline = now + TURN_MS;
  return {
    state: { ...state, currentPlayerId: nextPlayer.id, turnDeadline: deadline },
    events: [{ kind: 'turn:started', playerId: nextPlayer.id, deadline }],
  };
}

export function finishTurn(
  state: GameState,
  attacker: GamePlayer,
  now: number,
): { state: GameState; events: readonly DomainEvent[] } {
  let nextState = state;
  const events: DomainEvent[] = [];
  const currentAttacker = playerById(nextState, attacker.id);
  const onlyJokers = currentAttacker?.hand.every((card) => card.kind === 'joker') ?? false;
  if (currentAttacker && (currentAttacker.hand.length === 0 || onlyJokers)) {
    const supply = drawForPlayer(nextState, attacker.id, 3, 'empty-supply');
    nextState = supply.state;
    if (supply.event) events.push(supply.event);
  }

  if (attacker.seat === null) throw new Error('ATTACKER_SEAT_REQUIRED');
  const advanced = advanceTurn(nextState, attacker.seat, now);
  return { state: advanced.state, events: [...events, ...advanced.events] };
}

function fusionError(error: FusionError): GameErrorCode {
  return error;
}

function playError(error: PlayError): GameErrorCode {
  return error;
}

export function createFusionInGame(state: GameState, command: CreateFusionCommand): PlayingResult {
  if (state.phase !== 'PLAYING') return { ok: false, code: 'INVALID_PHASE' };
  if (state.currentPlayerId !== command.playerId) return { ok: false, code: 'NOT_CURRENT_ACTOR' };
  if (state.turnDeadline !== null && command.now > state.turnDeadline)
    return { ok: false, code: 'DEADLINE_EXPIRED' };
  const player = playerById(state, command.playerId);
  if (!player) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (!uniqueCardIds(command.cardIds)) return { ok: false, code: 'DUPLICATE_CARD_ID' };
  if (
    state.players.some((candidate) =>
      candidate.hand.some((card) => card.id === command.fusedCardId),
    )
  ) {
    return { ok: false, code: 'FUSED_CARD_ID_REUSED' };
  }
  const cards = selectedHandEntities(player, command.cardIds);
  if (!cards) return { ok: false, code: 'CARD_NOT_IN_HAND' };
  const fusion = createFusedCard(cards, command.selectedSuit, command.fusedCardId);
  if (!fusion.ok) return { ok: false, code: fusionError(fusion.code) };
  if (!state.deck) throw new Error('DECK_REQUIRED');

  const physicalSources = cards.filter(
    (card): card is Card & { readonly kind: 'physical' } => card.kind === 'physical',
  );
  const updatedPlayer: GamePlayer = {
    ...player,
    hand: [...player.hand.filter((card) => !command.cardIds.includes(card.id)), fusion.card],
  };
  return {
    ok: true,
    state: {
      ...state,
      players: replacePlayer(state.players, updatedPlayer),
      deck: { ...state.deck, discardPile: [...state.deck.discardPile, ...physicalSources] },
    },
    events: [{ kind: 'fusion:created', playerId: player.id, card: toPublicCard(fusion.card) }],
  };
}

export function playCardsInGame(state: GameState, command: PlayCardsCommand): PlayingResult {
  if (state.phase !== 'PLAYING') return { ok: false, code: 'INVALID_PHASE' };
  if (state.currentPlayerId !== command.playerId) return { ok: false, code: 'NOT_CURRENT_ACTOR' };
  if (state.turnDeadline !== null && command.now > state.turnDeadline)
    return { ok: false, code: 'DEADLINE_EXPIRED' };
  const attacker = playerById(state, command.playerId);
  if (!attacker) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (!uniqueCardIds(command.cardIds)) return { ok: false, code: 'DUPLICATE_CARD_ID' };
  const entities = selectedHandEntities(attacker, command.cardIds);
  if (!entities) return { ok: false, code: 'CARD_NOT_IN_HAND' };
  const validation = validateOrdinaryPlay(entities);
  if (!validation.ok) return { ok: false, code: playError(validation.code) };
  const play = validation.play;

  let target: GamePlayer | undefined;
  if (play.kind === 'attack') {
    if (!command.targetPlayerId) return { ok: false, code: 'TARGET_REQUIRED' };
    if (command.targetPlayerId === attacker.id) return { ok: false, code: 'TARGET_NOT_ALLOWED' };
    target = playerById(state, command.targetPlayerId);
    if (!target || target.eliminated || !target.activeCharacterId)
      return { ok: false, code: 'INVALID_TARGET' };
  } else if (command.targetPlayerId) {
    return { ok: false, code: 'TARGET_NOT_ALLOWED' };
  }

  const attackerCharacter = activeCharacter(attacker);
  const targetCharacter = target ? activeCharacter(target) : undefined;
  if (!attackerCharacter || (target && !targetCharacter))
    throw new Error('ACTIVE_CHARACTER_NOT_FOUND');
  if (!state.deck) throw new Error('DECK_REQUIRED');
  const combat = resolvePlay(play, attackerCharacter, targetCharacter);
  const remainingHand = attacker.hand.filter((card) => !command.cardIds.includes(card.id));
  const updatedAttacker: GamePlayer = {
    ...attacker,
    hand: remainingHand,
    characters: attacker.characters.map((character) =>
      character.id === attackerCharacter.id
        ? { ...character, hp: combat.attackerHp, shield: combat.attackerShield }
        : character,
    ),
  };
  let players = replacePlayer(state.players, updatedAttacker);
  if (target && targetCharacter) {
    const updatedTarget: GamePlayer = {
      ...target,
      characters: target.characters.map((character) =>
        character.id === targetCharacter.id
          ? { ...character, hp: combat.targetHp, shield: combat.targetShield }
          : character,
      ),
    };
    players = replacePlayer(players, updatedTarget);
  }

  let nextState: GameState = {
    ...state,
    players,
    deck: discardPlayedEntities(state.deck, play.entities),
  };
  const events: DomainEvent[] = [
    {
      kind: 'cards:played',
      playerId: attacker.id,
      targetPlayerId: target?.id ?? null,
      cards: play.entities.map(toPublicCard),
      totalValue: play.value,
      bypassSuitImmunity: play.bypassSuitImmunity,
    },
    {
      kind: 'combat:resolved',
      attackerPlayerId: attacker.id,
      targetPlayerId: target?.id ?? null,
      hpLost: combat.hpLost,
      shieldLost: combat.shieldLost,
      healing: combat.healing,
      shieldGained: combat.shieldGained,
      immuneToSuitEffect: combat.immuneToSuitEffect,
    },
  ];

  if (target && combat.targetHp === 0) {
    if (attacker.seat === null) throw new Error('ATTACKER_SEAT_REQUIRED');
    const rescueQueue = [...nextState.players]
      .filter((player) => !player.eliminated && player.seat !== null)
      .sort((left, right) => {
        const victimSeat = target.seat ?? 0;
        const leftDistance =
          ((left.seat ?? 0) - victimSeat + nextState.players.length) % nextState.players.length;
        const rightDistance =
          ((right.seat ?? 0) - victimSeat + nextState.players.length) % nextState.players.length;
        return leftDistance - rightDistance;
      })
      .map((player) => player.id);
    const offeredPlayerId = rescueQueue[0];
    if (!offeredPlayerId) throw new Error('RESCUE_PLAYER_NOT_FOUND');
    const rescueDeadline = command.now + RESCUE_OFFER_MS;
    nextState = {
      ...nextState,
      phase: 'WAITING_FOR_JOKER',
      turnDeadline: null,
      pendingDeath: {
        attackerPlayerId: attacker.id,
        victimPlayerId: target.id,
        attackerSeat: attacker.seat,
        diamondDrawCount: combat.diamondDrawCount,
        rewardKiller: true,
        supplyAttacker: true,
        rescueQueue,
        rescueIndex: 0,
        rescueDeadline,
        replacementDeadline: null,
      },
    };
    events.push({
      kind: 'joker:rescue-started',
      victimPlayerId: target.id,
      offeredPlayerId,
      deadline: rescueDeadline,
    });
    return { ok: true, state: nextState, events };
  }

  if (combat.diamondDrawCount > 0 && attacker.seat !== null) {
    const diamond = applyDiamondDraws(nextState, attacker.seat, combat.diamondDrawCount);
    nextState = diamond.state;
    events.push(...diamond.events);
  }
  const finished = finishTurn(nextState, updatedAttacker, command.now);
  events.push(...finished.events);
  return { ok: true, state: finished.state, events };
}
