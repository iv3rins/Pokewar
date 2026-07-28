import { createGame } from '@pokewar/domain';
import { describe, expect, it } from 'vitest';
import type { RoomState } from '../rooms/model.js';
import { deadlineCommand, deadlineScore, extractDeadlines, type DeadlineTask } from './deadline.js';

function room(game: RoomState['game']): RoomState {
  return {
    id: 'ROOM1',
    version: 1,
    hostIdentityId: 'p1',
    mode: game?.mode ?? 'normal',
    members: [],
    bannedUntil: {},
    game,
    createdAt: 0,
    updatedAt: 0,
  };
}

function task(kind: DeadlineTask['kind']): DeadlineTask {
  return { id: kind, roomId: 'ROOM1', kind, playerId: 'p1', dueAt: 100, gameVersion: 4 };
}

describe('deadline derivation', () => {
  it('extracts unresolved starter deadlines from canonical state', () => {
    const game = createGame({
      id: 'ROOM1',
      mode: 'normal',
      players: [
        { id: 'p1', displayName: 'One' },
        { id: 'p2', displayName: 'Two' },
      ],
      seed: 'deadline-seed',
      now: 1_000,
    });

    expect(extractDeadlines(room(game))).toEqual([
      expect.objectContaining({ kind: 'starter', playerId: 'p1', dueAt: 16_000 }),
      expect.objectContaining({ kind: 'starter', playerId: 'p2', dueAt: 16_000 }),
    ]);
  });

  it('orders equal-time system deadlines by normative priority', () => {
    expect(
      (['turn', 'starter', 'rescue', 'disconnect'] as const)
        .map(task)
        .sort((a, b) => deadlineScore(a) - deadlineScore(b))
        .map((value) => value.kind),
    ).toEqual(['disconnect', 'rescue', 'starter', 'turn']);
  });

  it('creates deterministic system commands', () => {
    expect(deadlineCommand(task('turn'), 101)).toEqual({
      actionId: 'deadline:turn',
      expectedVersion: 4,
      playerId: 'p1',
      now: 101,
      kind: 'system:turn-timeout',
    });
  });
});
