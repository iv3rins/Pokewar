import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPokeWarServer } from '../app.js';
import type { ServerConfig } from '../config/config.js';

const config: ServerConfig = {
  nodeEnv: 'test',
  port: 0,
  guestSecret: 'test-secret-with-more-than-thirty-two-bytes',
  corsOrigins: ['http://localhost:5173'],
  redisPrefix: 'test:',
};
const sessionSchema = z.object({
  identity: z.object({ displayName: z.string(), kind: z.enum(['guest', 'account']) }),
});

function firstCookie(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
}

describe('guest HTTP session', () => {
  it('automatically creates and idempotently refreshes a signed guest session', async () => {
    const server = createPokeWarServer(config);
    const created = await request(server.app)
      .post('/api/guest/session')
      .send({ nickname: 'ignored' });
    const createdBody = sessionSchema.parse(created.body);
    expect(created.status).toBe(201);
    expect(createdBody.identity.kind).toBe('guest');
    expect(createdBody.identity.displayName).toMatch(/^.{4,6}#[A-Z0-9_-]{4}$/u);
    expect(createdBody.identity.displayName).not.toContain('ignored');
    const cookie = firstCookie(created.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');

    const refreshed = await request(server.app)
      .post('/api/guest/session')
      .set('Cookie', cookie ?? '')
      .send({ nickname: 'also ignored' });
    expect(refreshed.status).toBe(200);
    expect(sessionSchema.parse(refreshed.body)).toEqual(createdBody);
    expect(firstCookie(refreshed.headers['set-cookie'])).toContain('Max-Age=2592000');
    await server.io.close();
  });

  it('keeps GET as an authenticated read boundary', async () => {
    const server = createPokeWarServer(config);
    expect((await request(server.app).get('/api/guest/session')).status).toBe(401);
    await server.io.close();
  });
});
