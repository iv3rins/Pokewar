import { z } from 'zod';
import { gameModeSchema } from '../rooms/projection.js';

export const matchSizeSchema = z.union([z.literal(4), z.literal(8), z.literal(12)]);

export const matchmakingStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({
    status: z.literal('queued'),
    mode: gameModeSchema,
    targetSize: matchSizeSchema,
    allowFallback: z.boolean(),
    enqueuedAt: z.int().nonnegative(),
    groupedPlayers: z.int().nonnegative(),
  }),
  z.object({
    status: z.literal('confirming'),
    proposalId: z.string(),
    mode: gameModeSchema,
    finalSize: matchSizeSchema,
    ranked: z.boolean(),
    expiresAt: z.int().nonnegative(),
    accepted: z.boolean(),
  }),
]);
export const matchmakingModePayloadSchema = z.object({
  mode: gameModeSchema,
  targetSize: matchSizeSchema,
  allowFallback: z.boolean(),
});
export const matchmakingAcceptPayloadSchema = z.object({ proposalId: z.string().min(1).max(100) });

export type MatchSize = z.infer<typeof matchSizeSchema>;
export type MatchmakingState = z.infer<typeof matchmakingStateSchema>;
