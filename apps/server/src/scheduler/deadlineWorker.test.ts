import { expect, it, vi } from 'vitest';
import type { RoomState } from '../rooms/model.js';
import type { RoomService } from '../rooms/roomService.js';
import type { DeadlineTask } from './deadline.js';
import { MemoryDeadlineStore } from './deadlineStore.js';
import { startDeadlineWorker } from './deadlineWorker.js';

it('recovers due tasks, removes stale work, and publishes successful updates', async () => {
  const deadlines = new MemoryDeadlineStore();
  const due: DeadlineTask = {
    id: 'due',
    roomId: 'ROOM1',
    kind: 'turn',
    playerId: 'p1',
    dueAt: 100,
    gameVersion: 1,
  };
  const stale: DeadlineTask = {
    id: 'stale',
    roomId: 'ROOM2',
    kind: 'turn',
    playerId: 'p2',
    dueAt: 100,
    gameVersion: 1,
  };
  await deadlines.replaceRoom('ROOM1', [due]);
  await deadlines.replaceRoom('ROOM2', [stale]);
  const updated = { id: 'ROOM1' } as RoomState;
  const processDeadline = vi.fn((task: DeadlineTask) =>
    Promise.resolve(
      task.id === 'due'
        ? { ok: true as const, value: updated }
        : { ok: true as const, value: null },
    ),
  );
  const onRoomUpdated = vi.fn();
  const worker = startDeadlineWorker(deadlines, { processDeadline } as unknown as RoomService, {
    now: () => 101,
    pollIntervalMs: 60_000,
    onRoomUpdated,
  });

  await vi.waitFor(() => expect(processDeadline).toHaveBeenCalledTimes(2));
  expect(onRoomUpdated).toHaveBeenCalledWith(updated);
  expect(await deadlines.claimDue(101, 10)).toEqual([]);
  worker.stop();
});
