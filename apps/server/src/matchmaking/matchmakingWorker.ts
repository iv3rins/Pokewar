import type { MatchmakingState } from '@pokewar/protocol';
import type { RoomState } from '../rooms/model.js';
import type { MatchmakingService } from './matchmakingService.js';

export interface MatchmakingWorkerCallbacks {
  readonly onUpdates: (updates: ReadonlyMap<string, MatchmakingState>) => void;
  readonly onRoom?: (room: RoomState) => void;
}

export function startMatchmakingWorker(
  matchmaking: MatchmakingService,
  callbacks: MatchmakingWorkerCallbacks,
  intervalMs = 1_000,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await matchmaking.recover(Date.now());
      if (result.ok) {
        callbacks.onUpdates(result.updates);
        for (const room of result.rooms ?? []) callbacks.onRoom?.(room);
      }
    } catch (error) {
      console.error('[matchmaking-worker]', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
