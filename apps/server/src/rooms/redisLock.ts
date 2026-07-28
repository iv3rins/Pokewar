import { randomUUID } from 'node:crypto';
import type { RoomLockAdapter } from './lock.js';

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface RedisLockClient {
  set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export interface RedisLockOptions {
  readonly leaseMs?: number;
  readonly waitMs?: number;
  readonly retryMs?: number;
}

export class RedisRoomLock implements RoomLockAdapter {
  readonly #leaseMs: number;
  readonly #waitMs: number;
  readonly #retryMs: number;

  constructor(
    private readonly client: RedisLockClient,
    private readonly prefix: string,
    options: RedisLockOptions = {},
  ) {
    this.#leaseMs = options.leaseMs ?? 10_000;
    this.#waitMs = options.waitMs ?? 2_000;
    this.#retryMs = options.retryMs ?? 25;
  }

  async run<T>(roomId: string, task: () => Promise<T>): Promise<T> {
    const key = `${this.prefix}lock:room:${roomId}`;
    const token = randomUUID();
    const deadline = Date.now() + this.#waitMs;
    let result = await this.client.set(key, token, { NX: true, PX: this.#leaseMs });
    while (result !== 'OK') {
      if (Date.now() >= deadline) throw new Error('ROOM_LOCK_TIMEOUT');
      await new Promise((resolve) => setTimeout(resolve, this.#retryMs));
      result = await this.client.set(key, token, { NX: true, PX: this.#leaseMs });
    }
    try {
      return await task();
    } finally {
      await this.client.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] });
    }
  }
}
