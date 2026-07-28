import { deadlineScore, type DeadlineTask } from './deadline.js';
import type { DeadlineStore } from './deadlineStore.js';

export interface RedisDeadlineClient {
  sMembers(key: string): Promise<string[]>;
  del(key: string): Promise<number>;
  sAdd(key: string, members: string[]): Promise<number>;
  zAdd(key: string, members: { score: number; value: string }[]): Promise<number>;
  zRem(key: string, members: string[]): Promise<number>;
  zRangeByScore(
    key: string,
    min: number,
    max: number,
    options: { LIMIT: { offset: number; count: number } },
  ): Promise<string[]>;
}

export class RedisDeadlineStore implements DeadlineStore {
  constructor(
    private readonly client: RedisDeadlineClient,
    private readonly prefix: string,
  ) {}

  async replaceRoom(roomId: string, tasks: readonly DeadlineTask[]): Promise<void> {
    const roomKey = this.roomKey(roomId);
    const oldMembers = await this.client.sMembers(roomKey);
    if (oldMembers.length > 0) await this.client.zRem(this.deadlineKey(), oldMembers);
    await this.client.del(roomKey);
    if (tasks.length === 0) return;
    const values = tasks.map((task) => JSON.stringify(task));
    await this.client.zAdd(
      this.deadlineKey(),
      tasks.map((task, index) => ({ score: deadlineScore(task), value: values[index] ?? '' })),
    );
    await this.client.sAdd(roomKey, values);
  }

  async claimDue(now: number, limit: number): Promise<readonly DeadlineTask[]> {
    // Domain deadlines remain valid through the exact deadline millisecond; process only after it.
    const values = await this.client.zRangeByScore(this.deadlineKey(), 0, now * 10 - 1, {
      LIMIT: { offset: 0, count: limit },
    });
    return values.map((value) => JSON.parse(value) as DeadlineTask);
  }

  async remove(task: DeadlineTask): Promise<void> {
    await this.client.zRem(this.deadlineKey(), [JSON.stringify(task)]);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  private deadlineKey(): string {
    return `${this.prefix}deadlines`;
  }

  private roomKey(roomId: string): string {
    return `${this.prefix}deadline-room:${roomId}`;
  }
}
