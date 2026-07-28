import type { Pool, PoolClient } from 'pg';
import type {
  AccountRecord,
  AccountRepository,
  NewAccountSession,
  RegisterAccountResult,
} from './accountRepository.js';

interface AccountRow {
  readonly identity_id: string;
  readonly login_name: string;
  readonly password_hash: string;
  readonly nickname: string;
  readonly display_name: string;
  readonly created_at: Date;
}

function account(row: AccountRow): AccountRecord {
  return {
    identityId: row.identity_id,
    loginName: row.login_name,
    passwordHash: row.password_hash,
    nickname: row.nickname,
    displayName: row.display_name,
    createdAt: row.created_at.getTime(),
  };
}

async function insertSession(
  client: Pool | PoolClient,
  identityId: string,
  session: NewAccountSession,
): Promise<void> {
  await client.query(
    `INSERT INTO account_sessions (token_hash, identity_id, expires_at, created_at, last_used_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [session.tokenHash, identityId, new Date(session.expiresAt), new Date(session.createdAt)],
  );
}

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async register(
    record: AccountRecord,
    session: NewAccountSession,
  ): Promise<RegisterAccountResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO accounts (identity_id, login_name, password_hash, nickname, display_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING RETURNING identity_id`,
        [
          record.identityId,
          record.loginName,
          record.passwordHash,
          record.nickname,
          record.displayName,
          new Date(record.createdAt),
        ],
      );
      if (inserted.rowCount !== 1) {
        const existing = await client.query<{ identity_id: string; login_name: string }>(
          `SELECT identity_id, login_name FROM accounts WHERE identity_id = $1 OR login_name = $2`,
          [record.identityId, record.loginName],
        );
        await client.query('ROLLBACK');
        return existing.rows.some((row) => row.identity_id === record.identityId)
          ? 'identity-registered'
          : 'login-taken';
      }
      for (const mode of ['normal', 'quick'] as const) {
        await client.query(
          `INSERT INTO account_ratings (identity_id, mode, rating, deviation, volatility, ranked_games, wins, losses)
           VALUES ($1, $2, 1500, 350, 0.06, 0, 0, 0)`,
          [record.identityId, mode],
        );
      }
      await insertSession(client, record.identityId, session);
      await client.query('COMMIT');
      return 'created';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByLoginName(loginName: string): Promise<AccountRecord | null> {
    const result = await this.pool.query<AccountRow>(
      `SELECT identity_id, login_name, password_hash, nickname, display_name, created_at
       FROM accounts WHERE login_name = $1`,
      [loginName],
    );
    return result.rows[0] ? account(result.rows[0]) : null;
  }

  createSession(identityId: string, session: NewAccountSession): Promise<void> {
    return insertSession(this.pool, identityId, session);
  }

  async resolveSession(
    tokenHash: string,
    now: number,
    nextExpiresAt: number,
  ): Promise<AccountRecord | null> {
    const result = await this.pool.query<AccountRow>(
      `UPDATE account_sessions AS sessions
       SET expires_at = $3, last_used_at = $2
       FROM accounts
       WHERE sessions.token_hash = $1
         AND sessions.identity_id = accounts.identity_id
         AND sessions.expires_at > $2
       RETURNING accounts.identity_id, accounts.login_name, accounts.password_hash,
                 accounts.nickname, accounts.display_name, accounts.created_at`,
      [tokenHash, new Date(now), new Date(nextExpiresAt)],
    );
    return result.rows[0] ? account(result.rows[0]) : null;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.pool.query(`DELETE FROM account_sessions WHERE token_hash = $1`, [tokenHash]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
