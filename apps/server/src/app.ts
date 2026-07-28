import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { AuthService } from './auth/authService.js';
import { MemoryAccountRepository, type AccountRepository } from './auth/accountRepository.js';
import { MemoryLoginRateLimit, type LoginRateLimit } from './auth/loginRateLimit.js';
import type { ServerConfig } from './config/config.js';
import { MatchmakingService } from './matchmaking/matchmakingService.js';
import { MemoryMatchmakingStore, type MatchmakingStore } from './matchmaking/matchmakingStore.js';
import { createAuthRouter } from './http/authRoutes.js';
import { createGuestRouter } from './http/guestRoutes.js';
import { createProfileRouter } from './http/profileRoutes.js';
import { createReplayRouter } from './http/replayRoutes.js';
import { MemoryGuestIdentityStore, type GuestIdentityStore } from './identity/guest.js';
import { setupSocket } from './realtime/socket.js';
import { NullReplayRepository, type ReplayRepository } from './db/replayRepository.js';
import { MemoryRatingRepository, type RatingRepository } from './rating/ratingRepository.js';
import { RoomLock, type RoomLockAdapter } from './rooms/lock.js';
import {
  MemoryChatMessageStore,
  MemoryRoomMembershipStore,
  type ChatMessageStore,
  type RoomMembershipStore,
} from './rooms/membershipStore.js';
import { RoomService } from './rooms/roomService.js';
import { MemoryRoomStore, type RoomStore } from './storage/roomStore.js';
import { BotService } from './bot/botService.js';

export interface AppDependencies {
  readonly identities?: GuestIdentityStore;
  readonly roomStore?: RoomStore;
  readonly roomLock?: RoomLockAdapter;
  readonly replays?: ReplayRepository;
  readonly memberships?: RoomMembershipStore;
  readonly chat?: ChatMessageStore;
  readonly accounts?: AccountRepository;
  readonly loginRateLimit?: LoginRateLimit;
  readonly ratings?: RatingRepository;
  readonly matchmakingStore?: MatchmakingStore;
  readonly matchmakingLock?: RoomLockAdapter;
  readonly storageName?: 'memory' | 'redis';
}

export interface PokeWarServer {
  readonly app: express.Express;
  readonly httpServer: HttpServer;
  readonly io: Server;
  readonly rooms: RoomService;
  readonly matchmaking: MatchmakingService;
  readonly bots: BotService;
}

export function createPokeWarServer(
  config: ServerConfig,
  dependencies: AppDependencies = {},
): PokeWarServer {
  const identities = dependencies.identities ?? new MemoryGuestIdentityStore();
  const accounts = dependencies.accounts ?? new MemoryAccountRepository();
  const auth = new AuthService(accounts, identities);
  const loginRateLimit = dependencies.loginRateLimit ?? new MemoryLoginRateLimit();
  const ratings = dependencies.ratings ?? new MemoryRatingRepository();
  const roomStore = dependencies.roomStore ?? new MemoryRoomStore();
  const replays = dependencies.replays ?? new NullReplayRepository();
  const rooms = new RoomService(
    roomStore,
    dependencies.roomLock ?? new RoomLock(),
    replays,
    ratings,
  );
  const memberships = dependencies.memberships ?? new MemoryRoomMembershipStore();
  const matchmaking = new MatchmakingService(
    dependencies.matchmakingStore ?? new MemoryMatchmakingStore(),
    dependencies.matchmakingLock ?? dependencies.roomLock ?? new RoomLock(),
    rooms,
    memberships,
    ratings,
  );
  const bots = new BotService(rooms);
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: [...config.corsOrigins], credentials: true }));
  app.use(express.json({ limit: '16kb' }));
  app.get('/', (_request, response) =>
    response.json({
      service: 'pokewar-server',
      status: 'ok',
      health: '/api/health',
    }),
  );
  app.get('/api/health', (_request, response) =>
    response.json({ ok: true, storage: dependencies.storageName ?? 'memory' }),
  );
  app.use('/api/guest', createGuestRouter(config, identities, auth));
  app.use('/api/auth', createAuthRouter(config, identities, auth, loginRateLimit));
  app.use('/api/profile', createProfileRouter(config, identities, auth, ratings));
  app.use('/api/replays', createReplayRouter(config, identities, replays, auth));
  app.use((_request, response) => response.status(404).json({ code: 'NOT_FOUND' }));
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      void next;
      console.error('[http:error]', error);
      response.status(500).json({ code: 'INTERNAL_ERROR' });
    },
  );

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: [...config.corsOrigins], credentials: true },
    transports: ['websocket'],
  });
  setupSocket(
    io,
    config,
    identities,
    rooms,
    memberships,
    dependencies.chat ?? new MemoryChatMessageStore(),
    auth,
    matchmaking,
    bots,
  );
  return { app, httpServer, io, rooms, matchmaking, bots };
}
