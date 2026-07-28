export const AVATAR_IDS = Array.from(
  { length: 32 },
  (_, index) => `court-${String(index + 1).padStart(2, '0')}`,
) as readonly string[];

export type AvatarId = (typeof AVATAR_IDS)[number];

export function avatarIdForIdentity(identityId: string): AvatarId {
  let hash = 2166136261;
  for (const character of identityId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  const avatar = AVATAR_IDS[(hash >>> 0) % AVATAR_IDS.length];
  if (!avatar) throw new Error('AVATAR_ID_NOT_FOUND');
  return avatar;
}
