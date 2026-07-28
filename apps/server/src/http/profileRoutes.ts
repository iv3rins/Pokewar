import { gameModeSchema } from '@pokewar/protocol';
import { Router } from 'express';
import type { AuthService } from '../auth/authService.js';
import { resolveIdentity } from '../auth/resolveIdentity.js';
import type { ServerConfig } from '../config/config.js';
import type { GuestIdentityStore } from '../identity/guest.js';
import { ratingTier } from '../rating/glicko2.js';
import type { RatingRepository } from '../rating/ratingRepository.js';
import { asyncHandler } from './asyncHandler.js';

export function createProfileRouter(
  config: ServerConfig,
  identities: GuestIdentityStore,
  auth: AuthService,
  ratings: RatingRepository,
): Router {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (request, response) => {
      const resolved = await resolveIdentity(
        request.headers.cookie,
        config,
        identities,
        auth,
        Date.now(),
      );
      if (!resolved) return response.status(401).json({ code: 'IDENTITY_REQUIRED' });
      if (resolved.identity.kind === 'account') {
        await ratings.ensureAccount(resolved.identity.id, resolved.identity.displayName);
      }
      const stored =
        resolved.identity.kind === 'account'
          ? await ratings.getForIdentity(resolved.identity.id)
          : [];
      const views = await Promise.all(
        stored.map(async (rating) => {
          const ranking =
            rating.rankedGames >= 5
              ? await ratings.leaderboard(rating.mode, rating.identityId)
              : null;
          return {
            mode: rating.mode,
            rating: rating.rating,
            deviation: rating.deviation,
            rankedGames: rating.rankedGames,
            wins: rating.wins,
            losses: rating.losses,
            provisional: rating.rankedGames < 5,
            tier: ratingTier(rating.rating),
            rank: ranking?.self?.rank ?? null,
          };
        }),
      );
      return response.json({
        identity: {
          id: resolved.identity.id,
          displayName: resolved.identity.displayName,
          kind: resolved.identity.kind,
          avatarId: resolved.identity.avatarId ?? 'court-01',
        },
        ratings: views,
      });
    }),
  );
  router.get(
    '/leaderboards/:mode',
    asyncHandler(async (request, response) => {
      const mode = gameModeSchema.safeParse(request.params.mode);
      if (!mode.success) return response.status(400).json({ code: 'INVALID_MODE' });
      const resolved = await resolveIdentity(
        request.headers.cookie,
        config,
        identities,
        auth,
        Date.now(),
      );
      if (!resolved) return response.status(401).json({ code: 'IDENTITY_REQUIRED' });
      const result = await ratings.leaderboard(
        mode.data,
        resolved.identity.kind === 'account' ? resolved.identity.id : null,
      );
      const project = (entry: NonNullable<typeof result.self>) => ({
        rank: entry.rank,
        displayName: entry.displayName,
        rating: entry.rating,
        tier: entry.tier,
        wins: entry.wins,
        losses: entry.losses,
      });
      return response.json({
        mode: mode.data,
        entries: result.entries.map(project),
        self: result.self ? project(result.self) : null,
      });
    }),
  );
  return router;
}
