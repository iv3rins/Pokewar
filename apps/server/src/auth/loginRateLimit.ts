const WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 5;

export interface LoginRateLimit {
  isBlocked(key: string, now: number): Promise<boolean>;
  recordFailure(key: string, now: number): Promise<void>;
  clear(key: string): Promise<void>;
}

export class MemoryLoginRateLimit implements LoginRateLimit {
  readonly #attempts = new Map<string, { count: number; expiresAt: number }>();
  isBlocked(key: string, now: number): Promise<boolean> {
    const attempt = this.#attempts.get(key);
    if (attempt && attempt.expiresAt <= now) this.#attempts.delete(key);
    return Promise.resolve(
      Boolean(attempt && attempt.expiresAt > now && attempt.count >= MAX_FAILURES),
    );
  }
  recordFailure(key: string, now: number): Promise<void> {
    const current = this.#attempts.get(key);
    this.#attempts.set(
      key,
      current && current.expiresAt > now
        ? { ...current, count: current.count + 1 }
        : { count: 1, expiresAt: now + WINDOW_MS },
    );
    return Promise.resolve();
  }
  clear(key: string): Promise<void> {
    this.#attempts.delete(key);
    return Promise.resolve();
  }
}

export interface RedisRateLimitClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

export class RedisLoginRateLimit implements LoginRateLimit {
  constructor(
    private readonly client: RedisRateLimitClient,
    private readonly prefix: string,
  ) {}
  async isBlocked(key: string): Promise<boolean> {
    const value = await this.client.get(this.key(key));
    return Number(value ?? 0) >= MAX_FAILURES;
  }
  async recordFailure(key: string): Promise<void> {
    const count = await this.client.incr(this.key(key));
    if (count === 1) await this.client.expire(this.key(key), WINDOW_MS / 1_000);
  }
  async clear(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }
  private key(value: string): string {
    return `${this.prefix}login-failure:${value}`;
  }
}
