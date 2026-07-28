export interface RoomMembershipStore {
  get(identityId: string): Promise<string | null>;
  set(identityId: string, roomId: string): Promise<void>;
  delete(identityId: string): Promise<void>;
}

export class MemoryRoomMembershipStore implements RoomMembershipStore {
  readonly #rooms = new Map<string, string>();

  get(identityId: string): Promise<string | null> {
    return Promise.resolve(this.#rooms.get(identityId) ?? null);
  }

  set(identityId: string, roomId: string): Promise<void> {
    this.#rooms.set(identityId, roomId);
    return Promise.resolve();
  }

  delete(identityId: string): Promise<void> {
    this.#rooms.delete(identityId);
    return Promise.resolve();
  }
}
