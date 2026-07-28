import { describe, expect, it } from 'vitest';
import type { DeckState } from '../deck/deck.js';
import type { HandEntity, PhysicalCard, Suit } from '../model/cards.js';
import type { CharacterState } from '../model/characters.js';
import { createGame } from './create.js';
import type { CreateGameInput, GamePlayer, GameState } from './model.js';
import { decide } from './reducer.js';
import { replayCommands } from './replay.js';

const physical = (id: string, suit: Suit, rank: PhysicalCard['rank']): PhysicalCard => ({
  kind: 'physical',
  id,
  suit,
  rank,
});

const character = (id: string, rank: CharacterState['rank'] = 'Q', hp = 40): CharacterState => ({
  id,
  rank,
  suit: 'heart',
  hp,
  shield: 9,
  eliminated: false,
});

function systemState(
  options: {
    readonly mode?: GameState['mode'];
    readonly actorHp?: number;
    readonly actorHand?: readonly HandEntity[];
    readonly targetHasReserve?: boolean;
  } = {},
): GameState {
  const actorCharacter = character('actor-Q', 'Q', options.actorHp ?? 40);
  const targetActive = character('target-J', 'J', 30);
  const targetReserve = character('target-K', 'K', 50);
  const thirdCharacter = character('third-Q');
  const players: readonly GamePlayer[] = [
    {
      id: 'actor',
      displayName: '攻击者#A001',
      originalJoinIndex: 0,
      seat: 0,
      characters: [actorCharacter],
      activeCharacterId: actorCharacter.id,
      hand: options.actorHand ?? [],
      eliminated: false,
      connected: true,
      disconnectDeadline: null,
    },
    {
      id: 'target',
      displayName: '目标#B002',
      originalJoinIndex: 1,
      seat: 1,
      characters: options.targetHasReserve ? [targetActive, targetReserve] : [targetActive],
      activeCharacterId: targetActive.id,
      hand: [physical('target-card', 'club', 4)],
      eliminated: false,
      connected: true,
      disconnectDeadline: null,
    },
    {
      id: 'third',
      displayName: '第三人#C003',
      originalJoinIndex: 2,
      seat: 2,
      characters: [thirdCharacter],
      activeCharacterId: thirdCharacter.id,
      hand: [],
      eliminated: false,
      connected: true,
      disconnectDeadline: null,
    },
  ];
  const deck: DeckState = {
    drawPile: Array.from({ length: 24 }, (_, index) =>
      physical(`draw-${String(index)}`, 'spade', 2),
    ),
    discardPile: [],
    removedJokers: [],
  };
  return {
    id: 'system-game',
    domainVersion: 1,
    version: 0,
    mode: options.mode ?? 'quick',
    phase: 'PLAYING',
    players,
    deck,
    currentPlayerId: 'actor',
    turnDeadline: 31_000,
    starterDeadlines: [],
    pendingDeath: null,
    random: { seed: 'system-seed', cursor: 0 },
    acceptedCommands: [],
  };
}

function player(state: GameState, id: string): GamePlayer {
  const result = state.players.find((candidate) => candidate.id === id);
  if (!result) throw new Error('TEST_PLAYER_NOT_FOUND');
  return result;
}

