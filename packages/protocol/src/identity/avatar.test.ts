import { describe, expect, it } from 'vitest';
import { AVATAR_IDS, avatarIdForIdentity } from './avatar.js';

describe('avatars', () => {
  it('contains 32 stable local avatar ids', () => {
    expect(AVATAR_IDS).toHaveLength(32);
    expect(avatarIdForIdentity('identity-a')).toBe(avatarIdForIdentity('identity-a'));
    expect(AVATAR_IDS).toContain(avatarIdForIdentity('identity-b'));
  });
});
