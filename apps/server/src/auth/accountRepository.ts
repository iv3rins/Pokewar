export interface AccountRecord {
  readonly identityId: string;
  readonly loginName: string;
  readonly passwordHash: string;
  readonly nickname: string;
  readonly displayName: string;
  readonly createdAt: number;
}

export interface NewAccountSession {
  readonly tokenHash: string;
  readonly expiresAt: number;
  readonly createdAt: number;
}

export type RegisterAccountResult = 'created' | 'login-taken' | 'identity-registered';

export interface AccountRepository {
  register(account: AccountRecord, session: NewAccountSession): Promise<RegisterAccountResult>;
  findByLoginName(loginName: string): Promise<AccountRecord | null>;
  createSession(identityId: string, session: NewAccountSession): Promise<void>;
  resolveSession(
    tokenHash: string,
    now: number,
    nextExpiresAt: number,
  ): Promise<AccountRecord | null>;
  revokeSession(tokenHash: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryAccountRepository implements AccountRepository {
  readonly #accounts = new Map<string, AccountRecord>();
  readonly #loginNames = new Map<string, string>();
  readonly #sessions = new Map<string, { identityId: string; expiresAt: number }>();

  register(account: AccountRecord, session: NewAccountSession): Promise<RegisterAccountResult> {
    if (this.#accounts.has(account.identityId)) return Promise.resolve('identity-registered');
    if (this.#loginNames.has(account.loginName)) return Promise.resolve('login-taken');
    this.#accounts.set(account.identityId, account);
    this.#loginNames.set(account.loginName, account.identityId);
    this.#sessions.set(session.tokenHash, {
      identityId: account.identityId,
      expiresAt: session.expiresAt,
    });
    return Promise.resolve('created');
  }

  findByLoginName(loginName: string): Promise<AccountRecord | null> {
    const identityId = this.#loginNames.get(loginName);
    return Promise.resolve(identityId ? (this.#accounts.get(identityId) ?? null) : null);
  }

  createSession(identityId: string, session: NewAccountSession): Promise<void> {
    if (!this.#accounts.has(identityId)) return Promise.reject(new Error('ACCOUNT_NOT_FOUND'));
    this.#sessions.set(session.tokenHash, { identityId, expiresAt: session.expiresAt });
    return Promise.resolve();
  }

  resolveSession(
    tokenHash: string,
    now: number,
    nextExpiresAt: number,
  ): Promise<AccountRecord | null> {
    const session = this.#sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) {
      this.#sessions.delete(tokenHash);
      return Promise.resolve(null);
    }
    session.expiresAt = nextExpiresAt;
    return Promise.resolve(this.#accounts.get(session.identityId) ?? null);
  }

  revokeSession(tokenHash: string): Promise<void> {
    this.#sessions.delete(tokenHash);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.#accounts.clear();
    this.#loginNames.clear();
    this.#sessions.clear();
    return Promise.resolve();
  }
}
