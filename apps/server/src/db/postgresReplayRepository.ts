import type { GameState } from '@pokewar/domain';
import type { Pool } from 'pg';
import {
  REPLAY_RETENTION_MS,
  type CompletedReplay,
  type ReplayRepository,
  type StoredReplay,
} from './replayRepository.js';

interface ReplayRow {
  readonly room_id: string;
  readonly finished_at: Date;
  readonly replay_expires_at: Date;
  readonly replay_payload: GameState;
}

export class PostgresReplayRepository implements ReplayRepository {
  constructor(private readonly pool: Pool) {}

  async save(replay: CompletedReplay): Promise<void> {
    const finishedAt = new Date(replay.finishedAt);
    const expiresAt = new Date(replay.finishedAt + REPLAY_RETENTION_MS);
    await this.pool.query(
      `INSERT INTO match_replays (
        room_id, finished_at, replay_expires_at, winner_player_id,
        participant_ids, summary, replay_payload
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      ON CONFLICT (room_id) DO UPDATE SET
        finished_at = EXCLUDED.finished_at,
        replay_expires_at = EXCLUDED.replay_expires_at,
        winner_player_id = EXCLUDED.winner_player_id,
        participant_ids = EXCLUDED.participant_ids,
        summary = EXCLUDED.summary,
        replay_payload = EXCLUDED.replay_payload`,
      [
        replay.roomId,
        finishedAt,
        expiresAt,
        replay.winnerPlayerId,
        [...replay.participantIds],
        JSON.stringify(replay.summary),
        JSON.stringify(replay.game),
      ],
    );
  }

  async getForParticipant(
    roomId: string,
    participantId: string,
    now: number,
  ): Promise<StoredReplay | null> {
    const result = await this.pool.query<ReplayRow>(
      `SELECT room_id, finished_at, replay_expires_at, replay_payload
       FROM match_replays
       WHERE room_id = $1
         AND $2 = ANY(participant_ids)
         AND replay_payload IS NOT NULL
         AND replay_expires_at > $3`,
      [roomId, participantId, new Date(now)],
    );
    const row = result.rows[0];
    return row
      ? {
          roomId: row.room_id,
          finishedAt: row.finished_at.getTime(),
          expiresAt: row.replay_expires_at.getTime(),
          game: row.replay_payload,
        }
      : null;
  }

  async purgeExpired(now: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE match_replays
       SET replay_payload = NULL,
           participant_ids = ARRAY[]::text[],
           purged_at = $1
       WHERE replay_payload IS NOT NULL
         AND replay_expires_at <= $1`,
      [new Date(now)],
    );
    return result.rowCount ?? 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
