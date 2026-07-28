import type { GameState } from '@pokewar/domain';

export const REPLAY_RETENTION_DAYS = 14;
export const REPLAY_RETENTION_MS = REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

export interface CompletedReplay {
  readonly roomId: string;
  readonly finishedAt: number;
  readonly winnerPlayerId: string;
  readonly participantIds: readonly string[];
  readonly summary: Readonly<Record<string, unknown>>;
  readonly game: GameState;
}

export interface StoredReplay {
  readonly roomId: string;
  readonly finishedAt: number;
  readonly expiresAt: number;
  readonly game: GameState;
}

export interface ReplayRepository {
  save(replay: CompletedReplay): Promise<void>;
  getForParticipant(
    roomId: string,
    participantId: string,
    now: number,
  ): Promise<StoredReplay | null>;
  purgeExpired(now: number): Promise<number>;
  close(): Promise<void>;
}

export class NullReplayRepository implements ReplayRepository {
  save(replay: CompletedReplay): Promise<void> {
    void replay;
    return Promise.resolve();
  }

  getForParticipant(roomId: string, participantId: string, now: number): Promise<null> {
    void roomId;
    void participantId;
    void now;
    return Promise.resolve(null);
  }

  purgeExpired(now: number): Promise<number> {
    void now;
    return Promise.resolve(0);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
