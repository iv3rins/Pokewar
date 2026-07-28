import type { RoomMembershipStore } from './membershipStore.js';

const MEMBERSHIP_TTL_SECONDS = 24 * 60 * 60;

export interface RedisMembershipClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(key: string): Promise<number>;
}

export class RedisRoomMembershipStore implements RoomMembershipStore {
  constructor(
    private readonly client: RedisMembershipClient,
    private readonly prefix: string,
  ) {}

  get(identityId: string): Promise<string | null> {
    return this.client.get(this.key(identityId));
  }

  async set(identityId: string, roomId: string): Promise<void> {
    await this.client.set(this.key(identityId), roomId, { EX: MEMBERSHIP_TTL_SECONDS });
  }

  async delete(identityId: string): Promise<void> {
    await this.client.del(this.key(identityId));
  }

  private key(identityId: string): string {
    return `${this.prefix}membership:${identityId}`;
  }
}
