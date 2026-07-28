import { describe, expect, it } from 'vitest';
import type { DeadlineTask } from './deadline.js';
import { MemoryDeadlineStore } from './deadlineStore.js';

const task = (id: string, dueAt: number): DeadlineTask => ({
  id,
  roomId: 'ROOM1',
  kind: 'turn',
  playerId: 'p1',
  dueAt,
  gameVersion: 1,
});

describe('MemoryDeadlineStore', () => {
  it('replaces room tasks and claims deadlines only after their valid millisecond', async () => {
    const store = new MemoryDeadlineStore();
    await store.replaceRoom('ROOM1', [task('old', 100)]);
    await store.replaceRoom('ROOM1', [task('current', 200)]);

    expect(await store.claimDue(199, 10)).toEqual([]);
    expect(await store.claimDue(200, 10)).toEqual([]);
    expect(await store.claimDue(201, 10)).toEqual([task('current', 200)]);
    await store.remove(task('current', 200));
    expect(await store.claimDue(300, 10)).toEqual([]);
  });
});
