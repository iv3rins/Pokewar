import type { ChatMessage } from '@pokewar/protocol';

export interface RoomMembershipStore {
  get(identityId: string): Promise<string | null>;
  set(identityId: string, roomId: string): Promise<void>;
  delete(identityId: string): Promise<void>;
}

export interface ChatMessageStore {
  list(roomId: string): Promise<readonly ChatMessage[]>;
  append(roomId: string, message: ChatMessage, ttlSeconds: number): Promise<void>;
  delete(roomId: string): Promise<void>;
}

export class MemoryChatMessageStore implements ChatMessageStore {
  readonly #messages = new Map<string, ChatMessage[]>();
  list(roomId: string) {
    return Promise.resolve(this.#messages.get(roomId) ?? []);
  }
  append(roomId: string, message: ChatMessage) {
    const messages = [...(this.#messages.get(roomId) ?? []), message].slice(-50);
    this.#messages.set(roomId, messages);
    return Promise.resolve();
  }
  delete(roomId: string) {
    this.#messages.delete(roomId);
    return Promise.resolve();
  }
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
