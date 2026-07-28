import type { GameState } from '@pokewar/domain';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createPokeWarServer } from '../app.js';
import type { ServerConfig } from '../config/config.js';
import type { CompletedReplay, ReplayRepository, StoredReplay } from '../db/replayRepository.js';

const config: ServerConfig = {
  nodeEnv: 'test',
  port: 0,
  guestSecret: 'test-secret-with-more-than-thirty-two-bytes',
  corsOrigins: ['http://localhost:5173'],
  redisPrefix: 'test:',
};

class MemoryReplayRepository implements ReplayRepository {
  replay: StoredReplay | null = null;
  allowedParticipant = '';

  save(replay: CompletedReplay): Promise<void> {
    void replay;
    return Promise.resolve();
  }
  getForParticipant(
    roomId: string,
    participantId: string,
    now: number,
  ): Promise<StoredReplay | null> {
    const replay = this.replay;
    return Promise.resolve(
      replay?.roomId === roomId &&
        participantId === this.allowedParticipant &&
        replay.expiresAt > now
        ? replay
        : null,
    );
  }
  purgeExpired(now: number): Promise<number> {
    void now;
    return Promise.resolve(0);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

function firstCookie(value: unknown): string {
  if (!Array.isArray(value) || typeof value[0] !== 'string') throw new Error('TEST_COOKIE_MISSING');
  return value[0];
}

describe('participant replay HTTP access', () => {
  it('returns an unexpired full replay only to a signed participant', async () => {
    const replays = new MemoryReplayRepository();
    const server = createPokeWarServer(config, { replays });
    const session = await request(server.app).post('/api/guest/session').send({});
    const cookie = firstCookie(session.headers['set-cookie']);
    const identityId = cookie.split('=', 2)[1]?.split('.', 1)[0];
    if (!identityId) throw new Error('TEST_IDENTITY_MISSING');
    replays.allowedParticipant = identityId;
    replays.replay = {
      roomId: 'A2BCD',
      finishedAt: 1_000,
      expiresAt: Date.now() + 10_000,
      game: { id: 'A2BCD', phase: 'GAME_OVER' } as GameState,
    };
    const response = await request(server.app).get('/api/replays/A2BCD').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.text).toContain('"roomId":"A2BCD"');
    expect((await request(server.app).get('/api/replays/A2BCD')).status).toBe(401);
    await server.io.close();
  });

  it('uses the same 404 for non-participants and expired replays', async () => {
    const replays = new MemoryReplayRepository();
    const server = createPokeWarServer(config, { replays });
    const session = await request(server.app).post('/api/guest/session').send({});
    const cookie = firstCookie(session.headers['set-cookie']);
    replays.allowedParticipant = 'someone-else';
    expect((await request(server.app).get('/api/replays/A2BCD').set('Cookie', cookie)).status).toBe(
      404,
    );
    await server.io.close();
  });
});
