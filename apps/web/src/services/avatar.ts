export function avatarAsset(avatarId?: string): string {
  return avatarId ? `/avatars/${avatarId}.svg` : '/avatars/court-01.svg';
}
