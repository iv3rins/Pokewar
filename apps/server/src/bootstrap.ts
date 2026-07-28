import { createAdapter } from '@socket.io/redis-adapter';
import { MemoryAccountRepository, type AccountRepository } from './auth/accountRepository.js';
import {
  MemoryLoginRateLimit,
  RedisLoginRateLimit,
  type LoginRateLimit,
} from './auth/loginRateLimit.js';
import { PostgresAccountRepository } from './auth/postgresAccountRepository.js';
import { PostgresRatingRepository } from './rating/postgresRatingRepository.js';
import { MemoryRatingRepository, type RatingRepository } from './rating/ratingRepository.js';
import { Pool } from 'pg';
import { MemoryMatchmakingStore, type MatchmakingStore } from './matchmaking/matchmakingStore.js';
import { RedisMatchmakingStore } from './matchmaking/redisMatchmakingStore.js';
import { startMatchmakingWorker } from './matchmaking/matchmakingWorker.js';
import { BotService } from './bot/botService.js';
import { createPokeWarServer, type PokeWarServer } from './app.js';
import { broadcastMatchmaking, broadcastRoom } from './realtime/socket.js';
import type { ServerConfig } from './config/config.js';
import { PostgresReplayRepository } from './db/postgresReplayRepository.js';
import { startReplayCleanup } from './db/replayCleanup.js';
import { NullReplayRepository, type ReplayRepository } from './db/replayRepository.js';
import { MemoryGuestIdentityStore, type GuestIdentityStore } from './identity/guest.js';
import { RedisGuestIdentityStore } from './identity/redisGuestStore.js';
import { RoomLock, type RoomLockAdapter } from './rooms/lock.js';
import {
  MemoryChatMessageStore,
  MemoryRoomMembershipStore,
  type ChatMessageStore,
  type RoomMembershipStore,
} from './rooms/membershipStore.js';
import { RedisChatMessageStore } from './rooms/redisChatMessageStore.js';
import { RedisRoomMembershipStore } from './rooms/redisMembershipStore.js';
import { MemoryDeadlineStore, type DeadlineStore } from './scheduler/deadlineStore.js';
import { startDeadlineWorker } from './scheduler/deadlineWorker.js';
import { RedisDeadlineStore } from './scheduler/redisDeadlineStore.js';
import { RedisRoomLock } from './rooms/redisLock.js';
import { createRedisClients, type RedisClients } from './storage/redisClients.js';
import { IndexedRoomStore } from './storage/indexedRoomStore.js';
import { RedisIndexedRoomStore } from './storage/redisIndexedRoomStore.js';
import { MemoryRoomStore, type RoomStore } from './storage/roomStore.js';

export interface RunningPokeWarServer extends PokeWarServer {
  closeInfrastructure(): Promise<void>;
}

export async function bootstrapServer(config: ServerConfig): Promise<RunningPokeWarServer> {
  let redis: RedisClients | null = null;
  let identities: GuestIdentityStore = new MemoryGuestIdentityStore();
  let roomStore: RoomStore = new MemoryRoomStore();
  let deadlines: DeadlineStore = new MemoryDeadlineStore();
  let roomLock: RoomLockAdapter = new RoomLock();
  let memberships: RoomMembershipStore = new MemoryRoomMembershipStore();
  let chat: ChatMessageStore = new MemoryChatMessageStore();
  let replays: ReplayRepository = new NullReplayRepository();
  let accounts: AccountRepository = new MemoryAccountRepository();
  let loginRateLimit: LoginRateLimit = new MemoryLoginRateLimit();
  let ratings: RatingRepository = new MemoryRatingRepository();
  let matchmakingStore: MatchmakingStore = new MemoryMatchmakingStore();
  let stopReplayCleanup: () => void = () => undefined;

  if (config.redisUrl) {
    redis = await createRedisClients(config.redisUrl);
    identities = new RedisGuestIdentityStore(redis.command, config.redisPrefix);
    roomStore = new RedisIndexedRoomStore(redis.command, config.redisPrefix);
    deadlines = new RedisDeadlineStore(redis.command, config.redisPrefix);
    roomLock = new RedisRoomLock(redis.command, config.redisPrefix);
    memberships = new RedisRoomMembershipStore(redis.command, config.redisPrefix);
    chat = new RedisChatMessageStore(redis.command, config.redisPrefix);
    loginRateLimit = new RedisLoginRateLimit(redis.command, config.redisPrefix);
    matchmakingStore = new RedisMatchmakingStore(redis.command, config.redisPrefix);
  }
  if (config.databaseUrl) {
    replays = new PostgresReplayRepository(new Pool({ connectionString: config.databaseUrl }));
    accounts = new PostgresAccountRepository(new Pool({ connectionString: config.databaseUrl }));
    ratings = new PostgresRatingRepository(new Pool({ connectionString: config.databaseUrl }));
    stopReplayCleanup = startReplayCleanup(replays);
  }

  if (!redis) roomStore = new IndexedRoomStore(roomStore, deadlines);
  const server = createPokeWarServer(config, {
    identities,
    roomStore,
    roomLock,
    replays,
    memberships,
    chat,
    accounts,
    loginRateLimit,
    ratings,
    matchmakingStore,
    matchmakingLock: roomLock,
    storageName: redis ? 'redis' : 'memory',
  });
  if (redis) server.io.adapter(createAdapter(redis.publisher, redis.subscriber));
  const bots = new BotService(server.rooms);
  const deadlineWorker = startDeadlineWorker(deadlines, server.rooms, {
    onRoomUpdated: (room) => {
      broadcastRoom(server.io, room);
      void bots.executeBotSequence(room.id, (updated) => broadcastRoom(server.io, updated));
    },
  });
  const stopMatchmakingWorker = startMatchmakingWorker(server.matchmaking, {
    onUpdates: (updates) => broadcastMatchmaking(server.io, updates),
    onRoom: (room) => broadcastRoom(server.io, room),
  });

  return {
    ...server,
    async closeInfrastructure() {
      deadlineWorker.stop();
      stopMatchmakingWorker();
      stopReplayCleanup();
      await Promise.all([
        deadlines.close(),
        replays.close(),
        accounts.close(),
        ratings.close(),
        matchmakingStore.close(),
        redis?.close() ?? Promise.resolve(),
      ]);
    },
  };
}
