import { expect, it } from 'vitest';
import { MemoryRatingRepository } from './ratingRepository.js';

it('settles a multi-player match once using the shared pre-match snapshot', async () => {
  const repository = new MemoryRatingRepository();
  for (const [id, name] of [
    ['a', 'Alpha'],
    ['b', 'Beta'],
    ['c', 'Gamma'],
    ['d', 'Delta'],
  ] as const) {
    await repository.ensureAccount(id, name);
  }
  const settled = await repository.settleRankedMatch({
    matchId: 'MATCH1',
    mode: 'quick',
    winnerIdentityId: 'a',
    placements: [
      { identityId: 'a', placement: 1 },
      { identityId: 'b', placement: 2 },
      { identityId: 'c', placement: 2 },
      { identityId: 'd', placement: 4 },
    ],
  });
  expect(settled).toBe(true);
  expect(
    await repository.settleRankedMatch({
      matchId: 'MATCH1',
      mode: 'quick',
      winnerIdentityId: 'a',
      placements: [
        { identityId: 'a', placement: 1 },
        { identityId: 'b', placement: 2 },
        { identityId: 'c', placement: 2 },
        { identityId: 'd', placement: 4 },
      ],
    }),
  ).toBe(false);
  const ratings = await repository.getForIdentity('a');
  expect(ratings.find((rating) => rating.mode === 'quick')?.rankedGames).toBe(1);
  expect(ratings.find((rating) => rating.mode === 'normal')?.rankedGames).toBe(0);
});

it('returns only placed players in stable Top 10 order and resolves self rank', async () => {
  const repository = new MemoryRatingRepository();
  repository.seed('Alpha', {
    identityId: 'b',
    mode: 'quick',
    rating: 1600,
    deviation: 80,
    volatility: 0.06,
    rankedGames: 5,
    wins: 3,
    losses: 2,
  });
  repository.seed('Beta', {
    identityId: 'a',
    mode: 'quick',
    rating: 1600,
    deviation: 90,
    volatility: 0.06,
    rankedGames: 6,
    wins: 4,
    losses: 2,
  });
  repository.seed('Provisional', {
    identityId: 'c',
    mode: 'quick',
    rating: 1800,
    deviation: 100,
    volatility: 0.06,
    rankedGames: 4,
    wins: 4,
    losses: 0,
  });
  const result = await repository.leaderboard('quick', 'b');
  expect(result.entries.map((entry) => entry.displayName)).toEqual(['Beta', 'Alpha']);
  expect(result.self?.rank).toBe(2);
  expect(result.entries.every((entry) => entry.identityId !== 'c')).toBe(true);
});
