import { createGame } from '@pokewar/domain';
import { expect, it } from 'vitest';
import type { RoomState } from '../rooms/model.js';
import { MemoryDeadlineStore } from '../scheduler/deadlineStore.js';
import { IndexedRoomStore } from './indexedRoomStore.js';
import { MemoryRoomStore } from './roomStore.js';

it('indexes deadlines whenever a room is saved and clears them on delete', async () => {
  const deadlines = new MemoryDeadlineStore();
  const store = new IndexedRoomStore(new MemoryRoomStore(), deadlines);
  const game = createGame({
    id: 'ROOM1',
    mode: 'normal',
    players: [
      { id: 'p1', displayName: 'One' },
      { id: 'p2', displayName: 'Two' },
    ],
    seed: 'indexed-room',
    now: 0,
  });
  const room: RoomState = {
    id: 'ROOM1',
    version: 1,
    hostIdentityId: 'p1',
    mode: 'normal',
    members: [],
    bannedUntil: {},
    game,
    createdAt: 0,
    updatedAt: 0,
  };

  await store.save(room);
  expect(await deadlines.claimDue(15_001, 10)).toHaveLength(2);
  await store.delete('ROOM1');
  expect(await deadlines.claimDue(15_001, 10)).toEqual([]);
});
