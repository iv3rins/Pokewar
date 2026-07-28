import { describe, expect, it } from 'vitest';
import type { DeckState } from '../deck/deck.js';
import type { HandEntity, PhysicalCard, Suit } from '../model/cards.js';
import type { CharacterState } from '../model/characters.js';
import type { GamePlayer, GameState } from './model.js';
import { decide } from './reducer.js';

const physical = (id: string, suit: Suit, rank: PhysicalCard['rank']): PhysicalCard => ({
  kind: 'physical',
  id,
  suit,
  rank,
});

const character = (
  id: string,
  rank: CharacterState['rank'],
  suit: Suit,
  hp: number,
  eliminated = false,
): CharacterState => ({ id, rank, suit, hp, shield: hp === 0 ? 0 : 2, eliminated });

function waitingState(mode: GameState['mode'] = 'normal'): GameState {
  const actorCharacter = character('actor-K', 'K', 'diamond', 45);
  const victimActive = character('victim-J', 'J', 'heart', 0);
  const victimReserve = character('victim-Q', 'Q', 'club', 40);
  const actorHand: readonly HandEntity[] = [];
  const victimHand: readonly HandEntity[] = [physical('victim-card', 'spade', 4)];
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
      id: 'victim',
      displayName: '受害者#B002',
      originalJoinIndex: 1,
      seat: 1,
      characters: mode === 'normal' ? [victimActive, victimReserve] : [victimActive],
      activeCharacterId: victimActive.id,
      hand: victimHand,
      eliminated: false,
      connected: true,
      disconnectDeadline: null,
    },
    {
      id: 'rescuer',
      displayName: '救援者#C003',
      originalJoinIndex: 2,
      seat: 2,
      characters: [character('rescuer-Q', 'Q', 'spade', 40)],
      activeCharacterId: 'rescuer-Q',
      hand: [{ kind: 'joker', id: 'rescue-joker' }],
      eliminated: false,
      connected: true,
      disconnectDeadline: null,
    },
  ];
  const deck: DeckState = {
    drawPile: Array.from({ length: 20 }, (_, index) =>
      physical(`draw-${String(index)}`, 'club', 2),
    ),
    discardPile: [physical('played-diamond', 'diamond', 5)],
    removedJokers: [],
  };
  return {
    id: 'death-game',
    domainVersion: 1,
    version: 1,
    mode,
    phase: 'WAITING_FOR_JOKER',
    players,
    deck,
    currentPlayerId: 'actor',
    turnDeadline: null,
    starterDeadlines: [],
    pendingDeath: {
      attackerPlayerId: 'actor',
      victimPlayerId: 'victim',
      attackerSeat: 0,
      diamondDrawCount: 2,
      rewardKiller: true,
      supplyAttacker: true,
      rescueQueue: ['victim', 'rescuer', 'actor'],
      rescueIndex: 0,
      rescueDeadline: 7_000,
      replacementDeadline: null,
    },
    random: { seed: 'death-seed', cursor: 0 },
    acceptedCommands: [],
  };
}

function player(state: GameState, id: string): GamePlayer {
  const result = state.players.find((candidate) => candidate.id === id);
  if (!result) throw new Error('TEST_PLAYER_NOT_FOUND');
  return result;
}

