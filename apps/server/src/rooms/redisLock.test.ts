import { describe, expect, it } from 'vitest';
import { RedisRoomLock, type RedisLockClient } from './redisLock.js';

class FakeRedisLock implements RedisLockClient {
  readonly sets: { key: string; value: string; options: { NX: true; PX: number } }[] = [];
  readonly evals: { script: string; keys: string[]; arguments: string[] }[] = [];

  set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null> {
    this.sets.push({ key, value, options });
    return Promise.resolve('OK');
  }

  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<number> {
    this.evals.push({ script, ...options });
    return Promise.resolve(1);
  }
}

describe('RedisRoomLock', () => {
  it('acquires with NX/PX and releases only through the token script', async () => {
    const redis = new FakeRedisLock();
    const lock = new RedisRoomLock(redis, 'test:', { leaseMs: 5_000 });
    await expect(lock.run('A2BCD', () => Promise.resolve('done'))).resolves.toBe('done');
    expect(redis.sets[0]).toMatchObject({
      key: 'test:lock:room:A2BCD',
      options: { NX: true, PX: 5_000 },
    });
    expect(redis.evals[0]?.keys).toEqual(['test:lock:room:A2BCD']);
    expect(redis.evals[0]?.arguments).toEqual([redis.sets[0]?.value]);
    expect(redis.evals[0]?.script).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
  });

  it('releases the lock when the room task throws', async () => {
    const redis = new FakeRedisLock();
    const lock = new RedisRoomLock(redis, 'test:');
    await expect(lock.run('A2BCD', () => Promise.reject(new Error('failure')))).rejects.toThrow(
      'failure',
    );
    expect(redis.evals).toHaveLength(1);
  });
});
