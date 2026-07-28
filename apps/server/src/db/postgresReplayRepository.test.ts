import type { GameState } from '@pokewar/domain';
import type { Pool, QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresReplayRepository } from './postgresReplayRepository.js';
import { REPLAY_RETENTION_MS } from './replayRepository.js';

class FakePool {
  readonly queries: { text: string; values: readonly unknown[] }[] = [];
  result: Partial<QueryResult> = { rows: [], rowCount: 0 };

  query(text: string, values: readonly unknown[] = []): Promise<QueryResult> {
    this.queries.push({ text, values });
    return Promise.resolve(this.result as QueryResult);
  }

  end(): Promise<void> {
    return Promise.resolve();
  }
}

const game = { id: 'room', phase: 'GAME_OVER' } as GameState;

describe('PostgresReplayRepository', () => {
  it('stores full replay data with an exact fourteen-day expiry', async () => {
    const pool = new FakePool();
    const repository = new PostgresReplayRepository(pool as unknown as Pool);
    await repository.save({
      roomId: 'A2BCD',
      finishedAt: 1_000,
      winnerPlayerId: 'p1',
      participantIds: ['p1', 'p2'],
      summary: { mode: 'quick' },
      game,
    });
    const query = pool.queries[0];
    expect(query?.text).toContain('INSERT INTO match_replays');
    expect((query?.values[2] as Date).getTime()).toBe(1_000 + REPLAY_RETENTION_MS);
    expect(REPLAY_RETENTION_MS).toBe(14 * 24 * 60 * 60 * 1_000);
  });

  it('checks participant access and purges only full replay data', async () => {
    const pool = new FakePool();
    const repository = new PostgresReplayRepository(pool as unknown as Pool);
    await repository.getForParticipant('A2BCD', 'p1', 2_000);
    expect(pool.queries[0]?.text).toContain('$2 = ANY(participant_ids)');
    await repository.purgeExpired(3_000);
    expect(pool.queries[1]?.text).toContain('SET replay_payload = NULL');
    expect(pool.queries[1]?.text).toContain('participant_ids = ARRAY[]::text[]');
  });
});
