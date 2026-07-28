import { describe, expect, it } from 'vitest';
import {
  accountTokenFromCookies,
  createAccountSessionToken,
  hashSessionToken,
  serializeAccountCookie,
} from './session.js';
import { parseCookies } from '../identity/guest.js';

describe('account session tokens', () => {
  it('stores only a stable hash and serializes a secure cookie', () => {
    const token = createAccountSessionToken();
    expect(token).not.toBe(hashSessionToken(token));
    const cookie = serializeAccountCookie(token, true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(accountTokenFromCookies(parseCookies(cookie))).toBe(token);
  });
});
