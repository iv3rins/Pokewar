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

const character = (
  id: string,
  suit: Suit,
  overrides: Partial<CharacterState> = {},
): CharacterState => ({
  id,
  rank: 'Q',
  suit,
  hp: 40,
  shield: 0,
  eliminated: false,
  ...overrides,
});

function controlledState(
  actorHand: readonly HandEntity[],
  options: {
    readonly actorSuit?: Suit;
    readonly targetSuit?: Suit;
    readonly targetHp?: number;
    readonly targetShield?: number;
  } = {},
): GameState {
  const actorCharacter = character('actor-Q', options.actorSuit ?? 'heart');
  const targetCharacter = character('target-Q', options.targetSuit ?? 'spade', {
    hp: options.targetHp ?? 40,
    shield: options.targetShield ?? 0,
  });
  const players: readonly GamePlayer[] = [
    {
      id: 'actor',
      displayName: '攻击者#A001',
      originalJoinIndex: 0,
      seat: 0,
      characters: [actorCharacter],
      activeCharacterId: actorCharacter.id,
      hand: actorHand,
      eliminated: false,
      connected: true,
      disconnectDeadline: null,
    },
    {
      id: 'target',
      displayName: '目标#B002',
      originalJoinIndex: 1,
      seat: 1,
      characters: [targetCharacter],
      activeCharacterId: targetCharacter.id,
      hand: [],
      eliminated: false,
      connected: true,
      disconnectDeadline: null,
    },
  ];
  const deck: DeckState = {
    drawPile: [
      physical('draw-1', 'heart', 2),
      physical('draw-2', 'diamond', 3),
      physical('draw-3', 'club', 4),
      physical('draw-4', 'spade', 5),
      physical('draw-5', 'heart', 6),
      physical('draw-6', 'diamond', 7),
    ],
    discardPile: [],
    removedJokers: [],
  };
  return {
    id: 'controlled-game',
    domainVersion: 1,
    version: 0,
    mode: 'quick',
    phase: 'PLAYING',
    players,
    deck,
    currentPlayerId: 'actor',
    turnDeadline: 31_000,
    starterDeadlines: [],
    pendingDeath: null,
    random: { seed: 'controlled-seed', cursor: 0 },
    acceptedCommands: [],
  };
}

function player(state: GameState, id: string): GamePlayer {
  const result = state.players.find((candidate) => candidate.id === id);
  if (!result) throw new Error('TEST_PLAYER_NOT_FOUND');
  return result;
}

