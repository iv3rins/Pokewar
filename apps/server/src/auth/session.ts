import { createHash, randomBytes } from 'node:crypto';

export const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const COOKIE_NAME = 'pokewar_account';

export function createAccountSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function serializeAccountCookie(
  token: string,
  secure: boolean,
  maxAgeSeconds = ACCOUNT_SESSION_TTL_MS / 1_000,
): string {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(maxAgeSeconds)}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function accountTokenFromCookies(cookies: Readonly<Record<string, string>>): string | null {
  return cookies[COOKIE_NAME] ?? null;
}
