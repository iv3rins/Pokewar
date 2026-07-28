import {
  matchmakingAcceptPayloadSchema,
  matchmakingModePayloadSchema,
  roomCommandSchema,
  type MatchmakingState,
} from '@pokewar/protocol';
import { randomBytes } from 'node:crypto';
import type { Server } from 'socket.io';
import { z } from 'zod';
import type { ServerConfig } from '../config/config.js';
import type { AuthService } from '../auth/authService.js';
import { resolveIdentity } from '../auth/resolveIdentity.js';
import type { GuestIdentity, GuestIdentityStore } from '../identity/guest.js';
import type { MatchmakingResult, MatchmakingService } from '../matchmaking/matchmakingService.js';
import type { BotService } from '../bot/botService.js';
import { projectRoom } from '../rooms/projection.js';
import type { RoomService } from '../rooms/roomService.js';
import type { RoomMembershipStore } from '../rooms/membershipStore.js';
import type { RoomState } from '../rooms/model.js';

const roomIdPayload = z.object({
  roomId: z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/),
});
const createPayload = z.object({ mode: z.enum(['normal', 'quick']).default('normal') });
const readyPayload = roomIdPayload.extend({ ready: z.boolean() });
const modePayload = roomIdPayload.extend({ mode: z.enum(['normal', 'quick']) });
const kickPayload = roomIdPayload.extend({ targetIdentityId: z.string().min(1).max(80) });
const pveLeavePayload = roomIdPayload.extend({ actionId: z.uuid() });
type Ack = (payload: unknown) => void;
type SocketHandler = (payload: unknown, ack: Ack) => Promise<unknown>;

function reportLifecycleError(error: unknown): void {
  console.error('[socket:lifecycle]', error);
}

function safeHandler(handler: SocketHandler): (payload: unknown, ack: Ack) => void {
  return (payload, ack) => {
    void handler(payload, ack).catch((error: unknown) => {
      console.error('[socket:handler]', error);
      ack({ ok: false, code: 'INTERNAL_ERROR' });
    });
  };
}

export function broadcastMatchmaking(
  io: Server,
  updates: ReadonlyMap<string, MatchmakingState>,
): void {
  for (const [identityId, state] of updates) {
    io.to(`identity:${identityId}`).emit('matchmaking:state', state);
  }
}

export function broadcastRoom(io: Server, room: RoomState): void {
  for (const member of room.members) {
    io.to(`identity:${member.identityId}`).emit(
      'room:snapshot',
      projectRoom(room, member.identityId),
    );
  }
}

