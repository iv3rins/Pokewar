import type { RoomState } from '../rooms/model.js';
import type { RoomStore } from './roomStore.js';

const LOBBY_TTL_SECONDS = 30 * 60;
const FINISHED_TTL_SECONDS = 10 * 60;
const ACTIVE_TTL_SECONDS = 24 * 60 * 60;

export interface RedisRoomClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<number>;
}

function roomTtl(room: RoomState): number {
  if (!room.game) return LOBBY_TTL_SECONDS;
  return room.game.phase === 'GAME_OVER' ? FINISHED_TTL_SECONDS : ACTIVE_TTL_SECONDS;
}

export class RedisRoomStore implements RoomStore {
  constructor(
    private readonly client: RedisRoomClient,
    private readonly prefix: string,
  ) {}

  async get(roomId: string): Promise<RoomState | null> {
    const value = await this.client.get(this.key(roomId));
    if (!value) return null;
    return JSON.parse(value) as RoomState;
  }

  async save(room: RoomState): Promise<void> {
    await this.client.set(this.key(room.id), JSON.stringify(room), { EX: roomTtl(room) });
  }

  async delete(roomId: string): Promise<void> {
    await this.client.del(this.key(roomId));
  }

  private key(roomId: string): string {
    return `${this.prefix}room:${roomId}`;
  }
}
