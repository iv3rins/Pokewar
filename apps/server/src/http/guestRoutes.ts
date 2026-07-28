import { Router } from 'express';
import type { AuthService } from '../auth/authService.js';
import { resolveIdentity } from '../auth/resolveIdentity.js';
import { serializeAccountCookie } from '../auth/session.js';
import type { ServerConfig } from '../config/config.js';
import {
  createGuestIdentity,
  serializeGuestCookie,
  type GuestIdentity,
  type GuestIdentityStore,
} from '../identity/guest.js';
import { asyncHandler } from './asyncHandler.js';

function publicIdentity(identity: GuestIdentity) {
  return { displayName: identity.displayName, kind: identity.kind };
}

function sessionCookies(
  identity: GuestIdentity,
  accountToken: string | null,
  config: ServerConfig,
): string[] {
  return identity.kind === 'account' && accountToken
    ? [serializeAccountCookie(accountToken, config.nodeEnv === 'production')]
    : [serializeGuestCookie(identity.id, config.guestSecret, config.nodeEnv === 'production')];
}

export function createGuestRouter(
  config: ServerConfig,
  identities: GuestIdentityStore,
  auth: AuthService,
): Router {
  const router = Router();
  router.post(
    '/session',
    asyncHandler(async (request, response) => {
      const existing = await resolveIdentity(
        request.headers.cookie,
        config,
        identities,
        auth,
        Date.now(),
      );
      const identity = existing?.identity ?? createGuestIdentity();
      if (!existing) await identities.save(identity);
      response.setHeader(
        'Set-Cookie',
        sessionCookies(identity, existing?.accountToken ?? null, config),
      );
      return response.status(existing ? 200 : 201).json({ identity: publicIdentity(identity) });
    }),
  );

  router.get(
    '/session',
    asyncHandler(async (request, response) => {
      const resolved = await resolveIdentity(
        request.headers.cookie,
        config,
        identities,
        auth,
        Date.now(),
      );
      if (!resolved) return response.status(401).json({ code: 'IDENTITY_REQUIRED' });
      response.setHeader(
        'Set-Cookie',
        sessionCookies(resolved.identity, resolved.accountToken, config),
      );
      return response.json({ identity: publicIdentity(resolved.identity) });
    }),
  );
  return router;
}
