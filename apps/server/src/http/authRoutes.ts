import { loginAccountSchema, registerAccountSchema } from '@pokewar/protocol';
import { Router } from 'express';
import type { ServerConfig } from '../config/config.js';
import type { GuestIdentityStore } from '../identity/guest.js';
import type { AuthService } from '../auth/authService.js';
import type { LoginRateLimit } from '../auth/loginRateLimit.js';
import { resolveIdentity } from '../auth/resolveIdentity.js';
import { serializeAccountCookie } from '../auth/session.js';
import { asyncHandler } from './asyncHandler.js';

function publicIdentity(identity: {
  readonly id: string;
  readonly displayName: string;
  readonly kind: 'guest' | 'account' | 'bot';
  readonly avatarId?: string;
}) {
  return {
    id: identity.id,
    displayName: identity.displayName,
    kind: identity.kind === 'bot' ? 'guest' : identity.kind,
    avatarId: identity.avatarId ?? 'court-01',
  };
}

export function createAuthRouter(
  config: ServerConfig,
  identities: GuestIdentityStore,
  auth: AuthService,
  limiter: LoginRateLimit,
): Router {
  const router = Router();
  router.post(
    '/register',
    asyncHandler(async (request, response) => {
      const parsed = registerAccountSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_PAYLOAD' });
      const resolved = await resolveIdentity(
        request.headers.cookie,
        config,
        identities,
        auth,
        Date.now(),
      );
      if (resolved?.identity.kind !== 'guest')
        return response.status(401).json({ code: 'GUEST_IDENTITY_REQUIRED' });
      const result = await auth.register(resolved.identity, parsed.data, Date.now());
      if (!result.ok) return response.status(409).json({ code: result.code });
      response.setHeader(
        'Set-Cookie',
        serializeAccountCookie(result.token, config.nodeEnv === 'production'),
      );
      return response.status(201).json({ identity: publicIdentity(result.identity) });
    }),
  );

  router.post(
    '/login',
    asyncHandler(async (request, response) => {
      const parsed = loginAccountSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ code: 'INVALID_PAYLOAD' });
      const clientAddress = request.ip ?? request.socket.remoteAddress ?? 'unknown';
      const key = `${clientAddress}:${parsed.data.loginName}`;
      if (await limiter.isBlocked(key, Date.now()))
        return response.status(429).json({ code: 'LOGIN_RATE_LIMITED' });
      const result = await auth.login(parsed.data, Date.now());
      if (!result.ok) {
        await limiter.recordFailure(key, Date.now());
        return response.status(401).json({ code: 'INVALID_CREDENTIALS' });
      }
      await limiter.clear(key);
      response.setHeader(
        'Set-Cookie',
        serializeAccountCookie(result.token, config.nodeEnv === 'production'),
      );
      return response.json({ identity: publicIdentity(result.identity) });
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (request, response) => {
      const resolved = await resolveIdentity(
        request.headers.cookie,
        config,
        identities,
        auth,
        Date.now(),
      );
      if (resolved?.accountToken) await auth.revoke(resolved.accountToken);
      response.setHeader(
        'Set-Cookie',
        serializeAccountCookie('', config.nodeEnv === 'production', 0),
      );
      return response.status(204).end();
    }),
  );
  return router;
}
