import type { GameMode, MatchSize, MatchmakingState } from '@pokewar/protocol';
import { randomBytes, randomUUID } from 'node:crypto';
import type { GuestIdentity } from '../identity/guest.js';
import type { RatingRepository } from '../rating/ratingRepository.js';
import type { RoomLockAdapter } from '../rooms/lock.js';
import type { RoomMembershipStore } from '../rooms/membershipStore.js';
import type { RoomState } from '../rooms/model.js';
import type { RoomService } from '../rooms/roomService.js';
import {
  eligibleForSize,
  eligibleSizes,
  groupRatingCompatible,
  rankedProposal,
  type MatchProposal,
  type QueueEntry,
} from './model.js';
import type { MatchmakingStore } from './matchmakingStore.js';

const CONFIRMATION_MS = 15_000;
const SCAN_LIMIT = 512;

export type MatchmakingResult =
  | {
      readonly ok: true;
      readonly updates: ReadonlyMap<string, MatchmakingState>;
      readonly rooms?: readonly RoomState[];
    }
  | {
      readonly ok: false;
      readonly code:
        | 'MATCHMAKING_ALREADY_ACTIVE'
        | 'MATCHMAKING_NOT_ACTIVE'
        | 'MATCHMAKING_PROPOSAL_MISMATCH'
        | 'MATCHMAKING_CONFIRMATION_EXPIRED'
        | 'MATCHMAKING_ROOM_CONFLICT';
    };

function stateForProposal(proposal: MatchProposal, identityId: string): MatchmakingState {
  if (proposal.expiresAt === null) {
    return {
      status: 'queued',
      mode: proposal.mode,
      targetSize: proposal.finalSize,
      allowFallback: false,
      enqueuedAt: Math.min(...proposal.players.map((player) => player.enqueuedAt)),
      groupedPlayers: proposal.players.length,
    };
  }
  return {
    status: 'confirming',
    proposalId: proposal.id,
    mode: proposal.mode,
    finalSize: proposal.finalSize,
    ranked: rankedProposal(proposal),
    expiresAt: proposal.expiresAt,
    accepted: proposal.acceptedIds.includes(identityId),
  };
}

export class MatchmakingService {
  constructor(
    private readonly store: MatchmakingStore,
    private readonly lock: RoomLockAdapter,
    private readonly rooms: RoomService,
    private readonly memberships: RoomMembershipStore,
    private readonly ratings: RatingRepository,
  ) {}

