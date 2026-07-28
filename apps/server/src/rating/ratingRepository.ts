import type { GameMode } from '@pokewar/protocol';
import { ratingTier, updateGlicko2, type GlickoRating, type RatingTier } from './glicko2.js';

export interface StoredRating extends GlickoRating {
  readonly identityId: string;
  readonly mode: GameMode;
  readonly rankedGames: number;
  readonly wins: number;
  readonly losses: number;
}
export interface RankedEntry {
  readonly identityId: string;
  readonly displayName: string;
  readonly rating: number;
  readonly rankedGames: number;
  readonly wins: number;
  readonly losses: number;
  readonly rank: number;
  readonly tier: RatingTier;
}
export interface RankedPlacement {
  readonly identityId: string;
  readonly placement: number;
}

export interface RankedSettlement {
  readonly matchId: string;
  readonly mode: GameMode;
  readonly winnerIdentityId: string;
  readonly placements: readonly RankedPlacement[];
}

export interface RatingRepository {
  ensureAccount(identityId: string, displayName: string): Promise<void>;
  getForIdentity(identityId: string): Promise<readonly StoredRating[]>;
  leaderboard(
    mode: GameMode,
    identityId: string | null,
  ): Promise<{ entries: readonly RankedEntry[]; self: RankedEntry | null }>;
  settleRankedMatch(settlement: RankedSettlement): Promise<boolean>;
  close(): Promise<void>;
}

export class MemoryRatingRepository implements RatingRepository {
  readonly #ratings = new Map<string, StoredRating>();
  readonly #names = new Map<string, string>();
  readonly #settledMatches = new Set<string>();
  seed(displayName: string, rating: StoredRating): void {
    this.#names.set(rating.identityId, displayName);
    this.#ratings.set(`${rating.identityId}:${rating.mode}`, rating);
  }
  ensureAccount(identityId: string, displayName: string): Promise<void> {
    this.#names.set(identityId, displayName);
    for (const mode of ['normal', 'quick'] as const) {
      const key = `${identityId}:${mode}`;
      if (!this.#ratings.has(key)) {
        this.#ratings.set(key, {
          identityId,
          mode,
          rating: 1500,
          deviation: 350,
          volatility: 0.06,
          rankedGames: 0,
          wins: 0,
          losses: 0,
        });
      }
    }
    return Promise.resolve();
  }
  getForIdentity(identityId: string): Promise<readonly StoredRating[]> {
    return Promise.resolve(
      [...this.#ratings.values()].filter((value) => value.identityId === identityId),
    );
  }
  leaderboard(
    mode: GameMode,
    identityId: string | null,
  ): Promise<{ entries: readonly RankedEntry[]; self: RankedEntry | null }> {
    const ranked = [...this.#ratings.values()]
      .filter((value) => value.mode === mode && value.rankedGames >= 5)
      .sort(
        (a, b) =>
          b.rating - a.rating ||
          b.rankedGames - a.rankedGames ||
          a.identityId.localeCompare(b.identityId),
      )
      .map((value, index): RankedEntry => ({
        ...value,
        displayName: this.#names.get(value.identityId) ?? 'unknown',
        rank: index + 1,
        tier: ratingTier(value.rating),
      }));
    return Promise.resolve({
      entries: ranked.slice(0, 10),
      self: identityId ? (ranked.find((entry) => entry.identityId === identityId) ?? null) : null,
    });
  }
  settleRankedMatch(settlement: RankedSettlement): Promise<boolean> {
    if (this.#settledMatches.has(settlement.matchId)) return Promise.resolve(false);
    const before = new Map<string, StoredRating>();
    for (const placement of settlement.placements) {
      const rating = this.#ratings.get(`${placement.identityId}:${settlement.mode}`);
      if (!rating) throw new Error('RANKED_ACCOUNT_RATING_REQUIRED');
      before.set(placement.identityId, rating);
    }
    for (const placement of settlement.placements) {
      const current = before.get(placement.identityId);
      if (!current) throw new Error('RANKED_ACCOUNT_RATING_REQUIRED');
      const updated = updateGlicko2(
        current,
        settlement.placements
          .filter((opponent) => opponent.identityId !== placement.identityId)
          .map((opponent) => {
            const opponentRating = before.get(opponent.identityId);
            if (!opponentRating) throw new Error('RANKED_OPPONENT_RATING_REQUIRED');
            return {
              opponent: opponentRating,
              score:
                placement.placement < opponent.placement
                  ? (1 as const)
                  : placement.placement > opponent.placement
                    ? (0 as const)
                    : (0.5 as const),
            };
          }),
      );
      this.#ratings.set(`${placement.identityId}:${settlement.mode}`, {
        ...current,
        ...updated,
        rankedGames: current.rankedGames + 1,
        wins: current.wins + (placement.identityId === settlement.winnerIdentityId ? 1 : 0),
        losses: current.losses + (placement.identityId === settlement.winnerIdentityId ? 0 : 1),
      });
    }
    this.#settledMatches.add(settlement.matchId);
    return Promise.resolve(true);
  }
  close(): Promise<void> {
    this.#ratings.clear();
    this.#names.clear();
    this.#settledMatches.clear();
    return Promise.resolve();
  }
}
