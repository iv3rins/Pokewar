import type { ServerConfig } from '../config/config.js';
import {
  parseCookies,
  verifyGuestCookie,
  type GuestIdentity,
  type GuestIdentityStore,
} from '../identity/guest.js';
import { accountTokenFromCookies } from './session.js';
import type { AuthService } from './authService.js';

export interface ResolvedIdentity {
  readonly identity: GuestIdentity;
  readonly accountToken: string | null;
}

export async function resolveIdentity(
  cookieHeader: string | undefined,
  config: ServerConfig,
  identities: GuestIdentityStore,
  auth: AuthService,
  now: number,
): Promise<ResolvedIdentity | null> {
  const cookies = parseCookies(cookieHeader);
  const accountToken = accountTokenFromCookies(cookies);
  if (accountToken) {
    const identity = await auth.resolve(accountToken, now);
    if (identity) return { identity, accountToken };
  }
  const guestId = verifyGuestCookie(cookieHeader, config.guestSecret);
  const guest = guestId ? await identities.get(guestId) : undefined;
  return guest?.kind === 'guest' ? { identity: guest, accountToken: null } : null;
}
