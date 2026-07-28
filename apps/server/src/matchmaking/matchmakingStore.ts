import type { QueueEntry, MatchProposal } from './model.js';

export interface MatchmakingStore {
  getEntry(identityId: string): Promise<QueueEntry | null>;
  enqueue(entry: QueueEntry): Promise<'queued' | 'already-active'>;
  removeEntry(identityId: string): Promise<void>;
  queuedEntries(limit: number): Promise<readonly QueueEntry[]>;
  createProposal(proposal: MatchProposal): Promise<boolean>;
  updateProposal(proposal: MatchProposal): Promise<void>;
  proposals(limit: number): Promise<readonly MatchProposal[]>;
  getProposalFor(identityId: string): Promise<MatchProposal | null>;
  acceptProposal(proposalId: string, identityId: string): Promise<MatchProposal | null>;
  deleteProposal(proposalId: string): Promise<void>;
  dueProposals(now: number, limit: number): Promise<readonly MatchProposal[]>;
  close(): Promise<void>;
}

export class MemoryMatchmakingStore implements MatchmakingStore {
  readonly #entries = new Map<string, QueueEntry>();
  readonly #proposals = new Map<string, MatchProposal>();
  readonly #identityProposals = new Map<string, string>();

  getEntry(identityId: string): Promise<QueueEntry | null> {
    return Promise.resolve(this.#entries.get(identityId) ?? null);
  }

  enqueue(entry: QueueEntry): Promise<'queued' | 'already-active'> {
    if (this.#entries.has(entry.identity.id) || this.#identityProposals.has(entry.identity.id)) {
      return Promise.resolve('already-active');
    }
    this.#entries.set(entry.identity.id, entry);
    return Promise.resolve('queued');
  }

  removeEntry(identityId: string): Promise<void> {
    this.#entries.delete(identityId);
    return Promise.resolve();
  }

  queuedEntries(limit: number): Promise<readonly QueueEntry[]> {
    return Promise.resolve(
      [...this.#entries.values()]
        .sort(
          (left, right) =>
            left.enqueuedAt - right.enqueuedAt || left.identity.id.localeCompare(right.identity.id),
        )
        .slice(0, limit),
    );
  }

  createProposal(proposal: MatchProposal): Promise<boolean> {
    if (
      proposal.players.some(
        (player) =>
          this.#identityProposals.has(player.identity.id) || !this.#entries.has(player.identity.id),
      )
    ) {
      return Promise.resolve(false);
    }
    for (const player of proposal.players) this.#entries.delete(player.identity.id);
    this.saveProposal(proposal);
    return Promise.resolve(true);
  }

  updateProposal(proposal: MatchProposal): Promise<void> {
    const previous = this.#proposals.get(proposal.id);
    if (previous) {
      for (const player of previous.players) this.#identityProposals.delete(player.identity.id);
    }
    this.saveProposal(proposal);
    return Promise.resolve();
  }

  proposals(limit: number): Promise<readonly MatchProposal[]> {
    return Promise.resolve(
      [...this.#proposals.values()]
        .sort((left, right) => {
          const leftTime = Math.min(...left.players.map((player) => player.enqueuedAt));
          const rightTime = Math.min(...right.players.map((player) => player.enqueuedAt));
          return leftTime - rightTime || left.id.localeCompare(right.id);
        })
        .slice(0, limit),
    );
  }

  getProposalFor(identityId: string): Promise<MatchProposal | null> {
    const id = this.#identityProposals.get(identityId);
    return Promise.resolve(id ? (this.#proposals.get(id) ?? null) : null);
  }

  acceptProposal(proposalId: string, identityId: string): Promise<MatchProposal | null> {
    const proposal = this.#proposals.get(proposalId);
    if (!proposal?.players.some((player) => player.identity.id === identityId)) {
      return Promise.resolve(null);
    }
    if (proposal.acceptedIds.includes(identityId)) return Promise.resolve(proposal);
    const updated = { ...proposal, acceptedIds: [...proposal.acceptedIds, identityId] };
    this.#proposals.set(proposalId, updated);
    return Promise.resolve(updated);
  }

  deleteProposal(proposalId: string): Promise<void> {
    const proposal = this.#proposals.get(proposalId);
    if (proposal) {
      for (const player of proposal.players) this.#identityProposals.delete(player.identity.id);
    }
    this.#proposals.delete(proposalId);
    return Promise.resolve();
  }

  dueProposals(now: number, limit: number): Promise<readonly MatchProposal[]> {
    return Promise.resolve(
      [...this.#proposals.values()]
        .filter((proposal) => proposal.expiresAt !== null && proposal.expiresAt <= now)
        .sort((left, right) => (left.expiresAt ?? 0) - (right.expiresAt ?? 0))
        .slice(0, limit),
    );
  }

  close(): Promise<void> {
    this.#entries.clear();
    this.#proposals.clear();
    this.#identityProposals.clear();
    return Promise.resolve();
  }

  private saveProposal(proposal: MatchProposal): void {
    this.#proposals.set(proposal.id, proposal);
    for (const player of proposal.players) {
      this.#identityProposals.set(player.identity.id, proposal.id);
    }
  }
}