  async runIfIdle<T>(
    identityId: string,
    task: () => Promise<T>,
  ): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }> {
    return this.lock.run('matchmaking', async () => {
      if (
        (await this.store.getEntry(identityId)) ||
        (await this.store.getProposalFor(identityId))
      ) {
        return { ok: false };
      }
      return { ok: true, value: await task() };
    });
  }

  async state(identityId: string): Promise<MatchmakingState> {
    const proposal = await this.store.getProposalFor(identityId);
    if (proposal) return stateForProposal(proposal, identityId);
    const entry = await this.store.getEntry(identityId);
    return entry ? this.queuedState(entry, 1) : { status: 'idle' };
  }

  async enqueue(
    identity: GuestIdentity,
    mode: GameMode,
    targetSize: MatchSize,
    allowFallback: boolean,
    now: number,
  ): Promise<MatchmakingResult> {
    return this.lock.run('matchmaking', async () => {
      if (await this.memberships.get(identity.id)) {
        return { ok: false, code: 'MATCHMAKING_ROOM_CONFLICT' };
      }
      if (
        (await this.store.getEntry(identity.id)) ||
        (await this.store.getProposalFor(identity.id))
      ) {
        return { ok: false, code: 'MATCHMAKING_ALREADY_ACTIVE' };
      }
      const entry: QueueEntry = {
        identity,
        mode,
        requestedSize: targetSize,
        allowFallback,
        rating: await this.matchingRating(identity, mode),
        enqueuedAt: now,
      };
      await this.store.enqueue(entry);
      const updates = await this.formGroups(now);
      if (!updates.has(identity.id)) updates.set(identity.id, this.queuedState(entry, 1));
      return { ok: true, updates };
    });
  }

  async cancel(identityId: string, now: number): Promise<MatchmakingResult> {
    return this.lock.run('matchmaking', async () => {
      const entry = await this.store.getEntry(identityId);
      if (entry) {
        await this.store.removeEntry(identityId);
        return { ok: true, updates: new Map([[identityId, { status: 'idle' }]]) };
      }
      const proposal = await this.store.getProposalFor(identityId);
      if (!proposal) return { ok: false, code: 'MATCHMAKING_NOT_ACTIVE' };
      const remaining = proposal.players.filter((player) => player.identity.id !== identityId);
      await this.store.deleteProposal(proposal.id);
      const updates = new Map<string, MatchmakingState>([[identityId, { status: 'idle' }]]);
      if (remaining.length > 0) {
        const retained: MatchProposal = {
          ...proposal,
          players: remaining,
          acceptedIds: [],
          expiresAt: null,
        };
        await this.store.updateProposal(retained);
        for (const player of remaining) {
          updates.set(player.identity.id, stateForProposal(retained, player.identity.id));
        }
      }
      const formed = await this.formGroups(now);
      for (const [id, state] of formed) updates.set(id, state);
      return { ok: true, updates };
    });
  }

  async accept(identityId: string, proposalId: string, now: number): Promise<MatchmakingResult> {
    return this.lock.run('matchmaking', async () => {
      const proposal = await this.store.getProposalFor(identityId);
      if (proposal?.id !== proposalId || proposal.expiresAt === null) {
        return { ok: false, code: 'MATCHMAKING_PROPOSAL_MISMATCH' };
      }
      if (proposal.expiresAt <= now) {
        await this.resolveExpiredProposal(proposal, now);
        return { ok: false, code: 'MATCHMAKING_CONFIRMATION_EXPIRED' };
      }
      const updated = await this.store.acceptProposal(proposalId, identityId);
      if (!updated) return { ok: false, code: 'MATCHMAKING_PROPOSAL_MISMATCH' };
      if (updated.acceptedIds.length < updated.finalSize) {
        return { ok: true, updates: this.proposalUpdates(updated) };
      }
      const room = await this.finalizeProposal(updated, now);
      return {
        ok: true,
        rooms: [room],
        updates: new Map(updated.players.map((player) => [player.identity.id, { status: 'idle' }])),
      };
    });
  }

  async recover(now: number): Promise<MatchmakingResult> {
    return this.lock.run('matchmaking', async () => {
      const updates = new Map<string, MatchmakingState>();
      const rooms: RoomState[] = [];
      for (const proposal of await this.store.dueProposals(now, SCAN_LIMIT)) {
        if (proposal.acceptedIds.length === proposal.finalSize) {
          rooms.push(await this.finalizeProposal(proposal, now));
          for (const player of proposal.players)
            updates.set(player.identity.id, { status: 'idle' });
        } else {
          const resolved = await this.resolveExpiredProposal(proposal, now);
          for (const [id, state] of resolved) updates.set(id, state);
        }
      }
      const formed = await this.formGroups(now);
      for (const [id, state] of formed) updates.set(id, state);
      return { ok: true, updates, ...(rooms.length > 0 ? { rooms } : {}) };
    });
  }

  private async resolveExpiredProposal(
    proposal: MatchProposal,
    now: number,
  ): Promise<ReadonlyMap<string, MatchmakingState>> {
    const retainedPlayers = proposal.players.filter((player) =>
      proposal.acceptedIds.includes(player.identity.id),
    );
    await this.store.deleteProposal(proposal.id);
    const updates = new Map<string, MatchmakingState>();
    for (const player of proposal.players) {
      if (!proposal.acceptedIds.includes(player.identity.id)) {
        updates.set(player.identity.id, { status: 'idle' });
      }
    }
    if (retainedPlayers.length > 0) {
      const retained: MatchProposal = {
        ...proposal,
        players: retainedPlayers,
        acceptedIds: [],
        expiresAt: null,
      };
      await this.store.updateProposal(retained);
      for (const player of retainedPlayers) {
        updates.set(player.identity.id, stateForProposal(retained, player.identity.id));
      }
    }
    const formed = await this.formGroups(now);
    for (const [id, state] of formed) updates.set(id, state);
    return updates;
  }

  private async formGroups(now: number): Promise<Map<string, MatchmakingState>> {
    const updates = new Map<string, MatchmakingState>();
    await this.fillRetainedGroups(now, updates);
    let entries = [...(await this.store.queuedEntries(SCAN_LIMIT))];
    for (const seed of entries) {
      if (!(await this.store.getEntry(seed.identity.id))) continue;
      for (const size of eligibleSizes(seed, now)) {
        const group = this.buildGroup(seed, entries, size, now);
        if (group.length !== size) continue;
        const proposal: MatchProposal = {
          id: randomUUID(),
          roomId: await this.rooms.allocateRoomId(),
          mode: seed.mode,
          finalSize: size,
          players: group,
          acceptedIds: [],
          expiresAt: now + CONFIRMATION_MS,
        };
        if (await this.store.createProposal(proposal)) {
          for (const [id, state] of this.proposalUpdates(proposal)) updates.set(id, state);
          const ids = new Set(group.map((player) => player.identity.id));
          entries = entries.filter((entry) => !ids.has(entry.identity.id));
        }
        break;
      }
    }
    return updates;
  }

  private async fillRetainedGroups(
    now: number,
    updates: Map<string, MatchmakingState>,
  ): Promise<void> {
    for (const proposal of await this.store.proposals(SCAN_LIMIT)) {
      if (proposal.expiresAt !== null || proposal.players.length >= proposal.finalSize) continue;
      const queue = await this.store.queuedEntries(SCAN_LIMIT);
      const players = [...proposal.players];
      for (const candidate of queue) {
        if (players.length >= proposal.finalSize) break;
        if (
          candidate.mode !== proposal.mode ||
          !eligibleForSize(candidate, proposal.finalSize, now) ||
          !groupRatingCompatible([...players, candidate], now)
        ) {
          continue;
        }
        players.push(candidate);
        await this.store.removeEntry(candidate.identity.id);
      }
      const updated: MatchProposal = {
        ...proposal,
        players,
        acceptedIds: [],
        expiresAt: players.length === proposal.finalSize ? now + CONFIRMATION_MS : null,
      };
      await this.store.updateProposal(updated);
      for (const [id, state] of this.proposalUpdates(updated)) updates.set(id, state);
    }
  }

  private buildGroup(
    seed: QueueEntry,
    entries: readonly QueueEntry[],
    size: MatchSize,
    now: number,
  ): QueueEntry[] {
    const group: QueueEntry[] = [seed];
    for (const candidate of entries) {
      if (group.length >= size) break;
      if (
        candidate.identity.id === seed.identity.id ||
        candidate.mode !== seed.mode ||
        !eligibleForSize(candidate, size, now) ||
        !groupRatingCompatible([...group, candidate], now)
      ) {
        continue;
      }
      group.push(candidate);
    }
    return group;
  }

  private async finalizeProposal(proposal: MatchProposal, now: number): Promise<RoomState> {
    const identities = proposal.players.map((player) => player.identity);
    if (identities.length !== proposal.finalSize) throw new Error('MATCHMAKING_GROUP_NOT_FULL');
    const room = await this.rooms.createMatchmade(
      proposal.roomId,
      identities,
      proposal.mode,
      randomBytes(32).toString('hex'),
      now,
      'matchmade',
      rankedProposal(proposal),
    );
    for (const player of proposal.players) {
      await this.memberships.set(player.identity.id, room.id);
    }
    await this.store.deleteProposal(proposal.id);
    return room;
  }

  private async matchingRating(identity: GuestIdentity, mode: GameMode): Promise<number> {
    if (identity.kind !== 'account') return 1500;
    await this.ratings.ensureAccount(identity.id, identity.displayName);
    const values = await this.ratings.getForIdentity(identity.id);
    return values.find((rating) => rating.mode === mode)?.rating ?? 1500;
  }

  private proposalUpdates(proposal: MatchProposal): ReadonlyMap<string, MatchmakingState> {
    return new Map(
      proposal.players.map((player) => [
        player.identity.id,
        stateForProposal(proposal, player.identity.id),
      ]),
    );
  }

  private queuedState(entry: QueueEntry, groupedPlayers: number): MatchmakingState {
    return {
      status: 'queued',
      mode: entry.mode,
      targetSize: entry.requestedSize,
      allowFallback: entry.allowFallback,
      enqueuedAt: entry.enqueuedAt,
      groupedPlayers,
    };
  }
}
