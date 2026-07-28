import type { RoomState } from '../rooms/model.js';
import { deadlineScore, extractDeadlines } from '../scheduler/deadline.js';
import type { RoomStore } from './roomStore.js';

const LOBBY_TTL_SECONDS = 30 * 60;
const FINISHED_TTL_SECONDS = 10 * 60;
const ACTIVE_TTL_SECONDS = 24 * 60 * 60;

const SAVE_SCRIPT = `
local old = redis.call('SMEMBERS', KEYS[3])
if #old > 0 then redis.call('ZREM', KEYS[2], unpack(old)) end
redis.call('DEL', KEYS[3])
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
for index = 3, #ARGV, 2 do
  redis.call('ZADD', KEYS[2], ARGV[index], ARGV[index + 1])
  redis.call('SADD', KEYS[3], ARGV[index + 1])
end
return 1
`;

const DELETE_SCRIPT = `
local old = redis.call('SMEMBERS', KEYS[3])
if #old > 0 then redis.call('ZREM', KEYS[2], unpack(old)) end
redis.call('DEL', KEYS[3])
return redis.call('DEL', KEYS[1])
`;

export interface RedisIndexedRoomClient {
  get(key: string): Promise<string | null>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

function roomTtl(room: RoomState): number {
  if (!room.game) return LOBBY_TTL_SECONDS;
  return room.game.phase === 'GAME_OVER' ? FINISHED_TTL_SECONDS : ACTIVE_TTL_SECONDS;
}

export class RedisIndexedRoomStore implements RoomStore {
  constructor(
    private readonly client: RedisIndexedRoomClient,
    private readonly prefix: string,
  ) {}

  async get(roomId: string): Promise<RoomState | null> {
    const value = await this.client.get(this.roomKey(roomId));
    return value ? (JSON.parse(value) as RoomState) : null;
  }

  async save(room: RoomState): Promise<void> {
    const taskArguments = extractDeadlines(room).flatMap((task) => [
      String(deadlineScore(task)),
      JSON.stringify(task),
    ]);
    await this.client.eval(SAVE_SCRIPT, {
      keys: [this.roomKey(room.id), this.deadlineKey(), this.roomDeadlineKey(room.id)],
      arguments: [JSON.stringify(room), String(roomTtl(room)), ...taskArguments],
    });
  }

  async delete(roomId: string): Promise<void> {
    await this.client.eval(DELETE_SCRIPT, {
      keys: [this.roomKey(roomId), this.deadlineKey(), this.roomDeadlineKey(roomId)],
      arguments: [],
    });
  }

  private roomKey(roomId: string): string {
    return `${this.prefix}room:${roomId}`;
  }

  private deadlineKey(): string {
    return `${this.prefix}deadlines`;
  }

  private roomDeadlineKey(roomId: string): string {
    return `${this.prefix}deadline-room:${roomId}`;
  }
}