export function setupSocket(
  io: Server,
  config: ServerConfig,
  identities: GuestIdentityStore,
  rooms: RoomService,
  memberships: RoomMembershipStore,
  auth: AuthService,
  matchmaking: MatchmakingService,
  bots: BotService,
): void {
  const controllingSocket = new Map<string, string>();
  const socketIdentities = new Map<string, GuestIdentity>();

  io.use((socket, next) => {
    void resolveIdentity(
      socket.handshake.headers.cookie,
      config,
      identities,
      auth,
      Date.now(),
    ).then(
      (resolved) => {
        if (!resolved) return next(new Error('IDENTITY_REQUIRED'));
        socketIdentities.set(socket.id, resolved.identity);
        next();
      },
      (error: unknown) =>
        next(error instanceof Error ? error : new Error('IDENTITY_LOOKUP_FAILED')),
    );
  });

  io.on('connection', (socket) => {
    const identity = socketIdentities.get(socket.id);
    if (!identity) {
      socket.disconnect(true);
      return;
    }
    const previous = controllingSocket.get(identity.id);
    if (previous && previous !== socket.id) io.to(previous).emit('identity:control-lost');
    controllingSocket.set(identity.id, socket.id);

    const canControl = () => controllingSocket.get(identity.id) === socket.id;
    const rejectReadOnly = (ack: Ack) => {
      if (canControl()) return false;
      ack({ ok: false, code: 'READ_ONLY_CONNECTION' });
      return true;
    };
    void socket.join(`identity:${identity.id}`);
    void matchmaking
      .state(identity.id)
      .then((state) => socket.emit('matchmaking:state', state))
      .catch(reportLifecycleError);
    void memberships
      .get(identity.id)
      .then(async (roomId) => {
        if (!roomId) return;
        const room = await rooms.get(roomId);
        if (!room?.members.some((member) => member.identityId === identity.id)) {
          await memberships.delete(identity.id);
          return;
        }
        await socket.join(roomId);
        const connected = await rooms.setConnection(roomId, identity.id, true, Date.now());
        const current = connected.ok ? connected.value : room;
        if (current) {
          broadcastRoom(io, current);
          socket.emit('room:snapshot', projectRoom(current, identity.id));
        }
      })
      .catch(reportLifecycleError);

    const publishMatchmaking = (result: MatchmakingResult) => {
      if (!result.ok) return;
      broadcastMatchmaking(io, result.updates);
      for (const room of result.rooms ?? []) broadcastRoom(io, room);
    };
    const dissolvePve = async (room: RoomState) => {
      if (room.kind !== 'pve') return false;
      const dissolved = await rooms.dissolvePve(room.id, identity.id);
      if (!dissolved) return false;
      await memberships.delete(identity.id);
      await socket.leave(room.id);
      return true;
    };

    socket.on(
      'matchmaking:enqueue',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = matchmakingModePayloadSchema.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const result = await matchmaking.enqueue(
          identity,
          parsed.data.mode,
          parsed.data.targetSize,
          parsed.data.allowFallback,
          Date.now(),
        );
        publishMatchmaking(result);
        return ack(result.ok ? { ok: true } : result);
      }),
    );

    socket.on(
      'pve:start',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = z
          .object({
            mode: z.enum(['normal', 'quick']),
            targetSize: z.union([z.literal(4), z.literal(8), z.literal(12)]),
          })
          .safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        if (await memberships.get(identity.id))
          return ack({ ok: false, code: 'MATCHMAKING_ROOM_CONFLICT' });
        const room = await rooms.createPveRoom(
          identity,
          parsed.data.mode,
          parsed.data.targetSize,
          Date.now(),
        );
        await memberships.set(identity.id, room.id);
        broadcastRoom(io, room);
        void bots.executeBotSequence(room.id, (updated) => {
          broadcastRoom(io, updated);
          const human = updated.game?.players.find((player) => player.id === identity.id);
          if (updated.kind === 'pve' && human?.eliminated) void dissolvePve(updated);
        });
        return ack({ ok: true });
      }),
    );

    socket.on(
      'pve:leave',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = pveLeavePayload.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const { roomId, actionId } = parsed.data;
        if (config.nodeEnv === 'development') {
          console.info('[pve:leave] received', { roomId, actionId, identityId: identity.id });
        }
        const room = await rooms.get(roomId);
        if (!room) {
          await memberships.delete(identity.id);
          await socket.leave(roomId);
          if (config.nodeEnv === 'development') {
            console.info('[pve:leave] already-dissolved', { roomId, actionId });
          }
          return ack({ ok: true, roomId, actionId, leftRoom: true, dissolved: true });
        }
        if (room.kind !== 'pve') return ack({ ok: false, code: 'INVALID_PHASE' });
        if (!room.members.some((member) => member.identityId === identity.id)) {
          return ack({ ok: false, code: 'NOT_ROOM_MEMBER' });
        }
        const dissolved = await rooms.dissolvePve(roomId, identity.id);
        await memberships.delete(identity.id);
        await socket.leave(roomId);
        if (config.nodeEnv === 'development') {
          console.info('[pve:leave] cleaned', {
            roomId,
            actionId,
            dissolved,
            membershipCleared: true,
          });
        }
        return ack({ ok: true, roomId, actionId, leftRoom: true, dissolved });
      }),
    );

    socket.on(
      'matchmaking:cancel',
      safeHandler(async (_payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const result = await matchmaking.cancel(identity.id, Date.now());
        publishMatchmaking(result);
        return ack(result.ok ? { ok: true } : result);
      }),
    );

    socket.on(
      'matchmaking:accept',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = matchmakingAcceptPayloadSchema.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const result = await matchmaking.accept(identity.id, parsed.data.proposalId, Date.now());
        publishMatchmaking(result);
        return ack(result.ok ? { ok: true } : result);
      }),
    );

    socket.on(
      'matchmaking:decline',
      safeHandler(async (_payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const result = await matchmaking.cancel(identity.id, Date.now());
        publishMatchmaking(result);
        return ack(result.ok ? { ok: true } : result);
      }),
    );

    socket.on(
      'matchmaking:get-state',
      safeHandler(async (_payload: unknown, ack: Ack) => {
        return ack({ ok: true, state: await matchmaking.state(identity.id) });
      }),
    );

    socket.on(
      'room:create',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = createPayload.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const guarded = await matchmaking.runIfIdle(identity.id, () =>
          rooms.create(identity, parsed.data.mode, Date.now()),
        );
        if (!guarded.ok) return ack({ ok: false, code: 'MATCHMAKING_ALREADY_ACTIVE' });
        const room = guarded.value;
        await memberships.set(identity.id, room.id);
        await socket.join(room.id);
        broadcastRoom(io, room);
        return ack({ ok: true, room: projectRoom(room, identity.id) });
      }),
    );

    socket.on(
      'room:join',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = roomIdPayload.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const guarded = await matchmaking.runIfIdle(identity.id, () =>
          rooms.join(parsed.data.roomId, identity, Date.now()),
        );
        if (!guarded.ok) return ack({ ok: false, code: 'MATCHMAKING_ALREADY_ACTIVE' });
        const result = guarded.value;
        if (!result.ok) return ack(result);
        await memberships.set(identity.id, result.value.id);
        await socket.join(result.value.id);
        broadcastRoom(io, result.value);
        return ack({ ok: true, room: projectRoom(result.value, identity.id) });
      }),
    );

    socket.on(
      'room:leave',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = roomIdPayload.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const result = await rooms.leaveLobby(parsed.data.roomId, identity.id, Date.now());
        if (!result.ok) return ack(result);
        await memberships.delete(identity.id);
        await socket.leave(parsed.data.roomId);
        socket.emit('room:left', { roomId: parsed.data.roomId });
        if (result.value) broadcastRoom(io, result.value);
        return ack({ ok: true });
      }),
    );

    socket.on(
      'room:ready',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = readyPayload.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const result = await rooms.setReady(
          parsed.data.roomId,
          identity.id,
          parsed.data.ready,
          Date.now(),
        );
        if (!result.ok) return ack(result);
        broadcastRoom(io, result.value);
        return ack({ ok: true, version: result.value.version });
      }),
    );

    socket.on(
      'room:mode',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = modePayload.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const result = await rooms.setMode(
          parsed.data.roomId,
          identity.id,
          parsed.data.mode,
          Date.now(),
        );
        if (!result.ok) return ack(result);
        broadcastRoom(io, result.value);
        return ack({ ok: true, version: result.value.version });
      }),
    );

    socket.on(
      'room:kick',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = kickPayload.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const result = await rooms.kick(
          parsed.data.roomId,
          identity.id,
          parsed.data.targetIdentityId,
          Date.now(),
        );
        if (!result.ok) return ack(result);
        broadcastRoom(io, result.value);
        await memberships.delete(parsed.data.targetIdentityId);
        io.to(`identity:${parsed.data.targetIdentityId}`).emit('room:kicked', {
          roomId: result.value.id,
        });
        return ack({ ok: true, version: result.value.version });
      }),
    );

    socket.on(
      'room:start',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = roomIdPayload.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const result = await rooms.start(
          parsed.data.roomId,
          identity.id,
          randomBytes(32).toString('hex'),
          Date.now(),
        );
        if (!result.ok) return ack(result);
        broadcastRoom(io, result.value);
        return ack({ ok: true, version: result.value.version });
      }),
    );

    socket.on(
      'game:return-lobby',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = roomIdPayload.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const room = await rooms.get(parsed.data.roomId);
        if (!room?.members.some((member) => member.identityId === identity.id)) {
          return ack({ ok: false, code: 'NOT_ROOM_MEMBER' });
        }
        if (room.game?.phase !== 'GAME_OVER') return ack({ ok: false, code: 'INVALID_PHASE' });
        await memberships.delete(identity.id);
        await socket.leave(parsed.data.roomId);
        socket.emit('room:left', { roomId: parsed.data.roomId });
        return ack({ ok: true });
      }),
    );

    socket.on(
      'game:command',
      safeHandler(async (payload: unknown, ack: Ack) => {
        if (rejectReadOnly(ack)) return;
        const parsed = roomCommandSchema.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, code: 'INVALID_PAYLOAD' });
        const result = await rooms.command(identity.id, parsed.data, Date.now());
        if (!result.ok) return ack(result);
        broadcastRoom(io, result.value.room);
        const selfPlayer = result.value.room.game?.players.find(
          (player) => player.id === identity.id,
        );
        const shouldDissolve =
          result.value.room.kind === 'pve' &&
          (selfPlayer?.eliminated === true || parsed.data.kind === 'game:leave-match');
        if (shouldDissolve) await dissolvePve(result.value.room);
        else
          void bots.executeBotSequence(result.value.room.id, (updated) => {
            broadcastRoom(io, updated);
            const human = updated.game?.players.find((player) => player.id === identity.id);
            if (updated.kind === 'pve' && human?.eliminated) void dissolvePve(updated);
          });
        return ack({
          ok: true,
          roomVersion: result.value.roomVersion,
          gameVersion: result.value.gameVersion,
          events: result.value.events,
        });
      }),
    );

    socket.on('disconnect', () => {
      socketIdentities.delete(socket.id);
      if (controllingSocket.get(identity.id) !== socket.id) return;
      controllingSocket.delete(identity.id);
      void memberships
        .get(identity.id)
        .then(async (roomId) => {
          if (!roomId || controllingSocket.has(identity.id)) return;
          const room = await rooms.get(roomId);
          if (room?.kind === 'pve') {
            await rooms.dissolvePve(roomId, identity.id);
            await memberships.delete(identity.id);
            return;
          }
          const result = await rooms.setConnection(roomId, identity.id, false, Date.now());
          if (result.ok && result.value) broadcastRoom(io, result.value);
        })
        .catch(reportLifecycleError);
    });
  });
}
