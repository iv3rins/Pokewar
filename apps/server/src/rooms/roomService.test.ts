import type { GuestIdentity } from '../identity/guest.js';
import { MemoryRoomStore } from '../storage/roomStore.js';
import { describe, expect, it } from 'vitest';
import { RoomLock } from './lock.js';
import { RoomService } from './roomService.js';

const identity = (id: string): GuestIdentity => ({
  id,
  kind: 'guest',
  nickname: '静默星轨',
  displayName: `静默星轨#${id}`,
});

function service() {
  return new RoomService(new MemoryRoomStore(), new RoomLock());
}

describe('RoomService lobby', () => {
  it('serializes concurrent joins without losing members', async () => {
    const rooms = service();
    const room = await rooms.create(identity('host'), 'normal', 1_000);
    const results = await Promise.all(
      ['p1', 'p2', 'p3', 'p4'].map((id) => rooms.join(room.id, identity(id), 2_000)),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect((await rooms.get(room.id))?.members).toHaveLength(5);
  });

  it('clears non-host readiness on mode changes and starts only when ready', async () => {
    const rooms = service();
    const room = await rooms.create(identity('host'), 'normal', 1_000);
    const joined = await rooms.join(room.id, identity('p1'), 2_000);
    expect(joined.ok).toBe(true);
    expect(await rooms.start(room.id, 'host', 'seed', 3_000)).toEqual({
      ok: false,
      code: 'NOT_ALL_READY',
    });
    await rooms.setReady(room.id, 'p1', true, 3_000);
    const changed = await rooms.setMode(room.id, 'host', 'quick', 4_000);
    expect(
      changed.ok && changed.value.members.find((member) => member.identityId === 'p1')?.ready,
    ).toBe(false);
    await rooms.setReady(room.id, 'p1', true, 5_000);
    const started = await rooms.start(room.id, 'host', 'secure-seed', 6_000);
    expect(started.ok).toBe(true);
    if (started.ok) expect(started.value.game?.phase).toBe('PLAYING');
  });

  it('transfers host ownership to the earliest remaining member and deletes an empty lobby', async () => {
    const rooms = service();
    const room = await rooms.create(identity('host'), 'normal', 1_000);
    await rooms.join(room.id, identity('first'), 2_000);
    await rooms.join(room.id, identity('second'), 3_000);
    const left = await rooms.leaveLobby(room.id, 'host', 4_000);
    expect(left.ok && left.value?.hostIdentityId).toBe('first');
    expect(
      left.ok && left.value?.members.find((member) => member.identityId === 'first')?.ready,
    ).toBe(true);
    expect((await rooms.leaveLobby(room.id, 'second', 5_000)).ok).toBe(true);
    expect((await rooms.leaveLobby(room.id, 'first', 6_000)).ok).toBe(true);
    expect(await rooms.get(room.id)).toBeNull();
  });

  it('lets a non-host leave and immediately rejoin without a kick ban', async () => {
    const rooms = service();
    const room = await rooms.create(identity('host'), 'normal', 1_000);
    await rooms.join(room.id, identity('p1'), 2_000);
    expect((await rooms.leaveLobby(room.id, 'p1', 3_000)).ok).toBe(true);
    expect((await rooms.join(room.id, identity('p1'), 3_001)).ok).toBe(true);
  });

  it('returns the same successful result when a game action is retried', async () => {
    const rooms = service();
    const room = await rooms.create(identity('host'), 'quick', 1_000);
    await rooms.join(room.id, identity('guest'), 1_001);
    await rooms.setReady(room.id, 'guest', true, 1_002);
    const started = await rooms.start(room.id, 'host', 'idempotent-seed', 1_003);
    expect(started.ok).toBe(true);
    if (!started.ok || !started.value.game) return;
    const command = {
      roomId: room.id,
      actionId: '123e4567-e89b-42d3-a456-426614174000',
      expectedVersion: started.value.game.version,
      kind: 'game:leave-match' as const,
    };
    const first = await rooms.command('host', command, 1_004);
    const retry = await rooms.command('host', command, 1_005);
    expect(first.ok).toBe(true);
    expect(retry).toEqual(first);
    expect((await rooms.get(room.id))?.version).toBe(started.value.version + 1);
  });

  it('marks PVE rooms explicitly and deletes them when the human session ends', async () => {
    const rooms = service();
    const room = await rooms.createPveRoom(identity('human'), 'quick', 4, 1_000);
    expect(room.kind).toBe('pve');
    expect(await rooms.dissolvePve(room.id, 'human')).toBe(true);
    expect(await rooms.get(room.id)).toBeNull();
  });

  it('does not let a bot or non-PVE room trigger PVE dissolution', async () => {
    const rooms = service();
    const pve = await rooms.createPveRoom(identity('human'), 'quick', 4, 1_000);
    const botId = pve.members.find((member) => member.identityId.startsWith('bot:'))?.identityId;
    if (!botId) throw new Error('BOT_REQUIRED');
    expect(await rooms.dissolvePve(pve.id, botId)).toBe(false);
    const privateRoom = await rooms.create(identity('host'), 'quick', 2_000);
    expect(await rooms.dissolvePve(privateRoom.id, 'host')).toBe(false);
  });

  it('temporarily bans a kicked member for exactly thirty seconds', async () => {
    const rooms = service();
    const room = await rooms.create(identity('host'), 'normal', 1_000);
    await rooms.join(room.id, identity('p1'), 2_000);
    const kicked = await rooms.kick(room.id, 'host', 'p1', 3_000);
    expect(kicked.ok).toBe(true);
    expect(await rooms.join(room.id, identity('p1'), 32_999)).toEqual({
      ok: false,
      code: 'PLAYER_BANNED',
    });
    expect((await rooms.join(room.id, identity('p1'), 33_000)).ok).toBe(true);
  });
});
