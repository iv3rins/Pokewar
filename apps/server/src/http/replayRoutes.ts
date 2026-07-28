import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/authService.js';
import { resolveIdentity } from '../auth/resolveIdentity.js';
import type { ServerConfig } from '../config/config.js';
import type { ReplayRepository } from '../db/replayRepository.js';
import type { GuestIdentityStore } from '../identity/guest.js';
import { asyncHandler } from './asyncHandler.js';

const paramsSchema = z.object({
  roomId: z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/),
});

export function createReplayRouter(
  config: ServerConfig,
  identities: GuestIdentityStore,
  replays: ReplayRepository,
  auth: AuthService,
): Router {
  const router = Router();
  router.get(
    '/:roomId',
    asyncHandler(async (request, response) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return response.status(400).json({ code: 'INVALID_ROOM_ID' });
      const resolved = await resolveIdentity(
        request.headers.cookie,
        config,
        identities,
        auth,
        Date.now(),
      );
      if (!resolved) return response.status(401).json({ code: 'IDENTITY_REQUIRED' });
      const replay = await replays.getForParticipant(
        params.data.roomId,
        resolved.identity.id,
        Date.now(),
      );
      if (!replay) return response.status(404).json({ code: 'REPLAY_NOT_FOUND' });
      return response.json({
        replay: {
          roomId: replay.roomId,
          finishedAt: replay.finishedAt,
          expiresAt: replay.expiresAt,
          game: replay.game,
        },
      });
    }),
  );
  return router;
}
