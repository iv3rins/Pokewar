import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPokeWarServer } from '../app.js';
import { MemoryAccountRepository } from '../auth/accountRepository.js';
import { MemoryGuestIdentityStore } from '../identity/guest.js';
import type { ServerConfig } from '../config/config.js';

const config: ServerConfig = {
  nodeEnv: 'test',
  port: 0,
  guestSecret: 'test-secret-with-more-than-thirty-two-bytes',
  corsOrigins: ['http://localhost:5173'],
  redisPrefix: 'test:',
};
const registration = {
  loginName: 'player_01',
  password: 'secure123',
  prefix: '静默',
  noun: '星轨',
};
const identityResponseSchema = z.object({
  identity: z.object({ displayName: z.string(), kind: z.enum(['guest', 'account']) }),
});
const errorResponseSchema = z.object({ code: z.string() });
function cookie(response: request.Response, name: string): string {
  const header = response.headers['set-cookie'] as unknown;
  const values = Array.isArray(header)
    ? header.filter((value): value is string => typeof value === 'string')
    : [];
  const value = values.find((candidate) => candidate.startsWith(`${name}=`));
  if (!value) throw new Error(`TEST_COOKIE_MISSING:${name}`);
  return value.split(';', 1)[0] ?? value;
}

describe('account HTTP authentication', () => {
  it('upgrades a guest, rejects the old guest credential, logs in elsewhere, and revokes logout', async () => {
    const identities = new MemoryGuestIdentityStore();
    const accounts = new MemoryAccountRepository();
    const server = createPokeWarServer(config, { identities, accounts });
    const guest = await request(server.app).post('/api/guest/session').send({});
    const guestCookie = cookie(guest, 'pokewar_guest');

    const registered = await request(server.app)
      .post('/api/auth/register')
      .set('Cookie', guestCookie)
      .send(registration);
    expect(registered.status).toBe(201);
    const registeredBody = identityResponseSchema.parse(registered.body);
    expect(registeredBody.identity.kind).toBe('account');
    expect(registeredBody.identity.displayName).toMatch(/^静默星轨#/);
    const accountCookie = cookie(registered, 'pokewar_account');
    expect(
      (await request(server.app).get('/api/guest/session').set('Cookie', guestCookie)).status,
    ).toBe(401);
    const currentAccount = await request(server.app)
      .get('/api/guest/session')
      .set('Cookie', accountCookie);
    expect(identityResponseSchema.parse(currentAccount.body).identity.kind).toBe('account');

    const badLogin = await request(server.app)
      .post('/api/auth/login')
      .send({ loginName: 'player_01', password: 'wrong123' });
    expect(badLogin.status).toBe(401);
    expect(errorResponseSchema.parse(badLogin.body)).toEqual({ code: 'INVALID_CREDENTIALS' });
    const login = await request(server.app)
      .post('/api/auth/login')
      .send({ loginName: 'PLAYER_01', password: 'secure123' });
    expect(login.status).toBe(200);
    const secondCookie = cookie(login, 'pokewar_account');
    expect(
      (await request(server.app).post('/api/auth/logout').set('Cookie', secondCookie)).status,
    ).toBe(204);
    expect(
      (await request(server.app).get('/api/guest/session').set('Cookie', secondCookie)).status,
    ).toBe(401);
    expect(
      (await request(server.app).get('/api/guest/session').set('Cookie', accountCookie)).status,
    ).toBe(200);
    await server.io.close();
  });

  it('requires a guest, reviewed words, and unique private login names', async () => {
    const server = createPokeWarServer(config);
    expect((await request(server.app).post('/api/auth/register').send(registration)).status).toBe(
      401,
    );
    const firstGuest = cookie(
      await request(server.app).post('/api/guest/session').send({}),
      'pokewar_guest',
    );
    expect(
      (
        await request(server.app)
          .post('/api/auth/register')
          .set('Cookie', firstGuest)
          .send({ ...registration, prefix: '自定义' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(server.app)
          .post('/api/auth/register')
          .set('Cookie', firstGuest)
          .send(registration)
      ).status,
    ).toBe(201);
    const secondGuest = cookie(
      await request(server.app).post('/api/guest/session').send({}),
      'pokewar_guest',
    );
    const conflict = await request(server.app)
      .post('/api/auth/register')
      .set('Cookie', secondGuest)
      .send(registration);
    expect(conflict.status).toBe(409);
    expect(errorResponseSchema.parse(conflict.body)).toEqual({ code: 'LOGIN_NAME_TAKEN' });
    await server.io.close();
  });

  it('rate limits repeated invalid logins without revealing account existence', async () => {
    const server = createPokeWarServer(config);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(server.app)
        .post('/api/auth/login')
        .send({ loginName: 'missing_1', password: 'wrong123' });
      expect(response.status).toBe(401);
      expect(errorResponseSchema.parse(response.body)).toEqual({ code: 'INVALID_CREDENTIALS' });
    }
    const blocked = await request(server.app)
      .post('/api/auth/login')
      .send({ loginName: 'missing_1', password: 'wrong123' });
    expect(blocked.status).toBe(429);
    expect(errorResponseSchema.parse(blocked.body)).toEqual({ code: 'LOGIN_RATE_LIMITED' });
    await server.io.close();
  });
});
