import { describe, expect, it } from 'vitest';
import { MemoryLoginRateLimit } from './loginRateLimit.js';

describe('login failure limiter', () => {
  it('blocks the sixth attempt for fifteen minutes and clears on success', async () => {
    const limiter = new MemoryLoginRateLimit();
    for (let index = 0; index < 5; index += 1) await limiter.recordFailure('ip:user', 1_000);
    expect(await limiter.isBlocked('ip:user', 1_001)).toBe(true);
    expect(await limiter.isBlocked('ip:user', 901_001)).toBe(false);
    await limiter.recordFailure('ip:user', 902_000);
    await limiter.clear('ip:user');
    expect(await limiter.isBlocked('ip:user', 902_001)).toBe(false);
  });
});
