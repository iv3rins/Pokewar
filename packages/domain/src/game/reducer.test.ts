import { describe, expect, it } from 'vitest';
import { createGame } from './create.js';
import { CHARACTER_MAX_HP } from '../model/characters.js';
import type { CreateGameInput, GameState } from './model.js';
import { decide } from './reducer.js';
import { replayCommands } from './replay.js';

const initial = (): CreateGameInput => ({
  id: 'game-1',
  mode: 'normal',
  players: [
    { id: 'p1', displayName: '青石#A7K2' },
    { id: 'p2', displayName: '白檀#B8M3' },
    { id: 'p3', displayName: '赤铜#C9N4' },
  ],
  seed: 'secure-server-seed',
  now: 1_000,
});

function selectStarter(state: GameState, playerId: string, actionId: string, now = 2_000) {
  const player = state.players.find((candidate) => candidate.id === playerId);
  const character = player?.characters[0];
  if (!character) throw new Error('TEST_CHARACTER_NOT_FOUND');
  return decide(state, {
    kind: 'game:select-starter',
    actionId,
    expectedVersion: state.version,
    playerId,
    characterId: character.id,
    now,
  });
}

describe('starter selection state machine', () => {
  it('starts quick mode immediately with one random uncompensated character per player', () => {
    const quickInput: CreateGameInput = { ...initial(), mode: 'quick' };
    const game = createGame(quickInput);

    expect(game.phase).toBe('PLAYING');
    expect(game.version).toBe(0);
    expect(game.starterDeadlines).toEqual([]);
    expect(game.players.every((player) => player.characters.length === 1)).toBe(true);
    expect(
      game.players.every((player) => player.activeCharacterId === player.characters[0]?.id),
    ).toBe(true);
    expect(
      game.players.every((player) => {
        const character = player.characters[0];
        return character?.hp === (character ? CHARACTER_MAX_HP[character.rank] : undefined);
      }),
    ).toBe(true);
    expect(game.players.every((player) => player.hand.length === 5 && player.seat !== null)).toBe(
      true,
    );
    expect(game.currentPlayerId).not.toBeNull();
    expect(game.turnDeadline).toBe(31_000);
    expect(createGame(quickInput)).toEqual(game);
    expect(replayCommands({ initial: quickInput, commands: [] })).toEqual(game);
  });

  it('creates independent hidden characters but no hands or seats before selection completes', () => {
    const game = createGame(initial());
    expect(game.phase).toBe('SELECTING_STARTER');
    expect(game.players.every((player) => player.characters.length === 3)).toBe(true);
    expect(game.players.every((player) => player.hand.length === 0 && player.seat === null)).toBe(
      true,
    );
    expect(game.deck).toBeNull();
    expect(game.currentPlayerId).toBeNull();
    expect(createGame(initial())).toEqual(game);
  });

  it('reveals starters, randomizes seats, deals round-robin, and starts one atomic turn', () => {
    let state = createGame(initial());
    const first = selectStarter(state, 'p1', 'action-1');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    expect(state.phase).toBe('SELECTING_STARTER');
    expect(state.players.every((player) => player.hand.length === 0)).toBe(true);

    const second = selectStarter(state, 'p2', 'action-2');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    state = second.state;

    const third = selectStarter(state, 'p3', 'action-3');
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    state = third.state;

    expect(state.version).toBe(3);
    expect(state.phase).toBe('PLAYING');
    expect(state.players.map((player) => player.seat).sort()).toEqual([0, 1, 2]);
    expect(state.players.every((player) => player.hand.length === 5)).toBe(true);
    expect(state.deck?.drawPile).toHaveLength(27);
    expect(state.currentPlayerId).not.toBeNull();
    expect(state.turnDeadline).toBe(32_000);
    expect(third.events.map((event) => event.kind)).toEqual([
      'starter:selected',
      'starters:revealed',
      'seats:assigned',
      'initial-hands:dealt',
      'turn:started',
    ]);
  });

  it('auto-selects only after the private deadline', () => {
    const state = createGame(initial());
    const early = decide(state, {
      kind: 'system:starter-timeout',
      actionId: 'timeout-early',
      expectedVersion: 0,
      playerId: 'p1',
      now: 16_000,
    });
    expect(early).toEqual({ ok: false, code: 'DEADLINE_NOT_REACHED' });

    const timedOut = decide(state, {
      kind: 'system:starter-timeout',
      actionId: 'timeout-valid',
      expectedVersion: 0,
      playerId: 'p1',
      now: 16_001,
    });
    expect(timedOut.ok).toBe(true);
    if (timedOut.ok) {
      expect(
        timedOut.state.players.find((player) => player.id === 'p1')?.activeCharacterId,
      ).not.toBeNull();
      expect(timedOut.events[0]?.kind).toBe('starter:auto-selected');
    }
  });

  it('rejects late, stale, and duplicate player commands', () => {
    const state = createGame(initial());
    const player = state.players[0];
    const character = player?.characters[0];
    if (!player || !character) throw new Error('TEST_PLAYER_NOT_FOUND');

    expect(
      decide(state, {
        kind: 'game:select-starter',
        actionId: 'late',
        expectedVersion: 0,
        playerId: player.id,
        characterId: character.id,
        now: 16_001,
      }),
    ).toEqual({ ok: false, code: 'DEADLINE_EXPIRED' });

    expect(
      decide(state, {
        kind: 'game:select-starter',
        actionId: 'stale',
        expectedVersion: 9,
        playerId: player.id,
        characterId: character.id,
        now: 2_000,
      }),
    ).toEqual({ ok: false, code: 'STALE_GAME_VERSION' });

    const accepted = selectStarter(state, player.id, 'same-action');
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(
        decide(accepted.state, {
          kind: 'game:select-starter',
          actionId: 'same-action',
          expectedVersion: accepted.state.version,
          playerId: 'p2',
          characterId: accepted.state.players.find((p) => p.id === 'p2')?.characters[0]?.id ?? '',
          now: 2_000,
        }),
      ).toEqual({ ok: false, code: 'ACTION_ID_REUSED' });
    }
  });

  it('replays accepted commands to an identical state', () => {
    let state = createGame(initial());
    for (const [index, playerId] of ['p1', 'p2', 'p3'].entries()) {
      const result = selectStarter(state, playerId, `replay-${String(index)}`);
      if (!result.ok) throw new Error(result.code);
      state = result.state;
    }
    expect(replayCommands({ initial: initial(), commands: state.acceptedCommands })).toEqual(state);
  });
});
