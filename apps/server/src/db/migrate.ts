import { Pool } from 'pg';
import { loadConfig } from '../config/config.js';

export const ACCOUNT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  identity_id text PRIMARY KEY,
  login_name text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  nickname text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash text PRIMARY KEY,
  identity_id text NOT NULL REFERENCES accounts(identity_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS account_sessions_identity_idx ON account_sessions (identity_id);
CREATE INDEX IF NOT EXISTS account_sessions_expiry_idx ON account_sessions (expires_at);
CREATE TABLE IF NOT EXISTS ranked_match_settlements (
  match_id text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('normal', 'quick')),
  winner_identity_id text NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_ratings (
  identity_id text NOT NULL REFERENCES accounts(identity_id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('normal', 'quick')),
  rating double precision NOT NULL,
  deviation double precision NOT NULL,
  volatility double precision NOT NULL,
  ranked_games integer NOT NULL,
  wins integer NOT NULL,
  losses integer NOT NULL,
  PRIMARY KEY (identity_id, mode)
);
`;

export const REPLAY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS match_replays (
  room_id text PRIMARY KEY,
  finished_at timestamptz NOT NULL,
  replay_expires_at timestamptz NOT NULL,
  winner_player_id text NOT NULL,
  participant_ids text[] NOT NULL,
  summary jsonb NOT NULL,
  replay_payload jsonb,
  purged_at timestamptz
);
CREATE INDEX IF NOT EXISTS match_replays_expiry_idx
  ON match_replays (replay_expires_at)
  WHERE replay_payload IS NOT NULL;
`;

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await pool.query(ACCOUNT_SCHEMA_SQL);
    await pool.query(REPLAY_SCHEMA_SQL);
  } finally {
    await pool.end();
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === `file://${entryPath.replaceAll('\\', '/')}`) {
  void main().catch((error: unknown) => {
    console.error('[migrate] failed', error);
    process.exit(1);
  });
}
