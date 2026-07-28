import { describe, expect, it } from 'vitest';
import { GUEST_IDENTITY_TTL_SECONDS, type GuestIdentity } from './guest.js';
import { RedisGuestIdentityStore, type RedisIdentityClient } from './redisGuestStore.js';

class FakeRedisIdentity implements RedisIdentityClient {
  readonly values = new Map<string, string>();
  lastExpiry = 0;
  lastRefreshedExpiry = 0;

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, options: { EX: number }): Promise<'OK'> {
    this.values.set(key, value);
    this.lastExpiry = options.EX;
    return Promise.resolve('OK');
  }

  expire(_key: string, seconds: number): Promise<number> {
    this.lastRefreshedExpiry = seconds;
    return Promise.resolve(1);
  }
}

describe('RedisGuestIdentityStore', () => {
  it('shares signed guest identity records for thirty days', async () => {
    const redis = new FakeRedisIdentity();
    const store = new RedisGuestIdentityStore(redis, 'test:');
    const identity: GuestIdentity = {
      id: 'guest-1',
      kind: 'guest',
      nickname: '静默星轨',
      displayName: '静默星轨#A001',
    };
    await store.save(identity);
    expect(await store.get(identity.id)).toEqual(identity);
    expect(redis.values.has('test:identity:guest-1')).toBe(true);
    expect(redis.lastExpiry).toBe(GUEST_IDENTITY_TTL_SECONDS);
    expect(redis.lastRefreshedExpiry).toBe(GUEST_IDENTITY_TTL_SECONDS);
  });
});
