import type { GameMode } from '@pokewar/protocol';
import type { MatchProposal, QueueEntry } from './model.js';
import type { MatchmakingStore } from './matchmakingStore.js';

const STATE_TTL_SECONDS = 60 * 60;

export interface RedisMatchmakingClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(keys: string | string[]): Promise<number>;
  mGet(keys: string[]): Promise<(string | null)[]>;
  zAdd(key: string, members: { score: number; value: string }[]): Promise<number>;
  zRem(key: string, members: string[]): Promise<number>;
  zRange(key: string, start: number, stop: number): Promise<string[]>;
  zRangeByScore(
    key: string,
    min: number,
    max: number,
    options?: { LIMIT?: { offset: number; count: number } },
  ): Promise<string[]>;
}

export class RedisMatchmakingStore implements MatchmakingStore {
  constructor(
    private readonly client: RedisMatchmakingClient,
    private readonly prefix: string,
  ) {}

  async getEntry(identityId: string): Promise<QueueEntry | null> {
    const value = await this.client.get(this.entryKey(identityId));
    return value ? (JSON.parse(value) as QueueEntry) : null;
  }

  async enqueue(entry: QueueEntry): Promise<'queued' | 'already-active'> {
    if (
      (await this.client.get(this.entryKey(entry.identity.id))) ||
      (await this.client.get(this.identityProposalKey(entry.identity.id)))
    ) {
      return 'already-active';
    }
    await this.client.set(this.entryKey(entry.identity.id), JSON.stringify(entry), {
      EX: STATE_TTL_SECONDS,
    });
    await this.client.zAdd(this.queueKey(entry.mode), [
      { score: entry.enqueuedAt, value: entry.identity.id },
    ]);
    return 'queued';
  }

  async removeEntry(identityId: string): Promise<void> {
    const entry = await this.getEntry(identityId);
    if (entry) await this.client.zRem(this.queueKey(entry.mode), [identityId]);
    await this.client.del(this.entryKey(identityId));
  }

  async queuedEntries(limit: number): Promise<readonly QueueEntry[]> {
    const entries = [
      ...(await this.entriesForMode('normal')),
      ...(await this.entriesForMode('quick')),
    ];
    return entries
      .sort(
        (left, right) =>
          left.enqueuedAt - right.enqueuedAt || left.identity.id.localeCompare(right.identity.id),
      )
      .slice(0, limit);
  }

  async createProposal(proposal: MatchProposal): Promise<boolean> {
    for (const player of proposal.players) {
      if (
        (await this.client.get(this.identityProposalKey(player.identity.id))) ||
        !(await this.client.get(this.entryKey(player.identity.id)))
      ) {
        return false;
      }
    }
    for (const player of proposal.players) await this.removeEntry(player.identity.id);
    await this.saveProposal(proposal);
    return true;
  }

  async updateProposal(proposal: MatchProposal): Promise<void> {
    const previousValue = await this.client.get(this.proposalKey(proposal.id));
    if (previousValue) {
      const previous = JSON.parse(previousValue) as MatchProposal;
      await this.client.del(
        previous.players.map((player) => this.identityProposalKey(player.identity.id)),
      );
    }
    await this.saveProposal(proposal);
  }

  async proposals(limit: number): Promise<readonly MatchProposal[]> {
    const ids = await this.client.zRange(this.proposalIndexKey(), 0, limit - 1);
    return this.readProposals(ids);
  }

  async getProposalFor(identityId: string): Promise<MatchProposal | null> {
    const proposalId = await this.client.get(this.identityProposalKey(identityId));
    if (!proposalId) return null;
    const value = await this.client.get(this.proposalKey(proposalId));
    return value ? (JSON.parse(value) as MatchProposal) : null;
  }

  async acceptProposal(proposalId: string, identityId: string): Promise<MatchProposal | null> {
    const value = await this.client.get(this.proposalKey(proposalId));
    if (!value) return null;
    const proposal = JSON.parse(value) as MatchProposal;
    if (!proposal.players.some((player) => player.identity.id === identityId)) return null;
    if (proposal.acceptedIds.includes(identityId)) return proposal;
    const updated = { ...proposal, acceptedIds: [...proposal.acceptedIds, identityId] };
    await this.client.set(this.proposalKey(proposalId), JSON.stringify(updated), {
      EX: STATE_TTL_SECONDS,
    });
    return updated;
  }

  async deleteProposal(proposalId: string): Promise<void> {
    const value = await this.client.get(this.proposalKey(proposalId));
    if (value) {
      const proposal = JSON.parse(value) as MatchProposal;
      await this.client.del(
        proposal.players.map((player) => this.identityProposalKey(player.identity.id)),
      );
    }
    await Promise.all([
      this.client.del(this.proposalKey(proposalId)),
      this.client.zRem(this.dueKey(), [proposalId]),
      this.client.zRem(this.proposalIndexKey(), [proposalId]),
    ]);
  }

  async dueProposals(now: number, limit: number): Promise<readonly MatchProposal[]> {
    const ids = await this.client.zRangeByScore(this.dueKey(), 0, now, {
      LIMIT: { offset: 0, count: limit },
    });
    return this.readProposals(ids);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  private async saveProposal(proposal: MatchProposal): Promise<void> {
    await this.client.set(this.proposalKey(proposal.id), JSON.stringify(proposal), {
      EX: STATE_TTL_SECONDS,
    });
    for (const player of proposal.players) {
      await this.client.set(this.identityProposalKey(player.identity.id), proposal.id, {
        EX: STATE_TTL_SECONDS,
      });
    }
    const earliest = Math.min(...proposal.players.map((player) => player.enqueuedAt));
    await this.client.zAdd(this.proposalIndexKey(), [{ score: earliest, value: proposal.id }]);
    await this.client.zRem(this.dueKey(), [proposal.id]);
    if (proposal.expiresAt !== null) {
      await this.client.zAdd(this.dueKey(), [{ score: proposal.expiresAt, value: proposal.id }]);
    }
  }

  private async readProposals(ids: readonly string[]): Promise<MatchProposal[]> {
    if (ids.length === 0) return [];
    const values = await this.client.mGet(ids.map((id) => this.proposalKey(id)));
    return values.flatMap((value) => (value ? [JSON.parse(value) as MatchProposal] : []));
  }

  private async entriesForMode(mode: GameMode): Promise<QueueEntry[]> {
    const ids = await this.client.zRange(this.queueKey(mode), 0, -1);
    if (ids.length === 0) return [];
    const values = await this.client.mGet(ids.map((id) => this.entryKey(id)));
    return values.flatMap((value) => (value ? [JSON.parse(value) as QueueEntry] : []));
  }

  private entryKey(identityId: string): string {
    return `${this.prefix}match:entry:${identityId}`;
  }
  private queueKey(mode: GameMode): string {
    return `${this.prefix}match:queue:${mode}`;
  }
  private proposalKey(proposalId: string): string {
    return `${this.prefix}match:proposal:${proposalId}`;
  }
  private identityProposalKey(identityId: string): string {
    return `${this.prefix}match:identity:${identityId}`;
  }
  private dueKey(): string {
    return `${this.prefix}match:proposal-due`;
  }
  private proposalIndexKey(): string {
    return `${this.prefix}match:proposal-index`;
  }
}