describe('Joker and death resolution', () => {
  it('keeps each full five-second offer and advances after a decline', () => {
    const result = decide(waitingState(), {
      kind: 'game:decline-rescue',
      actionId: 'decline-victim',
      expectedVersion: 1,
      playerId: 'victim',
      now: 3_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pendingDeath).toMatchObject({ rescueIndex: 1, rescueDeadline: 8_000 });
    expect(result.events).toEqual([
      { kind: 'joker:rescue-declined', playerId: 'victim', reason: 'declined' },
      {
        kind: 'joker:rescue-started',
        victimPlayerId: 'victim',
        offeredPlayerId: 'rescuer',
        deadline: 8_000,
      },
    ]);
  });

  it('rejects early timeout and a rescue from anyone except the offered player', () => {
    const state = waitingState();
    expect(
      decide(state, {
        kind: 'system:rescue-offer-timeout',
        actionId: 'early',
        expectedVersion: 1,
        playerId: 'victim',
        now: 7_000,
      }),
    ).toEqual({ ok: false, code: 'DEADLINE_NOT_REACHED' });
    expect(
      decide(state, {
        kind: 'game:rescue-with-joker',
        actionId: 'wrong-player',
        expectedVersion: 1,
        playerId: 'rescuer',
        now: 3_000,
        jokerCardId: 'rescue-joker',
      }),
    ).toEqual({ ok: false, code: 'NOT_RESCUE_ACTOR' });
  });

  it('rescues with one Joker, resets the victim, then performs diamond without a kill reward', () => {
    const first = decide(waitingState(), {
      kind: 'game:decline-rescue',
      actionId: 'decline',
      expectedVersion: 1,
      playerId: 'victim',
      now: 3_000,
    });
    if (!first.ok) throw new Error(first.code);
    const result = decide(first.state, {
      kind: 'game:rescue-with-joker',
      actionId: 'rescue',
      expectedVersion: 2,
      playerId: 'rescuer',
      now: 4_000,
      jokerCardId: 'rescue-joker',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.phase).toBe('PLAYING');
    expect(result.state.pendingDeath).toBeNull();
    expect(player(result.state, 'victim').characters[0]).toMatchObject({
      hp: 30,
      shield: 0,
      eliminated: false,
    });
    expect(player(result.state, 'victim').hand).toHaveLength(6);
    expect(player(result.state, 'rescuer').hand).toHaveLength(0);
    expect(player(result.state, 'actor').hand).toHaveLength(1);
    expect(
      result.events.some(
        (event) => event.kind === 'cards:drawn' && event.reason === 'elimination-reward',
      ),
    ).toBe(false);
    expect(result.state.currentPlayerId).toBe('victim');
    expect(result.state.turnDeadline).toBe(34_000);
  });

  it('eliminates after a full decline pass, waits for private replacement, then resolves deferred effects', () => {
    let state = waitingState();
    for (const [index, playerId] of ['victim', 'rescuer', 'actor'].entries()) {
      const result = decide(state, {
        kind: 'game:decline-rescue',
        actionId: `decline-${String(index)}`,
        expectedVersion: state.version,
        playerId,
        now: 3_000 + index * 1_000,
      });
      if (!result.ok) throw new Error(result.code);
      state = result.state;
    }

    expect(state.phase).toBe('SELECTING_REPLACEMENT');
    expect(state.pendingDeath?.replacementDeadline).toBe(20_000);
    expect(player(state, 'victim').hand).toHaveLength(0);
    expect(player(state, 'actor').hand).toHaveLength(0);
    const reserve = player(state, 'victim').characters.find(
      (candidate) => candidate.id === 'victim-Q',
    );
    if (!reserve) throw new Error('TEST_RESERVE_NOT_FOUND');

    const replacement = decide(state, {
      kind: 'game:select-replacement',
      actionId: 'replacement',
      expectedVersion: state.version,
      playerId: 'victim',
      characterId: reserve.id,
      now: 6_000,
    });
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;

    expect(replacement.state.phase).toBe('PLAYING');
    expect(player(replacement.state, 'victim').activeCharacterId).toBe('victim-Q');
    expect(player(replacement.state, 'victim').hand).toHaveLength(6);
    expect(player(replacement.state, 'actor').hand).toHaveLength(4);
    const reasons = replacement.events
      .filter((event) => event.kind === 'cards:drawn')
      .map((event) => event.reason);
    expect(reasons).toEqual(['replacement', 'diamond', 'diamond', 'elimination-reward']);
    expect(replacement.state.currentPlayerId).toBe('victim');
  });

  it('eliminates a quick-mode character directly and continues with multiple survivors', () => {
    let state = waitingState('quick');
    for (const [index, playerId] of ['victim', 'rescuer', 'actor'].entries()) {
      const result = decide(state, {
        kind: 'game:decline-rescue',
        actionId: `quick-decline-${String(index)}`,
        expectedVersion: state.version,
        playerId,
        now: 3_000 + index * 1_000,
      });
      if (!result.ok) throw new Error(result.code);
      state = result.state;
    }
    expect(state.phase).toBe('PLAYING');
    expect(player(state, 'victim').eliminated).toBe(true);
    expect(player(state, 'actor').hand.length).toBeGreaterThan(0);
  });

  it('ends a two-survivor quick match after the victim is not rescued', () => {
    const base = waitingState('quick');
    let state: GameState = {
      ...base,
      players: base.players.map((candidate) =>
        candidate.id === 'rescuer' ? { ...candidate, eliminated: true } : candidate,
      ),
      pendingDeath: base.pendingDeath
        ? { ...base.pendingDeath, rescueQueue: ['victim', 'actor'] }
        : null,
    };
    for (const [index, playerId] of ['victim', 'actor'].entries()) {
      const result = decide(state, {
        kind: 'game:decline-rescue',
        actionId: `final-decline-${String(index)}`,
        expectedVersion: state.version,
        playerId,
        now: 3_000 + index * 1_000,
      });
      if (!result.ok) throw new Error(result.code);
      state = result.state;
    }
    expect(state.phase).toBe('GAME_OVER');
    expect(state.pendingDeath).toBeNull();
    expect(state.currentPlayerId).toBeNull();
    expect(state.acceptedCommands.at(-1)?.version).toBe(state.version);
  });

  it('selects a replacement deterministically after the deadline', () => {
    let state = waitingState();
    for (const [index, playerId] of ['victim', 'rescuer', 'actor'].entries()) {
      const result = decide(state, {
        kind: 'game:decline-rescue',
        actionId: `auto-decline-${String(index)}`,
        expectedVersion: state.version,
        playerId,
        now: 3_000 + index * 1_000,
      });
      if (!result.ok) throw new Error(result.code);
      state = result.state;
    }
    const cursor = state.random.cursor;
    const result = decide(state, {
      kind: 'system:replacement-timeout',
      actionId: 'replacement-timeout',
      expectedVersion: state.version,
      playerId: 'victim',
      now: 20_001,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.random.cursor).toBe(cursor + 1);
    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: 'replacement:selected', automatic: true }),
    );
  });
});
