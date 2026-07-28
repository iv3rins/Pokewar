import { z } from 'zod';

const optionalUrl = z
  .url()
  .optional()
  .or(z.literal('').transform(() => undefined));
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  GUEST_SECRET: z.string().min(32).default('development-only-pokewar-guest-secret-change-me'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  REDIS_URL: optionalUrl,
  REDIS_PREFIX: z.string().min(1).default('pokewar:'),
  DATABASE_URL: optionalUrl,
});

export interface ServerConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly host?: string;
  readonly guestSecret: string;
  readonly corsOrigins: readonly string[];
  readonly redisUrl?: string;
  readonly redisPrefix: string;
  readonly databaseUrl?: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = environmentSchema.parse(environment);
  if (parsed.NODE_ENV === 'production') {
    if (parsed.GUEST_SECRET.startsWith('development-only')) {
      throw new Error('PRODUCTION_GUEST_SECRET_REQUIRED');
    }
    if (!parsed.REDIS_URL) throw new Error('PRODUCTION_REDIS_URL_REQUIRED');
    if (!parsed.DATABASE_URL) throw new Error('PRODUCTION_DATABASE_URL_REQUIRED');
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    guestSecret: parsed.GUEST_SECRET,
    corsOrigins: parsed.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    ...(parsed.REDIS_URL ? { redisUrl: parsed.REDIS_URL } : {}),
    redisPrefix: parsed.REDIS_PREFIX,
    ...(parsed.DATABASE_URL ? { databaseUrl: parsed.DATABASE_URL } : {}),
  };
}
