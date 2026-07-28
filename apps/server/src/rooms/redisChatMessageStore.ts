import type { ChatMessage } from '@pokewar/protocol';
import type { ChatMessageStore } from './membershipStore.js';

const MAX_MESSAGES = 50;
export interface RedisChatClient {
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  multi(): { rPush(key: string, value: string): RedisChatMulti };
  del(key: string): Promise<number>;
}
export interface RedisChatMulti {
  lTrim(key: string, start: number, stop: number): RedisChatMulti;
  expire(key: string, seconds: number): RedisChatMulti;
  exec(): Promise<unknown>;
}
export class RedisChatMessageStore implements ChatMessageStore {
  constructor(
    private readonly client: RedisChatClient,
    private readonly prefix: string,
  ) {}
  async list(roomId: string): Promise<readonly ChatMessage[]> {
    return (await this.client.lRange(this.key(roomId), 0, MAX_MESSAGES - 1)).map(
      (value) => JSON.parse(value) as ChatMessage,
    );
  }
  async append(roomId: string, message: ChatMessage, ttlSeconds: number): Promise<void> {
    const key = this.key(roomId);
    await this.client
      .multi()
      .rPush(key, JSON.stringify(message))
      .lTrim(key, -MAX_MESSAGES, -1)
      .expire(key, ttlSeconds)
      .exec();
  }
  delete(roomId: string): Promise<void> {
    return this.client.del(this.key(roomId)).then(() => undefined);
  }
  private key(roomId: string): string {
    return `${this.prefix}chat:${roomId}`;
  }
}
