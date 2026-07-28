import {
  createGame,
  decide,
  type DomainEvent,
  type GameCommand,
  type GameMode,
  type TransitionResult,
} from '@pokewar/domain';
import type { RoomCommand } from '@pokewar/protocol';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ReplayRepository } from '../db/replayRepository.js';
import type { RatingRepository } from '../rating/ratingRepository.js';
import { deadlineCommand, gameForDeadline, type DeadlineTask } from '../scheduler/deadline.js';
import { NullReplayRepository } from '../db/replayRepository.js';
import { createBotIdentity, type GuestIdentity } from '../identity/guest.js';
import type { AcceptedActionResult, RoomMutation, RoomState } from './model.js';
import type { RoomLockAdapter } from './lock.js';
import type { RoomStore } from '../storage/roomStore.js';

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 12;
const KICK_BAN_MS = 30_000;

export class RoomService {
  constructor(
    private readonly store: RoomStore,
    private readonly lock: RoomLockAdapter,
    private readonly replays: ReplayRepository = new NullReplayRepository(),
    private readonly ratings?: RatingRepository,
  ) {}

  async allocateRoomId(): Promise<string> {
    return this.createRoomId();
  }

  async create(identity: GuestIdentity, mode: GameMode, now: number): Promise<RoomState> {
    const id = await this.createRoomId();
    const room: RoomState = {
      id,
      version: 0,
      hostIdentityId: identity.id,
      kind: 'private',
      mode,
      members: [
        {
          identityId: identity.id,
          displayName: identity.displayName,
          ready: true,
          connected: true,
          joinedAt: now,
        },
      ],
      bannedUntil: {},
      game: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.save(room);
    return room;
  }

  async createMatchmade(
    roomId: string,
    players: readonly GuestIdentity[],
    mode: GameMode,
    seed: string,
    now: number,
    kind: 'matchmade' | 'pve' = 'matchmade',
    ranked = false,
  ): Promise<RoomState> {
    if (![4, 8, 12].includes(players.length)) throw new Error('INVALID_MATCHMADE_PLAYER_COUNT');
    if (new Set(players.map((player) => player.id)).size !== players.length) {
      throw new Error('DUPLICATE_MATCHMADE_PLAYER');
    }
    return this.lock.run(roomId, async () => {
      const existing = await this.store.get(roomId);
      if (existing) {
        const expectedIds = players.map((player) => player.id).sort();
        const existingIds = existing.members.map((member) => member.identityId).sort();
        if (
          existing.kind === kind &&
          existing.mode === mode &&
          existingIds.join('|') === expectedIds.join('|') &&
          existing.game
        ) {
          return existing;
        }
        throw new Error('MATCHMADE_ROOM_ID_COLLISION');
      }
      const members = players.map((player) => ({
        identityId: player.id,
        displayName: player.displayName,
        ready: true,
        connected: true,
        joinedAt: now,
      }));
      const game = createGame({
        id: roomId,
        mode,
        players: players.map((player) => ({
          id: player.id,
          displayName: player.displayName,
          ...(player.avatarId ? { avatarId: player.avatarId } : {}),
        })),
        seed,
        now,
      });
      const firstPlayer = players[0];
      if (!firstPlayer) throw new Error('MATCHMADE_HOST_REQUIRED');
      const room: RoomState = {
        id: roomId,
        version: 1,
        hostIdentityId: firstPlayer.id,
        kind,
        ranked,
        mode,
        members,
        bannedUntil: {},
        game,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.save(room);
      return room;
    });
  }

  async createPveRoom(
    human: GuestIdentity,
    mode: GameMode,
    targetSize: 4 | 8 | 12,
    now: number,
  ): Promise<RoomState> {
    const roomId = await this.createRoomId();
    const bots: GuestIdentity[] = [];
    for (let i = 0; i < targetSize - 1; i += 1) {
      bots.push(createBotIdentity(`bot:${roomId}:${String(i)}`));
    }
    return this.createMatchmade(
      roomId,
      [human, ...bots],
      mode,
      randomBytes(32).toString('hex'),
      now,
      'pve',
    );
  }

  async get(roomId: string): Promise<RoomState | null> {
    return this.store.get(roomId);
  }

  async dissolvePve(roomId: string, humanId: string): Promise<boolean> {
    return this.lock.run(roomId, async () => {
      const room = await this.store.get(roomId);
      if (room?.kind !== 'pve') return false;
      const human = room.members.find((member) => member.identityId === humanId);
      if (!human || human.identityId.startsWith('bot:')) return false;
      await this.store.delete(roomId);
      return true;
    });
  }

  async executeBotCommand(roomId: string, command: GameCommand): Promise<RoomState | null> {
    return this.lock.run(roomId, async () => {
      const room = await this.store.get(roomId);
      if (!room?.game) return null;
      const result = decide(room.game, command);
      if (!result.ok) return null;
      return this.saveTransition(room, result, command.now);
    });
  }

  async join(roomId: string, identity: GuestIdentity, now: number): Promise<RoomMutation> {
    return this.lock.run(roomId, async () => {
      const room = await this.store.get(roomId);
      if (!room) return { ok: false, code: 'ROOM_NOT_FOUND' };
      if (room.game || room.kind === 'matchmade') {
        return { ok: false, code: 'ROOM_ALREADY_STARTED' };
      }
      if ((room.bannedUntil[identity.id] ?? 0) > now) return { ok: false, code: 'PLAYER_BANNED' };
      if (room.members.some((member) => member.identityId === identity.id)) {
        return { ok: false, code: 'ALREADY_IN_ROOM' };
      }
      if (room.members.length >= MAX_PLAYERS) return { ok: false, code: 'ROOM_FULL' };
      const updated: RoomState = {
        ...room,
        version: room.version + 1,
        members: [
          ...room.members,
          {
            identityId: identity.id,
            displayName: identity.displayName,
            ready: false,
            connected: true,
            joinedAt: now,
          },
        ],
        updatedAt: now,
      };
      await this.store.save(updated);
      return { ok: true, value: updated };
    });
  }

  async leaveLobby(
    roomId: string,
    identityId: string,
    now: number,
  ): Promise<RoomMutation<RoomState | null>> {
    return this.lock.run(roomId, async () => {
      const room = await this.store.get(roomId);
      if (!room) return { ok: false, code: 'ROOM_NOT_FOUND' };
      if (room.game || room.kind === 'matchmade') return { ok: false, code: 'INVALID_PHASE' };
      if (!room.members.some((member) => member.identityId === identityId)) {
        return { ok: false, code: 'NOT_ROOM_MEMBER' };
      }
      const members = room.members.filter((member) => member.identityId !== identityId);
      if (members.length === 0) {
        await this.store.delete(roomId);
        return { ok: true, value: null };
      }
      const nextHost =
        identityId === room.hostIdentityId
          ? members.reduce((earliest, member) =>
              member.joinedAt < earliest.joinedAt ? member : earliest,
            ).identityId
          : room.hostIdentityId;
      const updated: RoomState = {
        ...room,
        version: room.version + 1,
        hostIdentityId: nextHost,
        members: members.map((member) =>
          member.identityId === nextHost ? { ...member, ready: true } : member,
        ),
        updatedAt: now,
      };
      await this.store.save(updated);
      return { ok: true, value: updated };
    });
  }

  async setReady(
    roomId: string,
    identityId: string,
    ready: boolean,
    now: number,
  ): Promise<RoomMutation> {
    return this.updateLobby(roomId, identityId, now, (room) => ({
      ...room,
      members: room.members.map((member) =>
        member.identityId === identityId && identityId !== room.hostIdentityId
          ? { ...member, ready }
          : member,
      ),
    }));
  }

  async setMode(
    roomId: string,
    identityId: string,
    mode: GameMode,
    now: number,
  ): Promise<RoomMutation> {
    return this.updateLobby(
      roomId,
      identityId,
      now,
      (room) => {
        if (room.hostIdentityId !== identityId) return null;
        return {
          ...room,
          mode,
          members: room.members.map((member) =>
            member.identityId === room.hostIdentityId ? member : { ...member, ready: false },
          ),
        };
      },
      'NOT_ROOM_HOST',
    );
  }

  async kick(roomId: string, hostId: string, targetId: string, now: number): Promise<RoomMutation> {
    return this.updateLobby(
      roomId,
      hostId,
      now,
      (room) => {
        if (room.hostIdentityId !== hostId) return null;
        if (targetId === hostId || !room.members.some((member) => member.identityId === targetId))
          return null;
        return {
          ...room,
          members: room.members.filter((member) => member.identityId !== targetId),
          bannedUntil: { ...room.bannedUntil, [targetId]: now + KICK_BAN_MS },
        };
      },
      'NOT_ROOM_HOST',
    );
  }

  async start(roomId: string, hostId: string, seed: string, now: number): Promise<RoomMutation> {
    return this.lock.run(roomId, async () => {
      const room = await this.store.get(roomId);
      if (!room) return { ok: false, code: 'ROOM_NOT_FOUND' };
      if (room.hostIdentityId !== hostId) return { ok: false, code: 'NOT_ROOM_HOST' };
      if (room.kind === 'matchmade') return { ok: false, code: 'INVALID_PHASE' };
      if (room.game) return { ok: false, code: 'ROOM_ALREADY_STARTED' };
      if (room.members.length < 2) return { ok: false, code: 'INVALID_PLAYER_COUNT' };
      if (!room.members.every((member) => member.identityId === hostId || member.ready)) {
        return { ok: false, code: 'NOT_ALL_READY' };
      }
      const game = createGame({
        id: room.id,
        mode: room.mode,
        players: room.members.map((member) => ({
          id: member.identityId,
          displayName: member.displayName,
        })),
        seed,
        now,
      });
      const updated: RoomState = {
        ...room,
        version: room.version + 1,
        game,
        updatedAt: now,
      };
      await this.store.save(updated);
      return { ok: true, value: updated };
    });
  }

  async command(
    identityId: string,
    command: RoomCommand,
    now: number,
  ): Promise<
    RoomMutation<{
      room: RoomState;
      events: readonly DomainEvent[];
      roomVersion: number;
      gameVersion: number;
    }>
  > {
    return this.lock.run(command.roomId, async () => {
      const room = await this.store.get(command.roomId);
      if (!room) return { ok: false, code: 'ROOM_NOT_FOUND' };
      if (!room.members.some((member) => member.identityId === identityId)) {
        return { ok: false, code: 'NOT_ROOM_MEMBER' };
      }
      if (!room.game) return { ok: false, code: 'INVALID_PHASE' };
      const cached = room.acceptedActionResults?.find(
        (result) => result.identityId === identityId && result.actionId === command.actionId,
      );
      if (cached) {
        if (JSON.stringify(cached.command) !== JSON.stringify(command)) {
          return { ok: false, code: 'ACTION_ID_REUSED' };
        }
        return {
          ok: true,
          value: {
            room,
            events: cached.events,
            roomVersion: cached.roomVersion,
            gameVersion: cached.gameVersion,
          },
        };
      }
      const domainCommand = this.toDomainCommand(command, identityId, now);
      const result = decide(room.game, domainCommand);
      if (!result.ok) return { ok: false, code: result.code };
      const nextRoomVersion = room.version + 1;
      const acceptedActionResult: AcceptedActionResult = {
        identityId,
        actionId: command.actionId,
        command,
        roomVersion: nextRoomVersion,
        gameVersion: result.state.version,
        events: result.events,
      };
      const updated = await this.saveTransition(room, result, now, undefined, acceptedActionResult);
      return {
        ok: true,
        value: {
          room: updated,
          events: result.events,
          roomVersion: acceptedActionResult.roomVersion,
          gameVersion: acceptedActionResult.gameVersion,
        },
      };
    });
  }

  async setConnection(
    roomId: string,
    identityId: string,
    connected: boolean,
    now: number,
  ): Promise<RoomMutation<RoomState | null>> {
    return this.lock.run(roomId, async () => {
      const room = await this.store.get(roomId);
      if (!room) return { ok: true, value: null };
      const member = room.members.find((candidate) => candidate.identityId === identityId);
      if (!member) return { ok: true, value: null };
      if (
        member.connected === connected &&
        (!room.game ||
          room.game.players.find((player) => player.id === identityId)?.connected === connected)
      ) {
        return { ok: true, value: room };
      }
      if (!room.game) {
        const updated: RoomState = {
          ...room,
          version: room.version + 1,
          members: room.members.map((candidate) =>
            candidate.identityId === identityId ? { ...candidate, connected } : candidate,
          ),
          updatedAt: now,
        };
        await this.store.save(updated);
        return { ok: true, value: updated };
      }
      const command: GameCommand = {
        actionId: `connection:${identityId}:${connected ? 'online' : 'offline'}:${String(room.game.version)}`,
        expectedVersion: room.game.version,
        playerId: identityId,
        now,
        kind: connected ? 'system:player-reconnected' : 'system:player-disconnected',
      };
      const result = decide(room.game, command);
      if (!result.ok) return { ok: true, value: room };
      const updated = await this.saveTransition(room, result, now, {
        identityId,
        connected,
      });
      return { ok: true, value: updated };
    });
  }

  async processDeadline(task: DeadlineTask, now: number): Promise<RoomMutation<RoomState | null>> {
    return this.lock.run(task.roomId, async () => {
      const room = await this.store.get(task.roomId);
      if (!room) return { ok: true, value: null };
      const game = gameForDeadline(room, task);
      if (!game) return { ok: true, value: null };
      const result = decide(game, deadlineCommand(task, now));
      if (!result.ok) return { ok: true, value: null };
      const updated = await this.saveTransition(room, result, now);
      return { ok: true, value: updated };
    });
  }

  private async saveTransition(
    room: RoomState,
    result: Extract<TransitionResult, { readonly ok: true }>,
    now: number,
    memberConnection?: { readonly identityId: string; readonly connected: boolean },
    acceptedActionResult?: AcceptedActionResult,
  ): Promise<RoomState> {
    if (!room.game) throw new Error('GAME_REQUIRED_FOR_TRANSITION');
    const updated: RoomState = {
      ...room,
      version: room.version + 1,
      game: result.state,
      eventHistory: [
        ...(room.eventHistory ?? []),
        { gameVersion: result.state.version, events: result.events },
      ].slice(-10),
      ...(result.events.some((event) => event.kind === 'player:eliminated')
        ? {
            eliminationGroups: [
              ...(room.eliminationGroups ?? []),
              result.events
                .filter((event) => event.kind === 'player:eliminated')
                .map((event) => event.playerId),
            ],
          }
        : {}),
      ...(acceptedActionResult
        ? {
            acceptedActionResults: [
              ...(room.acceptedActionResults ?? []),
              acceptedActionResult,
            ].slice(-128),
          }
        : {}),
      members: memberConnection
        ? room.members.map((member) =>
            member.identityId === memberConnection.identityId
              ? { ...member, connected: memberConnection.connected }
              : member,
          )
        : room.members,
      updatedAt: now,
    };
    if (room.game.phase !== 'GAME_OVER' && result.state.phase === 'GAME_OVER') {
      const gameOver = result.events.find((event) => event.kind === 'game:over');
      if (!gameOver) throw new Error('GAME_OVER_EVENT_REQUIRED');
      if (room.ranked && this.ratings) {
        const eliminated = (room.eliminationGroups ?? []).flat();
        const winnerId = gameOver.winnerPlayerId;
        const orderedGroups = [...(room.eliminationGroups ?? [])].reverse();
        const placements = [
          { identityId: winnerId, placement: 1 },
          ...orderedGroups.flatMap((group) => {
            const playersBefore = orderedGroups
              .slice(0, orderedGroups.indexOf(group))
              .reduce((count, values) => count + values.length, 0);
            return group.map((identityId) => ({
              identityId,
              placement: playersBefore + 2,
            }));
          }),
        ];
        if (new Set([...eliminated, winnerId]).size === room.members.length) {
          for (const member of room.members) {
            await this.ratings.ensureAccount(member.identityId, member.displayName);
          }
          await this.ratings.settleRankedMatch({
            matchId: room.id,
            mode: room.mode,
            winnerIdentityId: winnerId,
            placements,
          });
        }
      }
      await this.replays.save({
        roomId: room.id,
        finishedAt: now,
        winnerPlayerId: gameOver.winnerPlayerId,
        participantIds: room.members.map((member) => member.identityId),
        summary: {
          mode: room.mode,
          playerCount: room.members.length,
          winnerDisplayName:
            room.members.find((member) => member.identityId === gameOver.winnerPlayerId)
              ?.displayName ?? 'unknown',
        },
        game: result.state,
      });
    }
    await this.store.save(updated);
    return updated;
  }

  private async updateLobby(
    roomId: string,
    identityId: string,
    now: number,
    update: (room: RoomState) => RoomState | null,
    nullCode: 'NOT_ROOM_HOST' | 'NOT_ROOM_MEMBER' = 'NOT_ROOM_MEMBER',
  ): Promise<RoomMutation> {
    return this.lock.run(roomId, async () => {
      const room = await this.store.get(roomId);
      if (!room) return { ok: false, code: 'ROOM_NOT_FOUND' };
      if (room.game) return { ok: false, code: 'ROOM_ALREADY_STARTED' };
      if (!room.members.some((member) => member.identityId === identityId)) {
        return { ok: false, code: 'NOT_ROOM_MEMBER' };
      }
      const changed = update(room);
      if (!changed) return { ok: false, code: nullCode };
      const updated = { ...changed, version: room.version + 1, updatedAt: now };
      await this.store.save(updated);
      return { ok: true, value: updated };
    });
  }

  private toDomainCommand(command: RoomCommand, playerId: string, now: number): GameCommand {
    const base = {
      actionId: command.actionId,
      expectedVersion: command.expectedVersion,
      playerId,
      now,
    };
    switch (command.kind) {
      case 'game:select-starter':
        return { ...base, kind: command.kind, characterId: command.characterId };
      case 'game:create-fusion':
        return {
          ...base,
          kind: command.kind,
          cardIds: command.cardIds,
          selectedSuit: command.selectedSuit,
          fusedCardId: randomUUID(),
        };
      case 'game:play-cards':
        return {
          ...base,
          kind: command.kind,
          cardIds: command.cardIds,
          ...(command.targetPlayerId ? { targetPlayerId: command.targetPlayerId } : {}),
        };
      case 'game:rescue-with-joker':
        return { ...base, kind: command.kind, jokerCardId: command.jokerCardId };
      case 'game:decline-rescue':
      case 'game:leave-match':
        return { ...base, kind: command.kind };
      case 'game:select-replacement':
        return { ...base, kind: command.kind, characterId: command.characterId };
      case 'game:execute-character':
        return {
          ...base,
          kind: command.kind,
          jokerCardIds: command.jokerCardIds,
          targetPlayerId: command.targetPlayerId,
        };
    }
  }

  private async createRoomId(): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const bytes = randomBytes(5);
      const id = Array.from(bytes, (byte) => ROOM_CHARS[byte % ROOM_CHARS.length]).join('');
      if (!(await this.store.get(id))) return id;
    }
    throw new Error('ROOM_ID_EXHAUSTED');
  }
}
