import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('server infrastructure config', () => {
  it('uses memory infrastructure when URLs are absent in development', () => {
    expect(loadConfig({ NODE_ENV: 'development' })).toMatchObject({
      nodeEnv: 'development',
      redisPrefix: 'pokewar:',
    });
  });

  it('requires secure production secrets and external infrastructure', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      'PRODUCTION_GUEST_SECRET_REQUIRED',
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        GUEST_SECRET: 'x'.repeat(32),
      }),
    ).toThrow('PRODUCTION_REDIS_URL_REQUIRED');
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        GUEST_SECRET: 'x'.repeat(32),
        REDIS_URL: 'redis://localhost:6379',
      }),
    ).toThrow('PRODUCTION_DATABASE_URL_REQUIRED');
  });
});
