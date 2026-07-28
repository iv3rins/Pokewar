import { describe, expect, it } from 'vitest';
import { roomProjectionSchema } from './projection.js';

const lobby = {
  id: 'A2BCD',
  version: 1,
  hostIdentityId: 'guest-1',
  kind: 'private',
  mode: 'normal',
  members: [
    { identityId: 'guest-1', displayName: '青石', ready: true, connected: true, isSelf: true },
  ],
  game: null,
};

describe('roomProjectionSchema', () => {
  it('accepts a viewer-specific lobby projection', () => {
    expect(roomProjectionSchema.parse(lobby)).toEqual(lobby);
  });

  it('rejects invalid room codes and oversized lobbies', () => {
    expect(roomProjectionSchema.safeParse({ ...lobby, id: 'O0OOO' }).success).toBe(false);
    expect(
      roomProjectionSchema.safeParse({ ...lobby, members: Array(13).fill(lobby.members[0]) })
        .success,
    ).toBe(false);
  });
});
