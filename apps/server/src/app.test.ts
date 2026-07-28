import request from 'supertest';
import { expect, it } from 'vitest';
import { createPokeWarServer } from './app.js';
import { loadConfig } from './config/config.js';

it('describes the API service at the backend root', async () => {
  const server = createPokeWarServer(
    loadConfig({ NODE_ENV: 'test', GUEST_SECRET: 'test-secret-that-is-at-least-32-bytes' }),
  );
  const response = await request(server.app).get('/');
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ service: 'pokewar-server', health: '/api/health' });
  await server.io.close();
});
