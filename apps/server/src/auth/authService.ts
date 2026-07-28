import {
  composePublicName,
  type LoginAccountInput,
  type RegisterAccountInput,
} from '@pokewar/protocol';
import type { GuestIdentity, GuestIdentityStore } from '../identity/guest.js';
import type { AccountRecord, AccountRepository } from './accountRepository.js';
import { hashPassword, verifyPassword } from './password.js';
import { ACCOUNT_SESSION_TTL_MS, createAccountSessionToken, hashSessionToken } from './session.js';

const DUMMY_PASSWORD_HASH =
  'scrypt$v1$16384$8$1$cG9rZXdhci1hdXRoLWR1bW15$pDzuJ5Skx775slVld5cbbF7xZGoxPO7iP6bBDGmHU3Q';

export type AuthResult =
  | { readonly ok: true; readonly identity: GuestIdentity; readonly token: string }
  | {
      readonly ok: false;
      readonly code: 'LOGIN_NAME_TAKEN' | 'IDENTITY_ALREADY_REGISTERED' | 'INVALID_CREDENTIALS';
    };

function accountIdentity(account: AccountRecord): GuestIdentity {
  return {
    id: account.identityId,
    kind: 'account',
    nickname: account.nickname,
    displayName: account.displayName,
  };
}

export class AuthService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly identities: GuestIdentityStore,
  ) {}

  async register(
    guest: GuestIdentity,
    input: RegisterAccountInput,
    now: number,
  ): Promise<AuthResult> {
    if (guest.kind !== 'guest') return { ok: false, code: 'IDENTITY_ALREADY_REGISTERED' };
    const token = createAccountSessionToken();
    const nickname = composePublicName(input.prefix, input.noun);
    const account: AccountRecord = {
      identityId: guest.id,
      loginName: input.loginName,
      passwordHash: await hashPassword(input.password),
      nickname,
      displayName: `${nickname}#${guest.displayName.split('#').at(-1) ?? 'USER'}`,
      createdAt: now,
    };
    const result = await this.accounts.register(account, {
      tokenHash: hashSessionToken(token),
      createdAt: now,
      expiresAt: now + ACCOUNT_SESSION_TTL_MS,
    });
    if (result !== 'created') {
      return {
        ok: false,
        code: result === 'login-taken' ? 'LOGIN_NAME_TAKEN' : 'IDENTITY_ALREADY_REGISTERED',
      };
    }
    const identity = accountIdentity(account);
    await this.identities.save(identity);
    return { ok: true, identity, token };
  }

  async login(input: LoginAccountInput, now: number): Promise<AuthResult> {
    const account = await this.accounts.findByLoginName(input.loginName);
    const validPassword = await verifyPassword(
      input.password,
      account?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!account || !validPassword) {
      return { ok: false, code: 'INVALID_CREDENTIALS' };
    }
    const token = createAccountSessionToken();
    await this.accounts.createSession(account.identityId, {
      tokenHash: hashSessionToken(token),
      createdAt: now,
      expiresAt: now + ACCOUNT_SESSION_TTL_MS,
    });
    const identity = accountIdentity(account);
    await this.identities.save(identity);
    return { ok: true, identity, token };
  }

  async resolve(token: string, now: number): Promise<GuestIdentity | null> {
    const account = await this.accounts.resolveSession(
      hashSessionToken(token),
      now,
      now + ACCOUNT_SESSION_TTL_MS,
    );
    if (!account) return null;
    const identity = accountIdentity(account);
    await this.identities.save(identity);
    return identity;
  }

  revoke(token: string): Promise<void> {
    return this.accounts.revokeSession(hashSessionToken(token));
  }
}
