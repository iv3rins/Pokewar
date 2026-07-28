import type { RoomState } from '../rooms/model.js';

export interface RoomStore {
  get(roomId: string): Promise<RoomState | null>;
  save(room: RoomState): Promise<void>;
  delete(roomId: string): Promise<void>;
}

export class MemoryRoomStore implements RoomStore {
  readonly #rooms = new Map<string, RoomState>();

  get(roomId: string): Promise<RoomState | null> {
    return Promise.resolve(this.#rooms.get(roomId) ?? null);
  }

  save(room: RoomState): Promise<void> {
    this.#rooms.set(room.id, room);
    return Promise.resolve();
  }

  delete(roomId: string): Promise<void> {
    this.#rooms.delete(roomId);
    return Promise.resolve();
  }
}
