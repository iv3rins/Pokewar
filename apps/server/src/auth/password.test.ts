import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('scrypt password storage', () => {
  it('uses unique salts and verifies only the original password', async () => {
    const first = await hashPassword('secure123', 1_024);
    const second = await hashPassword('secure123', 1_024);
    expect(first).not.toBe(second);
    expect(await verifyPassword('secure123', first)).toBe(true);
    expect(await verifyPassword('wrong123', first)).toBe(false);
  });

  it('rejects malformed encoded hashes', async () => {
    expect(await verifyPassword('secure123', 'invalid')).toBe(false);
  });
});
