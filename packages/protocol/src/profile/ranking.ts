import { z } from 'zod';
import { gameModeSchema } from '../rooms/projection.js';

export const ratingTierSchema = z.enum([
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'champion',
]);
export const ratingViewSchema = z.object({
  mode: gameModeSchema,
  rating: z.number(),
  deviation: z.number().nonnegative(),
  rankedGames: z.int().nonnegative(),
  wins: z.int().nonnegative(),
  losses: z.int().nonnegative(),
  provisional: z.boolean(),
  tier: ratingTierSchema,
  rank: z.int().positive().nullable(),
});
export const leaderboardEntrySchema = z.object({
  rank: z.int().positive(),
  displayName: z.string(),
  rating: z.number(),
  tier: ratingTierSchema,
  wins: z.int().nonnegative(),
  losses: z.int().nonnegative(),
});
export const profileRankingSchema = z.object({
  identity: z.object({ displayName: z.string(), kind: z.enum(['guest', 'account']) }),
  ratings: z.array(ratingViewSchema).readonly(),
});
export const leaderboardSchema = z.object({
  mode: gameModeSchema,
  entries: z.array(leaderboardEntrySchema).max(10).readonly(),
  self: leaderboardEntrySchema.nullable(),
});

export type RatingView = z.infer<typeof ratingViewSchema>;
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;
export type ProfileRanking = z.infer<typeof profileRankingSchema>;
