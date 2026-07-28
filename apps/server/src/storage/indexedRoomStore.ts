import { extractDeadlines } from '../scheduler/deadline.js';
import type { DeadlineStore } from '../scheduler/deadlineStore.js';
import type { RoomState } from '../rooms/model.js';
import type { RoomStore } from './roomStore.js';

export class IndexedRoomStore implements RoomStore {
  constructor(
    private readonly rooms: RoomStore,
    private readonly deadlines: DeadlineStore,
  ) {}

  get(roomId: string): Promise<RoomState | null> {
    return this.rooms.get(roomId);
  }

  async save(room: RoomState): Promise<void> {
    await this.rooms.save(room);
    await this.deadlines.replaceRoom(room.id, extractDeadlines(room));
  }

  async delete(roomId: string): Promise<void> {
    await this.rooms.delete(roomId);
    await this.deadlines.replaceRoom(roomId, []);
  }
}