describe('PLAYING commands', () => {
  it('creates an irreversible fused hand entity without ending or extending the turn', () => {
    const state = controlledState([
      physical('ace-heart', 'heart', 'A'),
      physical('five-spade', 'spade', 5),
      physical('keep', 'club', 7),
    ]);
    const result = decide(state, {
      kind: 'game:create-fusion',
      actionId: 'fusion-1',
      expectedVersion: 0,
      playerId: 'actor',
      now: 2_000,
      cardIds: ['ace-heart', 'five-spade'],
      selectedSuit: 'spade',
      fusedCardId: 'fused-6',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.version).toBe(1);
    expect(result.state.currentPlayerId).toBe('actor');
    expect(result.state.turnDeadline).toBe(31_000);
    expect(player(result.state, 'actor').hand).toEqual([
      physical('keep', 'club', 7),
      {
        kind: 'fused',
        id: 'fused-6',
        sourceCardIds: ['ace-heart', 'five-spade'],
        suit: 'spade',
        value: 6,
        bypassSuitImmunity: true,
      },
    ]);
    expect(result.state.deck?.discardPile.map((card) => card.id)).toEqual([
      'ace-heart',
      'five-spade',
    ]);
    expect(result.events[0]).toMatchObject({
      kind: 'fusion:created',
      card: { fused: true, value: 6 },
    });
  });

  it('plays a fused entity in a three-card combination and bypasses same-suit immunity', () => {
    const fused: HandEntity = {
      kind: 'fused',
      id: 'fused-6',
      sourceCardIds: ['ace-heart', 'five-spade'],
      suit: 'spade',
      value: 6,
      bypassSuitImmunity: true,
    };
    const state = controlledState([
      fused,
      physical('spade-2', 'spade', 2),
      physical('spade-3', 'spade', 3),
    ]);
    const result = decide(state, {
      kind: 'game:play-cards',
      actionId: 'play-1',
      expectedVersion: 0,
      playerId: 'actor',
      now: 2_000,
      cardIds: ['fused-6', 'spade-2', 'spade-3'],
      targetPlayerId: 'target',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(player(result.state, 'target').characters[0]).toMatchObject({ hp: 18, shield: 0 });
    expect(result.state.deck?.discardPile.map((card) => card.id)).toEqual(['spade-2', 'spade-3']);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'cards:played',
        totalValue: 11,
        bypassSuitImmunity: true,
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'combat:resolved',
        hpLost: 22,
        immuneToSuitEffect: false,
      }),
    );
    expect(result.state.currentPlayerId).toBe('target');
    expect(result.state.turnDeadline).toBe(32_000);
  });

  it('rejects invalid targets, duplicate IDs, foreign cards, and expired turns', () => {
    const card = physical('heart-5', 'heart', 5);
    const state = controlledState([card]);
    const base = {
      kind: 'game:play-cards' as const,
      expectedVersion: 0,
      playerId: 'actor',
      now: 2_000,
      cardIds: ['heart-5'] as const,
    };
    expect(decide(state, { ...base, actionId: 'missing-target' })).toEqual({
      ok: false,
      code: 'TARGET_REQUIRED',
    });
    expect(decide(state, { ...base, actionId: 'self-target', targetPlayerId: 'actor' })).toEqual({
      ok: false,
      code: 'TARGET_NOT_ALLOWED',
    });
    expect(decide(state, { ...base, actionId: 'bad-target', targetPlayerId: 'missing' })).toEqual({
      ok: false,
      code: 'INVALID_TARGET',
    });
    expect(
      decide(state, {
        ...base,
        actionId: 'foreign-card',
        cardIds: ['missing'],
        targetPlayerId: 'target',
      }),
    ).toEqual({ ok: false, code: 'CARD_NOT_IN_HAND' });
    expect(
      decide(state, {
        ...base,
        actionId: 'expired',
        now: 31_001,
        targetPlayerId: 'target',
      }),
    ).toEqual({ ok: false, code: 'DEADLINE_EXPIRED' });
  });

  it('treats clubs as targetless defense, discards the card, then supplies an empty hand', () => {
    const state = controlledState([physical('club-7', 'club', 7)], { actorSuit: 'club' });
    const result = decide(state, {
      kind: 'game:play-cards',
      actionId: 'club-defense',
      expectedVersion: 0,
      playerId: 'actor',
      now: 2_000,
      cardIds: ['club-7'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(player(result.state, 'actor').characters[0]).toMatchObject({ shield: 7, hp: 40 });
    expect(player(result.state, 'actor').hand).toHaveLength(3);
    expect(result.state.deck?.discardPile.map((card) => card.id)).toContain('club-7');
    expect(result.events).toContainEqual({
      kind: 'cards:drawn',
      playerId: 'actor',
      count: 3,
      reason: 'empty-supply',
    });
    expect(result.state.currentPlayerId).toBe('target');
  });

  it('distributes diamond draws from the attacker and skips a full hand', () => {
    const fullTarget = Array.from({ length: 7 }, (_, index) =>
      physical(`full-${String(index)}`, 'club', 2),
    );
    const state = {
      ...controlledState([physical('diamond-3', 'diamond', 3)], { targetSuit: 'heart' }),
      players: controlledState([physical('diamond-3', 'diamond', 3)]).players.map((candidate) =>
        candidate.id === 'target' ? { ...candidate, hand: fullTarget } : candidate,
      ),
    };
    const result = decide(state, {
      kind: 'game:play-cards',
      actionId: 'diamond',
      expectedVersion: 0,
      playerId: 'actor',
      now: 2_000,
      cardIds: ['diamond-3'],
      targetPlayerId: 'target',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(player(result.state, 'target').hand).toHaveLength(7);
    expect(player(result.state, 'actor').hand).toHaveLength(3);
    expect(
      result.events.filter((event) => event.kind === 'cards:drawn' && event.reason === 'diamond'),
    ).toHaveLength(3);
    expect(
      result.events.some(
        (event) => event.kind === 'cards:drawn' && event.reason === 'empty-supply',
      ),
    ).toBe(false);
  });

  it('enters an ordered Joker rescue phase and persists deferred diamond context on lethal damage', () => {
    const state = controlledState([physical('diamond-5', 'diamond', 5)], {
      targetSuit: 'heart',
      targetHp: 4,
    });
    const result = decide(state, {
      kind: 'game:play-cards',
      actionId: 'lethal-diamond',
      expectedVersion: 0,
      playerId: 'actor',
      now: 2_000,
      cardIds: ['diamond-5'],
      targetPlayerId: 'target',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.phase).toBe('WAITING_FOR_JOKER');
    expect(result.state.turnDeadline).toBeNull();
    expect(result.state.pendingDeath).toEqual({
      attackerPlayerId: 'actor',
      victimPlayerId: 'target',
      attackerSeat: 0,
      diamondDrawCount: 5,
      rewardKiller: true,
      supplyAttacker: true,
      rescueQueue: ['target', 'actor'],
      rescueIndex: 0,
      rescueDeadline: 7_000,
      replacementDeadline: null,
    });
    expect(player(result.state, 'actor').hand).toHaveLength(0);
    expect(result.events.at(-1)).toEqual({
      kind: 'joker:rescue-started',
      victimPlayerId: 'target',
      offeredPlayerId: 'target',
      deadline: 7_000,
    });
  });

  it('replays a real dealt-card play to the identical state', () => {
    const initial: CreateGameInput = {
      id: 'replay-playing',
      mode: 'quick',
      seed: 'playing-replay-seed',
      now: 1_000,
      players: [
        { id: 'p1', displayName: '一号#A001' },
        { id: 'p2', displayName: '二号#B002' },
      ],
    };
    const game = createGame(initial);
    const actor = player(game, game.currentPlayerId ?? '');
    const target = game.players.find((candidate) => candidate.id !== actor.id);
    const playable = actor.hand.find((card): card is PhysicalCard => card.kind === 'physical');
    if (!target || !playable) throw new Error('TEST_PLAY_NOT_AVAILABLE');
    const command = {
      kind: 'game:play-cards' as const,
      actionId: 'replay-play',
      expectedVersion: 0,
      playerId: actor.id,
      now: 2_000,
      cardIds: [playable.id] as const,
      ...(playable.suit === 'club' ? {} : { targetPlayerId: target.id }),
    };
    const result = decide(game, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(replayCommands({ initial, commands: result.state.acceptedCommands })).toEqual(
      result.state,
    );
  });
});
