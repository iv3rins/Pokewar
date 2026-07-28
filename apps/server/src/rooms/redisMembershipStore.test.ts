import { describe, expect, it } from 'vitest';
import { RedisRoomMembershipStore, type RedisMembershipClient } from './redisMembershipStore.js';

class FakeRedis implements RedisMembershipClient {
  readonly values = new Map<string, string>();
  expiry = 0;
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }
  set(key: string, value: string, options: { EX: number }): Promise<'OK'> {
    this.values.set(key, value);
    this.expiry = options.EX;
    return Promise.resolve('OK');
  }
  del(key: string): Promise<number> {
    return Promise.resolve(this.values.delete(key) ? 1 : 0);
  }
}

describe('RedisRoomMembershipStore', () => {
  it('maps identities to reconnectable rooms for the active-room lifetime', async () => {
    const redis = new FakeRedis();
    const store = new RedisRoomMembershipStore(redis, 'test:');
    await store.set('guest-1', 'A2BCD');
    expect(await store.get('guest-1')).toBe('A2BCD');
    expect(redis.expiry).toBe(86_400);
    await store.delete('guest-1');
    expect(await store.get('guest-1')).toBeNull();
  });
});
