import { profileRankingSchema, leaderboardSchema } from '@pokewar/protocol';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createPokeWarServer } from '../app.js';
import { MemoryRatingRepository } from '../rating/ratingRepository.js';
import type { ServerConfig } from '../config/config.js';

const config: ServerConfig = {
  nodeEnv: 'test',
  port: 0,
  guestSecret: 'test-secret-with-more-than-thirty-two-bytes',
  corsOrigins: ['http://localhost:5173'],
  redisPrefix: 'test:',
};
function cookie(response: request.Response, name: string): string {
  const header = response.headers['set-cookie'] as unknown;
  const values = Array.isArray(header)
    ? header.filter((value): value is string => typeof value === 'string')
    : [];
  const found = values.find((value) => value.startsWith(`${name}=`));
  if (!found) throw new Error('TEST_COOKIE_MISSING');
  return found.split(';', 1)[0] ?? found;
}

it('returns guest profile, account ratings, and placed leaderboard entries', async () => {
  const ratings = new MemoryRatingRepository();
  const server = createPokeWarServer(config, { ratings });
  const guestResponse = await request(server.app).post('/api/guest/session').send({});
  const guestCookie = cookie(guestResponse, 'pokewar_guest');
  const guestProfile = profileRankingSchema.parse(
    (await request(server.app).get('/api/profile').set('Cookie', guestCookie)).body,
  );
  expect(guestProfile.ratings).toEqual([]);

  const registration = await request(server.app)
    .post('/api/auth/register')
    .set('Cookie', guestCookie)
    .send({
      loginName: 'ranked_1',
      password: 'secure123',
      prefix: '静默',
      noun: '星轨',
    });
  const accountCookie = cookie(registration, 'pokewar_account');
  const accountProfile = profileRankingSchema.parse(
    (await request(server.app).get('/api/profile').set('Cookie', accountCookie)).body,
  );
  expect(accountProfile.ratings).toHaveLength(2);
  expect(accountProfile.ratings.every((rating) => rating.provisional)).toBe(true);

  ratings.seed('Placed Player', {
    identityId: 'placed',
    mode: 'quick',
    rating: 1700,
    deviation: 80,
    volatility: 0.06,
    rankedGames: 7,
    wins: 5,
    losses: 2,
  });
  const leaderboard = leaderboardSchema.parse(
    (await request(server.app).get('/api/profile/leaderboards/quick').set('Cookie', accountCookie))
      .body,
  );
  expect(leaderboard.entries[0]).toMatchObject({ displayName: 'Placed Player', rank: 1 });
  expect(leaderboard.self).toBeNull();
  await server.io.close();
});
