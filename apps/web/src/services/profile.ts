import {
  leaderboardSchema,
  profileRankingSchema,
  type GameMode,
  type ProfileRanking,
} from '@pokewar/protocol';

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new Error('PROFILE_FAILED');
  return response.json() as Promise<unknown>;
}

export async function getProfile(): Promise<ProfileRanking> {
  return profileRankingSchema.parse(await readJson('/api/profile'));
}

export async function getLeaderboard(mode: GameMode) {
  return leaderboardSchema.parse(await readJson(`/api/profile/leaderboards/${mode}`));
}