describe('execution and system behavior', () => {
  it('executes with two distinct Jokers, permanently removes them, and never opens rescue', () => {
    const state = systemState({
      actorHand: [
        { kind: 'joker', id: 'joker-1' },
        { kind: 'joker', id: 'joker-2' },
        physical('keep', 'heart', 3),
      ],
    });
    const result = decide(state, {
      kind: 'game:execute-character',
      actionId: 'execute',
      expectedVersion: 0,
      playerId: 'actor',
      now: 2_000,
      jokerCardIds: ['joker-1', 'joker-2'],
      targetPlayerId: 'target',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.phase).toBe('PLAYING');
    expect(result.state.pendingDeath).toBeNull();
    expect(result.state.deck?.removedJokers.map((card) => card.id)).toEqual(['joker-1', 'joker-2']);
    expect(result.state.deck?.discardPile.map((card) => card.id)).toContain('target-card');
    expect(player(result.state, 'target').eliminated).toBe(true);
    expect(player(result.state, 'actor').hand).toHaveLength(4);
    expect(result.events.some((event) => event.kind === 'joker:rescue-started')).toBe(false);
    expect(result.events[0]).toEqual({
      kind: 'character:executed',
      attackerPlayerId: 'actor',
      victimPlayerId: 'target',
    });
  });

  it('requires two different Jokers actually held by the actor', () => {
    const state = systemState({ actorHand: [{ kind: 'joker', id: 'joker-1' }] });
    expect(
      decide(state, {
        kind: 'game:execute-character',
        actionId: 'same-joker',
        expectedVersion: 0,
        playerId: 'actor',
        now: 2_000,
        jokerCardIds: ['joker-1', 'joker-1'],
        targetPlayerId: 'target',
      }),
    ).toEqual({ ok: false, code: 'TWO_DISTINCT_JOKERS_REQUIRED' });
    expect(
      decide(state, {
        kind: 'game:execute-character',
        actionId: 'missing-joker',
        expectedVersion: 0,
        playerId: 'actor',
        now: 2_000,
        jokerCardIds: ['joker-1', 'joker-2'],
        targetPlayerId: 'target',
      }),
    ).toEqual({ ok: false, code: 'JOKER_NOT_IN_HAND' });
  });

  it('applies timeout direct to HP, discards one equally weighted entity, and does not supply', () => {
    const fused: HandEntity = {
      kind: 'fused',
      id: 'fused',
      sourceCardIds: ['source-a', 'source-5'],
      suit: 'spade',
      value: 6,
      bypassSuitImmunity: true,
    };
    const state = systemState({ actorHand: [physical('normal', 'heart', 2), fused] });
    const result = decide(state, {
      kind: 'system:turn-timeout',
      actionId: 'turn-timeout',
      expectedVersion: 0,
      playerId: 'actor',
      now: 31_001,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(player(result.state, 'actor').characters[0]).toMatchObject({ hp: 35, shield: 9 });
    expect(player(result.state, 'actor').hand).toHaveLength(1);
    expect(result.state.random.cursor).toBe(1);
    expect(result.events.filter((event) => event.kind === 'cards:drawn')).toHaveLength(0);
    expect(result.state.currentPlayerId).toBe('target');
  });

  it('opens rescue on lethal timeout with no kill reward or empty supply', () => {
    const state = systemState({ actorHp: 5, actorHand: [physical('last-card', 'heart', 2)] });
    const result = decide(state, {
      kind: 'system:turn-timeout',
      actionId: 'lethal-timeout',
      expectedVersion: 0,
      playerId: 'actor',
      now: 31_001,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.phase).toBe('WAITING_FOR_JOKER');
    expect(result.state.pendingDeath).toMatchObject({
      attackerPlayerId: 'actor',
      victimPlayerId: 'actor',
      rewardKiller: false,
      supplyAttacker: false,
    });
    expect(player(result.state, 'actor').hand).toHaveLength(0);
  });

  it('disconnects, rejects premature elimination, and reconnects at the deadline boundary', () => {
    const disconnected = decide(systemState(), {
      kind: 'system:player-disconnected',
      actionId: 'disconnect',
      expectedVersion: 0,
      playerId: 'target',
      now: 2_000,
    });
    if (!disconnected.ok) throw new Error(disconnected.code);
    expect(player(disconnected.state, 'target')).toMatchObject({
      connected: false,
      disconnectDeadline: 32_000,
    });
    expect(
      decide(disconnected.state, {
        kind: 'system:disconnect-timeout',
        actionId: 'early-disconnect-timeout',
        expectedVersion: 1,
        playerId: 'target',
        now: 32_000,
      }),
    ).toEqual({ ok: false, code: 'DISCONNECT_DEADLINE_NOT_REACHED' });

    const reconnected = decide(disconnected.state, {
      kind: 'system:player-reconnected',
      actionId: 'reconnect',
      expectedVersion: 1,
      playerId: 'target',
      now: 32_000,
    });
    expect(reconnected.ok).toBe(true);
    if (reconnected.ok) {
      expect(player(reconnected.state, 'target')).toMatchObject({
        connected: true,
        disconnectDeadline: null,
      });
    }
  });

  it('eliminates on disconnect timeout before an equal turn timeout can run', () => {
    const base = systemState();
    const state: GameState = {
      ...base,
      turnDeadline: 32_000,
      players: base.players.map((candidate) =>
        candidate.id === 'actor'
          ? { ...candidate, connected: false, disconnectDeadline: 32_000 }
          : candidate,
      ),
    };
    const eliminated = decide(state, {
      kind: 'system:disconnect-timeout',
      actionId: 'disconnect-first',
      expectedVersion: 0,
      playerId: 'actor',
      now: 32_001,
    });
    expect(eliminated.ok).toBe(true);
    if (!eliminated.ok) return;
    expect(player(eliminated.state, 'actor').eliminated).toBe(true);
    expect(eliminated.state.currentPlayerId).toBe('target');
    expect(
      decide(eliminated.state, {
        kind: 'system:turn-timeout',
        actionId: 'stale-turn-timeout',
        expectedVersion: 0,
        playerId: 'actor',
        now: 32_001,
      }),
    ).toEqual({ ok: false, code: 'STALE_GAME_VERSION' });
  });

  it('replays disconnect and reconnect commands to the identical state', () => {
    const initial: CreateGameInput = {
      id: 'connection-replay',
      mode: 'quick',
      seed: 'connection-seed',
      now: 1_000,
      players: [
        { id: 'p1', displayName: '一号#A001' },
        { id: 'p2', displayName: '二号#B002' },
        { id: 'p3', displayName: '三号#C003' },
      ],
    };
    let state = createGame(initial);
    const target = state.players.find((candidate) => candidate.id !== state.currentPlayerId);
    if (!target) throw new Error('TEST_TARGET_NOT_FOUND');
    const disconnected = decide(state, {
      kind: 'system:player-disconnected',
      actionId: 'replay-disconnect',
      expectedVersion: 0,
      playerId: target.id,
      now: 2_000,
    });
    if (!disconnected.ok) throw new Error(disconnected.code);
    state = disconnected.state;
    const reconnected = decide(state, {
      kind: 'system:player-reconnected',
      actionId: 'replay-reconnect',
      expectedVersion: 1,
      playerId: target.id,
      now: 3_000,
    });
    if (!reconnected.ok) throw new Error(reconnected.code);
    state = reconnected.state;
    expect(replayCommands({ initial, commands: state.acceptedCommands })).toEqual(state);
  });

  it('leaves immediately without a reconnect window or reward', () => {
    const result = decide(systemState(), {
      kind: 'game:leave-match',
      actionId: 'leave',
      expectedVersion: 0,
      playerId: 'target',
      now: 2_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(player(result.state, 'target')).toMatchObject({
      eliminated: true,
      connected: false,
      disconnectDeadline: null,
    });
    expect(result.events).toContainEqual({
      kind: 'player:eliminated',
      playerId: 'target',
      reason: 'left',
    });
    expect(
      result.events.some(
        (event) => event.kind === 'cards:drawn' && event.reason === 'elimination-reward',
      ),
    ).toBe(false);
  });
});
