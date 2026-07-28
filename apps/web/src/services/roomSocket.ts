import {
  matchmakingStateSchema,
  roomProjectionSchema,
  type GameMode,
  type RoomCommand,
  type MatchSize,
  type MatchmakingState,
  type RoomProjection,
} from '@pokewar/protocol';
import { io, type Socket } from 'socket.io-client';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'read-only';
export type GameCommandIntent = RoomCommand extends infer Command
  ? Command extends RoomCommand
    ? Omit<Command, 'actionId'>
    : never
  : never;
export type GameAction = RoomCommand extends infer Command
  ? Command extends RoomCommand
    ? Omit<Command, 'actionId' | 'roomId' | 'expectedVersion'>
    : never
  : never;

export interface AckResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly room?: unknown;
  readonly roomId?: string;
  readonly actionId?: string;
  readonly leftRoom?: boolean;
  readonly dissolved?: boolean;
}

export interface RoomSocketHandlers {
  onConnection(state: ConnectionState): void;
  onRoom(room: RoomProjection): void;
  onError(code: string): void;
  onKicked(): void;
  onLeft(): void;
  onMatchmaking(state: MatchmakingState): void;
}

export interface RoomSocketClient {
  create(mode: GameMode): Promise<AckResult>;
  join(roomId: string): Promise<AckResult>;
  leave(roomId: string): Promise<AckResult>;
  ready(roomId: string, ready: boolean): Promise<AckResult>;
  mode(roomId: string, mode: GameMode): Promise<AckResult>;
  kick(roomId: string, targetIdentityId: string): Promise<AckResult>;
  start(roomId: string): Promise<AckResult>;
  startPve(mode: GameMode, targetSize: 4 | 8 | 12): Promise<AckResult>;
  leavePve(roomId: string): Promise<AckResult>;
  selectStarter(roomId: string, expectedVersion: number, characterId: string): Promise<AckResult>;
  gameCommand(command: GameCommandIntent): Promise<AckResult>;
  returnToLobby(roomId: string): Promise<AckResult>;
  enqueue(mode: GameMode, targetSize: MatchSize, allowFallback: boolean): Promise<AckResult>;
  cancelMatchmaking(): Promise<AckResult>;
  acceptMatch(proposalId: string): Promise<AckResult>;
  declineMatch(): Promise<AckResult>;
  disconnect(): void;
}

function emit(socket: Socket, event: string, payload: unknown): Promise<AckResult> {
  return new Promise((resolve) => {
    socket.timeout(8_000).emit(event, payload, (error: Error | null, response: AckResult) => {
      resolve(error ? { ok: false, code: 'REQUEST_TIMEOUT' } : response);
    });
  });
}

export function createRoomSocket(handlers: RoomSocketHandlers): RoomSocketClient {
  const socket = io({ transports: ['websocket'], withCredentials: true, autoConnect: true });
  const acceptRoom = (value: unknown) => {
    const parsed = roomProjectionSchema.safeParse(value);
    if (parsed.success) handlers.onRoom(parsed.data);
    else handlers.onError('INVALID_SERVER_PAYLOAD');
  };
  socket.on('connect', () => handlers.onConnection('connected'));
  socket.on('disconnect', () => handlers.onConnection('disconnected'));
  socket.on('connect_error', () => handlers.onConnection('disconnected'));
  socket.on('identity:control-lost', () => handlers.onConnection('read-only'));
  socket.on('room:snapshot', acceptRoom);
  socket.on('room:kicked', () => handlers.onKicked());
  socket.on('room:left', () => handlers.onLeft());
  socket.on('matchmaking:state', (value: unknown) => {
    const parsed = matchmakingStateSchema.safeParse(value);
    if (parsed.success) handlers.onMatchmaking(parsed.data);
    else handlers.onError('INVALID_SERVER_PAYLOAD');
  });

  const request = async (event: string, payload: unknown): Promise<AckResult> => {
    const result = await emit(socket, event, payload);
    if (result.room) acceptRoom(result.room);
    if (!result.ok && result.code) handlers.onError(result.code);
    return result;
  };
  return {
    create: (mode) => request('room:create', { mode }),
    join: (roomId) => request('room:join', { roomId }),
    leave: (roomId) => request('room:leave', { roomId }),
    ready: (roomId, ready) => request('room:ready', { roomId, ready }),
    mode: (roomId, mode) => request('room:mode', { roomId, mode }),
    kick: (roomId, targetIdentityId) => request('room:kick', { roomId, targetIdentityId }),
    start: (roomId) => request('room:start', { roomId }),
    startPve: (mode, targetSize) => request('pve:start', { mode, targetSize }),
    leavePve: async (roomId) => {
      const actionId = crypto.randomUUID();
      if (import.meta.env.DEV) console.info('[pve:leave] send', { roomId, actionId });
      const result = await request('pve:leave', { roomId, actionId });
      if (import.meta.env.DEV) console.info('[pve:leave] ack', { roomId, actionId, result });
      return result;
    },
    selectStarter: (roomId, expectedVersion, characterId) =>
      request('game:command', {
        roomId,
        actionId: crypto.randomUUID(),
        expectedVersion,
        kind: 'game:select-starter',
        characterId,
      }),
    gameCommand: (command) =>
      request('game:command', { ...command, actionId: crypto.randomUUID() }),
    returnToLobby: (roomId) => request('game:return-lobby', { roomId }),
    enqueue: (mode, targetSize, allowFallback) =>
      request('matchmaking:enqueue', { mode, targetSize, allowFallback }),
    cancelMatchmaking: () => request('matchmaking:cancel', {}),
    acceptMatch: (proposalId) => request('matchmaking:accept', { proposalId }),
    declineMatch: () => request('matchmaking:decline', {}),
    disconnect: () => socket.disconnect(),
  };
}
