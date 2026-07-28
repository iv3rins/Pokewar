import type { GameMode, MatchSize } from '@pokewar/protocol';
import type { GuestIdentity } from '../identity/guest.js';

export interface QueueEntry {
  readonly identity: GuestIdentity;
  readonly mode: GameMode;
  readonly requestedSize: MatchSize;
  readonly allowFallback: boolean;
  readonly rating: number;
  readonly enqueuedAt: number;
}

export interface MatchProposal {
  readonly id: string;
  readonly mode: GameMode;
  readonly roomId: string;
  readonly finalSize: MatchSize;
  readonly players: readonly QueueEntry[];
  readonly acceptedIds: readonly string[];
  readonly expiresAt: number | null;
}

export function matchmakingRange(entry: QueueEntry, now: number): number {
  const elapsedSteps = Math.max(0, Math.floor((now - entry.enqueuedAt) / 10_000));
  return Math.min(500, 100 + elapsedSteps * 50);
}

export function eligibleSizes(entry: QueueEntry, now: number): readonly MatchSize[] {
  if (!entry.allowFallback || entry.requestedSize === 4) return [entry.requestedSize];
  const elapsed = Math.max(0, now - entry.enqueuedAt);
  if (entry.requestedSize === 8) return elapsed >= 60_000 ? [8, 4] : [8];
  if (elapsed >= 120_000) return [12, 8, 4];
  if (elapsed >= 60_000) return [12, 8];
  return [12];
}

export function eligibleForSize(entry: QueueEntry, size: MatchSize, now: number): boolean {
  return eligibleSizes(entry, now).includes(size);
}

export function groupRatingCompatible(entries: readonly QueueEntry[], now: number): boolean {
  if (entries.length === 0) return false;
  const average = entries.reduce((sum, entry) => sum + entry.rating, 0) / entries.length;
  return entries.every((entry) => Math.abs(entry.rating - average) <= matchmakingRange(entry, now));
}

export function rankedProposal(proposal: MatchProposal): boolean {
  return proposal.players.every((player) => player.identity.kind === 'account');
}
