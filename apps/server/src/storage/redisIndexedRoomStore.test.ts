import { createGame } from '@pokewar/domain';
import { describe, expect, it } from 'vitest';
import type { RoomState } from '../rooms/model.js';
import { RedisIndexedRoomStore, type RedisIndexedRoomClient } from './redisIndexedRoomStore.js';

class FakeRedis implements RedisIndexedRoomClient {
  readonly values = new Map<string, string>();
  lastEval: { script: string; keys: readonly string[]; arguments: readonly string[] } | null = null;

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<number> {
    this.lastEval = { script, ...options };
    const roomKey = options.keys[0];
    const payload = options.arguments[0];
    if (script.includes("redis.call('SET'")) {
      if (roomKey && payload) this.values.set(roomKey, payload);
    } else if (roomKey) {
      this.values.delete(roomKey);
    }
    return Promise.resolve(1);
  }
}

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

describe('RedisIndexedRoomStore', () => {
  it('atomically writes an active room and its derived deadlines', async () => {
    const redis = new FakeRedis();
    const store = new RedisIndexedRoomStore(redis, 'test:');
    const game = createGame({
      id: 'ROOM1',
      mode: 'normal',
      seed: 'redis-deadlines',
      now: 1_000,
      players: [
        { id: 'p1', displayName: 'One' },
        { id: 'p2', displayName: 'Two' },
      ],
    });
    await store.save(room(game));

    expect(await store.get('ROOM1')).toEqual(room(game));
    expect(redis.lastEval?.keys).toEqual([
      'test:room:ROOM1',
      'test:deadlines',
      'test:deadline-room:ROOM1',
    ]);
    expect(redis.lastEval?.arguments[1]).toBe('86400');
    expect(
      redis.lastEval?.arguments.filter((value) => value.includes('"kind":"starter"')),
    ).toHaveLength(2);
  });

  it('removes the room and its index members in one script', async () => {
    const redis = new FakeRedis();
    const store = new RedisIndexedRoomStore(redis, 'test:');
    await store.save(room(null));
    await store.delete('ROOM1');
    expect(await store.get('ROOM1')).toBeNull();
    expect(redis.lastEval?.script).toContain("redis.call('ZREM'");
  });
});
