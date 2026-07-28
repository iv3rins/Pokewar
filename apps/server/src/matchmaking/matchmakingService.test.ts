import { describe, expect, it } from 'vitest';
import { MemoryRatingRepository } from '../rating/ratingRepository.js';
import { RoomLock } from '../rooms/lock.js';
import { MemoryRoomMembershipStore } from '../rooms/membershipStore.js';
import { RoomService } from '../rooms/roomService.js';
import { MemoryRoomStore } from '../storage/roomStore.js';
import { MatchmakingService } from './matchmakingService.js';
import { MemoryMatchmakingStore } from './matchmakingStore.js';

const identity = (id: string, kind: 'guest' | 'account' = 'account') => ({
  id,
  kind,
  nickname: id,
  displayName: `${id}#TEST`,
});
function setup() {
  const store = new MemoryMatchmakingStore();
  const memberships = new MemoryRoomMembershipStore();
  const rooms = new RoomService(new MemoryRoomStore(), new RoomLock());
  const service = new MatchmakingService(
    store,
    new RoomLock(),
    rooms,
    memberships,
    new MemoryRatingRepository(),
  );
  return { service, store, rooms, memberships };
}
async function enqueueFour(service: MatchmakingService, start = 1_000) {
  for (let index = 0; index < 4; index += 1) {
    await service.enqueue(identity(`p${String(index)}`), 'quick', 4, false, start + index);
  }
}

describe('multiplayer MatchmakingService', () => {
  it('waits for exactly four players and starts one hidden room after all accept', async () => {
    const { service, memberships } = setup();
    for (let index = 0; index < 3; index += 1) {
      const result = await service.enqueue(
        identity(`p${String(index)}`),
        'quick',
        4,
        false,
        1_000 + index,
      );
      expect(result.ok && result.updates.get(`p${String(index)}`)?.status).toBe('queued');
    }
    await service.enqueue(identity('p3'), 'quick', 4, false, 1_003);
    const state = await service.state('p0');
    if (state.status !== 'confirming') throw new Error('TEST_PROPOSAL_REQUIRED');
    expect(state.finalSize).toBe(4);
    expect(state.ranked).toBe(true);
    for (let index = 0; index < 3; index += 1) {
      await service.accept(`p${String(index)}`, state.proposalId, 2_000 + index);
    }
    const matched = await service.accept('p3', state.proposalId, 2_003);
    const room = matched.ok ? matched.rooms?.[0] : undefined;
    expect(room).toMatchObject({ kind: 'matchmade', mode: 'quick' });
    expect(room?.members).toHaveLength(4);
    expect(room?.game?.phase).toBe('PLAYING');
    expect(await memberships.get('p0')).toBe(room?.id);
  });

  it('keeps accepted players grouped, replaces a cancellation, and reconfirms everyone', async () => {
    const { service } = setup();
    await enqueueFour(service);
    const state = await service.state('p0');
    if (state.status !== 'confirming') throw new Error('TEST_PROPOSAL_REQUIRED');
    await service.accept('p0', state.proposalId, 2_000);
    await service.accept('p1', state.proposalId, 2_001);
    await service.accept('p2', state.proposalId, 2_002);
    const cancelled = await service.cancel('p3', 2_003);
    expect(cancelled.ok && cancelled.updates.get('p3')).toEqual({ status: 'idle' });
    expect((await service.state('p0')).status).toBe('queued');
    await service.enqueue(identity('replacement'), 'quick', 4, false, 2_004);
    const refilled = await service.state('p0');
    if (refilled.status !== 'confirming') throw new Error('TEST_REFILL_REQUIRED');
    expect(refilled.accepted).toBe(false);
    expect((await service.state('replacement')).status).toBe('confirming');
  });

  it('retains only accepted players after timeout and keeps the fixed final size', async () => {
    const { service } = setup();
    await enqueueFour(service);
    const state = await service.state('p0');
    if (state.status !== 'confirming') throw new Error('TEST_PROPOSAL_REQUIRED');
    await service.accept('p0', state.proposalId, 2_000);
    await service.accept('p1', state.proposalId, 2_001);
    const recovered = await service.recover(state.expiresAt);
    expect(recovered.ok && recovered.updates.get('p0')).toMatchObject({
      status: 'queued',
      targetSize: 4,
      groupedPlayers: 2,
    });
    expect(recovered.ok && recovered.updates.get('p2')).toEqual({ status: 'idle' });
  });

  it('allows opted-in 12-player requests to fill an 8-player match after sixty seconds', async () => {
    const { service } = setup();
    for (let index = 0; index < 8; index += 1) {
      await service.enqueue(identity(`f${String(index)}`), 'normal', 12, true, index);
    }
    expect((await service.state('f0')).status).toBe('queued');
    await service.recover(60_100);
    const state = await service.state('f0');
    expect(state.status === 'confirming' && state.finalSize).toBe(8);
  });

  it('marks a group containing any guest unranked and blocks room members', async () => {
    const { service, memberships } = setup();
    await service.enqueue(identity('guest', 'guest'), 'normal', 4, false, 1_000);
    for (let index = 1; index < 4; index += 1) {
      await service.enqueue(identity(`a${String(index)}`), 'normal', 4, false, 1_000 + index);
    }
    const state = await service.state('guest');
    expect(state.status === 'confirming' && state.ranked).toBe(false);
    await memberships.set('blocked', 'ROOM1');
    expect(await service.enqueue(identity('blocked'), 'quick', 4, false, 3_000)).toEqual({
      ok: false,
      code: 'MATCHMAKING_ROOM_CONFLICT',
    });
  });
});
