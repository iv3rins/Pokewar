import { io as createClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPokeWarServer, type PokeWarServer } from '../app.js';
import type { ServerConfig } from '../config/config.js';
import { MemoryRoomStore } from '../storage/roomStore.js';

const config: ServerConfig = {
  nodeEnv: 'test',
  port: 0,
  guestSecret: 'test-secret-with-more-than-thirty-two-bytes',
  corsOrigins: ['http://localhost:5173'],
  redisPrefix: 'test:',
};
const createAckSchema = z.object({ ok: z.literal(true), room: z.object({ id: z.string() }) });
const okAckSchema = z.object({ ok: z.literal(true) });
const pveLeaveAckSchema = z.object({
  ok: z.literal(true),
  roomId: z.string(),
  actionId: z.uuid(),
  leftRoom: z.literal(true),
  dissolved: z.literal(true),
});
const snapshotSchema = z.object({
  members: z.array(z.object({ identityId: z.string(), isSelf: z.boolean() })),
  game: z.object({
    id: z.string(),
    players: z.array(
      z.object({
        id: z.string(),
        hand: z.array(z.unknown()).optional(),
        handCount: z.number(),
      }),
    ),
  }),
});
type Snapshot = z.infer<typeof snapshotSchema>;

const clients: Socket[] = [];
let activeServer: PokeWarServer | null = null;

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  if (activeServer) {
    await activeServer.io.close();
    const httpServer = activeServer.httpServer;
    if (httpServer.listening) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    activeServer = null;
  }
});

function firstCookie(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
}

async function guestCookie(server: PokeWarServer): Promise<string> {
  const response = await request(server.app).post('/api/guest/session').send({});
  const cookie = firstCookie(response.headers['set-cookie']);
  if (!cookie) throw new Error('TEST_COOKIE_MISSING');
  return cookie.split(';', 1)[0] ?? cookie;
}

async function connect(url: string, cookie: string): Promise<Socket> {
  const client = createClient(url, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie, Origin: 'http://localhost:5173' },
  });
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', reject);
  });
  return client;
}

function emitAck(socket: Socket, event: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve) =>
    socket.emit(event, payload, (response: unknown) => resolve(response)),
  );
}

function nextGameSnapshot(socket: Socket): Promise<Snapshot> {
  return new Promise((resolve) => {
    const handler = (payload: unknown) => {
      const parsed = snapshotSchema.safeParse(payload);
      if (!parsed.success) return;
      socket.off('room:snapshot', handler);
      resolve(parsed.data);
    };
    socket.on('room:snapshot', handler);
  });
}

function selfPlayer(snapshot: Snapshot) {
  const selfMember = snapshot.members.find((member) => member.isSelf);
  const self = snapshot.game.players.find((player) => player.id === selfMember?.identityId);
  if (!self) throw new Error('TEST_SELF_PLAYER_MISSING');
  return self;
}

async function waitForRoom(
  server: PokeWarServer,
  roomId: string,
  predicate: (room: NonNullable<Awaited<ReturnType<PokeWarServer['rooms']['get']>>>) => boolean,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const room = await server.rooms.get(roomId);
    if (room && predicate(room)) return room;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('TEST_ROOM_CONDITION_TIMEOUT');
}

