import type { GameMode } from '@pokewar/protocol';
import type { Pool } from 'pg';
import { ratingTier } from './glicko2.js';
import type {
  RankedEntry,
  RankedSettlement,
  RatingRepository,
  StoredRating,
} from './ratingRepository.js';
import { updateGlicko2 } from './glicko2.js';

interface RatingRow {
  readonly identity_id: string;
  readonly mode: GameMode;
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
  readonly ranked_games: number;
  readonly wins: number;
  readonly losses: number;
}
interface RankedRow extends RatingRow {
  readonly display_name: string;
  readonly rank: string | number;
}
function stored(row: RatingRow): StoredRating {
  return {
    identityId: row.identity_id,
    mode: row.mode,
    rating: row.rating,
    deviation: row.deviation,
    volatility: row.volatility,
    rankedGames: row.ranked_games,
    wins: row.wins,
    losses: row.losses,
  };
}
function entry(row: RankedRow): RankedEntry {
  return {
    ...stored(row),
    displayName: row.display_name,
    rank: Number(row.rank),
    tier: ratingTier(row.rating),
  };
}

export class PostgresRatingRepository implements RatingRepository {
  constructor(private readonly pool: Pool) {}
  async ensureAccount(identityId: string, displayName: string): Promise<void> {
    void displayName;
    await this.pool.query(
      `INSERT INTO account_ratings (
         identity_id, mode, rating, deviation, volatility, ranked_games, wins, losses
       ) VALUES
         ($1, 'normal', 1500, 350, 0.06, 0, 0, 0),
         ($1, 'quick', 1500, 350, 0.06, 0, 0, 0)
       ON CONFLICT (identity_id, mode) DO NOTHING`,
      [identityId],
    );
  }
  async getForIdentity(identityId: string): Promise<readonly StoredRating[]> {
    const result = await this.pool.query<RatingRow>(
      `SELECT identity_id, mode, rating, deviation, volatility, ranked_games, wins, losses
       FROM account_ratings WHERE identity_id = $1 ORDER BY mode`,
      [identityId],
    );
    return result.rows.map(stored);
  }
  async settleRankedMatch(settlement: RankedSettlement): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO ranked_match_settlements (match_id, mode, winner_identity_id)
         VALUES ($1, $2, $3) ON CONFLICT (match_id) DO NOTHING`,
        [settlement.matchId, settlement.mode, settlement.winnerIdentityId],
      );
      if (inserted.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      const ids = settlement.placements.map((placement) => placement.identityId).sort();
      const result = await client.query<RatingRow>(
        `SELECT identity_id, mode, rating, deviation, volatility, ranked_games, wins, losses
         FROM account_ratings WHERE mode = $1 AND identity_id = ANY($2::text[])
         ORDER BY identity_id FOR UPDATE`,
        [settlement.mode, ids],
      );
      const before = new Map(result.rows.map((row) => [row.identity_id, stored(row)]));
      if (before.size !== ids.length) throw new Error('RANKED_ACCOUNT_RATING_REQUIRED');
      for (const placement of settlement.placements) {
        const current = before.get(placement.identityId);
        if (!current) throw new Error('RANKED_ACCOUNT_RATING_REQUIRED');
        const updated = updateGlicko2(
          current,
          settlement.placements
            .filter((opponent) => opponent.identityId !== placement.identityId)
            .map((opponent) => {
              const opponentRating = before.get(opponent.identityId);
              if (!opponentRating) throw new Error('RANKED_OPPONENT_RATING_REQUIRED');
              return {
                opponent: opponentRating,
                score:
                  placement.placement < opponent.placement
                    ? (1 as const)
                    : placement.placement > opponent.placement
                      ? (0 as const)
                      : (0.5 as const),
              };
            }),
        );
        await client.query(
          `UPDATE account_ratings
           SET rating = $1, deviation = $2, volatility = $3,
               ranked_games = ranked_games + 1,
               wins = wins + $4, losses = losses + $5
           WHERE identity_id = $6 AND mode = $7`,
          [
            updated.rating,
            updated.deviation,
            updated.volatility,
            placement.identityId === settlement.winnerIdentityId ? 1 : 0,
            placement.identityId === settlement.winnerIdentityId ? 0 : 1,
            placement.identityId,
            settlement.mode,
          ],
        );
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async leaderboard(
    mode: GameMode,
    identityId: string | null,
  ): Promise<{ entries: readonly RankedEntry[]; self: RankedEntry | null }> {
    const result = await this.pool.query<RankedRow>(
      `WITH ranked AS (
         SELECT ratings.*, accounts.display_name,
                ROW_NUMBER() OVER (ORDER BY rating DESC, ranked_games DESC, ratings.identity_id ASC) AS rank
         FROM account_ratings AS ratings
         JOIN accounts ON accounts.identity_id = ratings.identity_id
         WHERE mode = $1 AND ranked_games >= 5
       )
       SELECT * FROM ranked WHERE rank <= 10 OR identity_id = $2 ORDER BY rank`,
      [mode, identityId],
    );
    const values = result.rows.map(entry);
    return {
      entries: values.filter((value) => value.rank <= 10),
      self: identityId ? (values.find((value) => value.identityId === identityId) ?? null) : null,
    };
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
