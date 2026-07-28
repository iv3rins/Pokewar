import {
  GUEST_IDENTITY_TTL_SECONDS,
  type GuestIdentity,
  type GuestIdentityStore,
} from './guest.js';

export interface RedisIdentityClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export class RedisGuestIdentityStore implements GuestIdentityStore {
  constructor(
    private readonly client: RedisIdentityClient,
    private readonly prefix: string,
  ) {}

  async get(id: string): Promise<GuestIdentity | undefined> {
    const key = this.key(id);
    const value = await this.client.get(key);
    if (!value) return undefined;
    await this.client.expire(key, GUEST_IDENTITY_TTL_SECONDS);
    const stored = JSON.parse(value) as Omit<GuestIdentity, 'kind'> & {
      readonly kind?: GuestIdentity['kind'];
    };
    return { ...stored, kind: stored.kind ?? 'guest' };
  }

  async save(identity: GuestIdentity): Promise<void> {
    await this.client.set(this.key(identity.id), JSON.stringify(identity), {
      EX: GUEST_IDENTITY_TTL_SECONDS,
    });
  }

  private key(id: string): string {
    return `${this.prefix}identity:${id}`;
  }
}
