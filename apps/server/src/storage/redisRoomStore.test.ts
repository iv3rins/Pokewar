import { createGame } from '@pokewar/domain';
import { describe, expect, it } from 'vitest';
import type { RoomState } from '../rooms/model.js';
import { RedisRoomStore, type RedisRoomClient } from './redisRoomStore.js';

class FakeRedis implements RedisRoomClient {
  readonly values = new Map<string, string>();
  readonly expiries = new Map<string, number>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, options?: { EX?: number }): Promise<'OK'> {
    this.values.set(key, value);
    if (options?.EX) this.expiries.set(key, options.EX);
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    const existed = this.values.delete(key);
    return Promise.resolve(existed ? 1 : 0);
  }
}

function room(game: RoomState['game'] = null): RoomState {
  return {
    id: 'A2BCD',
    version: 0,
    hostIdentityId: 'host',
    mode: 'quick',
    members: [],
    bannedUntil: {},
    game,
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

describe('RedisRoomStore', () => {
  it('round-trips rooms under the configured prefix', async () => {
    const redis = new FakeRedis();
    const store = new RedisRoomStore(redis, 'test:');
    await store.save(room());
    expect(await store.get('A2BCD')).toEqual(room());
    expect(redis.expiries.get('test:room:A2BCD')).toBe(1_800);
    await store.delete('A2BCD');
    expect(await store.get('A2BCD')).toBeNull();
  });

  it('uses active and finished room TTLs', async () => {
    const redis = new FakeRedis();
    const store = new RedisRoomStore(redis, 'test:');
    const active = createGame({
      id: 'A2BCD',
      mode: 'quick',
      seed: 'seed',
      now: 1_000,
      players: [
        { id: 'p1', displayName: '一号' },
        { id: 'p2', displayName: '二号' },
      ],
    });
    await store.save(room(active));
    expect(redis.expiries.get('test:room:A2BCD')).toBe(86_400);
    await store.save(room({ ...active, phase: 'GAME_OVER' }));
    expect(redis.expiries.get('test:room:A2BCD')).toBe(600);
  });
});