describe('Socket.IO room workflow', () => {
  it('creates, joins, readies, starts, and emits private snapshots', async () => {
    activeServer = createPokeWarServer(config);
    const httpServer = activeServer.httpServer;
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS_MISSING');
    const url = `http://127.0.0.1:${String(address.port)}`;
    const host = await connect(url, await guestCookie(activeServer));
    const guest = await connect(url, await guestCookie(activeServer));

    const created = createAckSchema.parse(await emitAck(host, 'room:create', { mode: 'quick' }));
    const roomId = created.room.id;
    okAckSchema.parse(await emitAck(guest, 'room:join', { roomId }));
    okAckSchema.parse(await emitAck(guest, 'room:ready', { roomId, ready: true }));

    const hostSnapshot = nextGameSnapshot(host);
    const guestSnapshot = nextGameSnapshot(guest);
    okAckSchema.parse(await emitAck(host, 'room:start', { roomId }));
    const [hostView, guestView] = await Promise.all([hostSnapshot, guestSnapshot]);

    const hostSelf = selfPlayer(hostView);
    const hostOpponent = hostView.game.players.find((player) => player.id !== hostSelf.id);
    const guestSelf = selfPlayer(guestView);
    expect(hostSelf.hand).toHaveLength(5);
    expect(hostOpponent?.hand).toBeUndefined();
    expect(hostOpponent?.handCount).toBe(5);
    expect(guestSelf.hand).toHaveLength(5);
  });

  it.each([
    { mode: 'quick' as const, label: 'quick playing' },
    { mode: 'normal' as const, label: 'normal starter selection' },
  ])('dissolves a PVE room through dedicated leave during $label', async ({ mode }) => {
    activeServer = createPokeWarServer(config);
    await new Promise<void>((resolve) => activeServer?.httpServer.listen(0, '127.0.0.1', resolve));
    const address = activeServer.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS_MISSING');
    const url = `http://127.0.0.1:${String(address.port)}`;
    const client = await connect(url, await guestCookie(activeServer));
    const snapshotPromise = nextGameSnapshot(client);
    okAckSchema.parse(await emitAck(client, 'pve:start', { mode, targetSize: 4 }));
    const snapshot = await snapshotPromise;
    const roomId = snapshot.game.id;
    const actionId = crypto.randomUUID();

    const ack = pveLeaveAckSchema.parse(await emitAck(client, 'pve:leave', { roomId, actionId }));
    expect(ack).toMatchObject({ roomId, actionId, leftRoom: true, dissolved: true });
    expect(await activeServer.rooms.get(roomId)).toBeNull();
  });

  it('dissolves PVE while a bot owns the quick-mode turn', async () => {
    const roomStore = new MemoryRoomStore();
    activeServer = createPokeWarServer(config, { roomStore });
    await new Promise<void>((resolve) => activeServer?.httpServer.listen(0, '127.0.0.1', resolve));
    const address = activeServer.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS_MISSING');
    const url = `http://127.0.0.1:${String(address.port)}`;
    const client = await connect(url, await guestCookie(activeServer));
    const snapshotPromise = nextGameSnapshot(client);
    okAckSchema.parse(await emitAck(client, 'pve:start', { mode: 'quick', targetSize: 4 }));
    const snapshot = await snapshotPromise;
    const roomId = snapshot.game.id;
    const room = await activeServer.rooms.get(roomId);
    if (!room?.game) throw new Error('PVE_GAME_REQUIRED');
    const bot = room.game.players.find((player) => player.id.startsWith('bot:'));
    if (!bot) throw new Error('BOT_REQUIRED');
    const storeRoom = { ...room, game: { ...room.game, currentPlayerId: bot.id } };
    await roomStore.save(storeRoom);
    const actionId = crypto.randomUUID();
    const ack = pveLeaveAckSchema.parse(await emitAck(client, 'pve:leave', { roomId, actionId }));
    expect(ack.dissolved).toBe(true);
    expect(await activeServer.rooms.get(roomId)).toBeNull();
  });

  it('restores lobby membership after reconnecting with the same guest cookie', async () => {
    activeServer = createPokeWarServer(config);
    await new Promise<void>((resolve) => activeServer?.httpServer.listen(0, '127.0.0.1', resolve));
    const address = activeServer.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS_MISSING');
    const url = `http://127.0.0.1:${String(address.port)}`;
    const cookie = await guestCookie(activeServer);
    const first = await connect(url, cookie);
    const created = createAckSchema.parse(await emitAck(first, 'room:create', { mode: 'normal' }));
    first.disconnect();

    const restoredSnapshot = new Promise<unknown>((resolve) => {
      const second = createClient(url, {
        transports: ['websocket'],
        extraHeaders: { Cookie: cookie, Origin: 'http://localhost:5173' },
      });
      clients.push(second);
      second.on('room:snapshot', resolve);
    });
    expect((await restoredSnapshot) as { id?: string }).toMatchObject({ id: created.room.id });
  });

  it('starts and clears the canonical disconnect deadline across reconnect', async () => {
    activeServer = createPokeWarServer(config);
    await new Promise<void>((resolve) => activeServer?.httpServer.listen(0, '127.0.0.1', resolve));
    const address = activeServer.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS_MISSING');
    const url = `http://127.0.0.1:${String(address.port)}`;
    const hostCookie = await guestCookie(activeServer);
    const guestCookieValue = await guestCookie(activeServer);
    const host = await connect(url, hostCookie);
    const guest = await connect(url, guestCookieValue);
    const created = createAckSchema.parse(await emitAck(host, 'room:create', { mode: 'quick' }));
    const roomId = created.room.id;
    okAckSchema.parse(await emitAck(guest, 'room:join', { roomId }));
    okAckSchema.parse(await emitAck(guest, 'room:ready', { roomId, ready: true }));
    const guestStartedSnapshot = nextGameSnapshot(guest);
    okAckSchema.parse(await emitAck(host, 'room:start', { roomId }));
    const guestView = await guestStartedSnapshot;
    const guestId = guestView.members.find((member) => member.isSelf)?.identityId;
    if (!guestId) throw new Error('TEST_GUEST_ID_MISSING');

    guest.disconnect();
    await waitForRoom(
      activeServer,
      roomId,
      (room) =>
        room.game?.players.some(
          (player) =>
            player.id === guestId && !player.connected && player.disconnectDeadline !== null,
        ) ?? false,
    );
    await connect(url, guestCookieValue);
    const restored = await waitForRoom(
      activeServer,
      roomId,
      (room) =>
        room.game?.players.some(
          (player) =>
            player.id === guestId && player.connected && player.disconnectDeadline === null,
        ) ?? false,
    );
    expect(restored.members.find((member) => member.identityId === guestId)?.connected).toBe(true);
  });
});
