import { describe, expect, it } from 'vitest';
import { MemoryAccountRepository, type AccountRecord } from './accountRepository.js';

const account: AccountRecord = {
  identityId: 'identity-1',
  loginName: 'player_01',
  passwordHash: 'hash',
  nickname: '静默星轨',
  displayName: '静默星轨#A001',
  createdAt: 1,
};
const session = { tokenHash: 'token-1', createdAt: 1, expiresAt: 101 };

describe('MemoryAccountRepository', () => {
  it('registers one account per identity and unique login name', async () => {
    const repository = new MemoryAccountRepository();
    expect(await repository.register(account, session)).toBe('created');
    expect(await repository.register(account, { ...session, tokenHash: 'token-2' })).toBe(
      'identity-registered',
    );
    expect(
      await repository.register(
        { ...account, identityId: 'identity-2' },
        { ...session, tokenHash: 'token-3' },
      ),
    ).toBe('login-taken');
  });

  it('rolls valid sessions and rejects expired or revoked sessions', async () => {
    const repository = new MemoryAccountRepository();
    await repository.register(account, session);
    expect((await repository.resolveSession('token-1', 100, 200))?.identityId).toBe('identity-1');
    expect((await repository.resolveSession('token-1', 150, 250))?.identityId).toBe('identity-1');
    await repository.revokeSession('token-1');
    expect(await repository.resolveSession('token-1', 151, 251)).toBeNull();
  });
});
