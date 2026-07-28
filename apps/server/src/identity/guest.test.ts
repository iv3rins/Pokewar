import { describe, expect, it } from 'vitest';
import { createGuestIdentity, serializeGuestCookie, verifyGuestCookie } from './guest.js';

const secret = 'test-secret-with-more-than-thirty-two-bytes';

describe('guest identity', () => {
  it('creates an immutable reviewed vocabulary name', () => {
    const identity = createGuestIdentity({ id: 'stable-guest-id', prefixIndex: 0, nounIndex: 2 });
    expect(identity).toMatchObject({ kind: 'guest', nickname: '静默星轨' });
    expect(identity.displayName).toMatch(/^静默星轨#[A-Z0-9_-]{4}$/);
  });

  it('rejects out-of-range injected vocabulary indexes', () => {
    expect(() => createGuestIdentity({ prefixIndex: 100, nounIndex: 0 })).toThrow(
      'GUEST_NAME_INDEX_OUT_OF_RANGE',
    );
  });

  it('assigns a stable local avatar to each identity', () => {
    expect(createGuestIdentity({ id: 'stable-guest-id' }).avatarId).toBe(
      createGuestIdentity({ id: 'stable-guest-id' }).avatarId,
    );
  });

  it('signs and verifies an HttpOnly cookie and rejects tampering', () => {
    const identity = createGuestIdentity({ prefixIndex: 0, nounIndex: 0 });
    const cookie = serializeGuestCookie(identity.id, secret, false);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=2592000');
    expect(verifyGuestCookie(cookie, secret)).toBe(identity.id);
    expect(verifyGuestCookie(cookie.replace(identity.id, `${identity.id}x`), secret)).toBeNull();
  });
});
