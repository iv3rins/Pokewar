import type { RoomState } from '../rooms/model.js';
import type { RoomService } from '../rooms/roomService.js';
import type { DeadlineStore } from './deadlineStore.js';

const POLL_INTERVAL_MS = 250;
const CLAIM_LIMIT = 64;

export interface DeadlineWorkerOptions {
  readonly pollIntervalMs?: number;
  readonly claimLimit?: number;
  readonly now?: () => number;
  readonly onRoomUpdated?: (room: RoomState) => void;
}

export interface DeadlineWorker {
  runOnce(): Promise<number>;
  stop(): void;
}

export function startDeadlineWorker(
  deadlines: DeadlineStore,
  rooms: RoomService,
  options: DeadlineWorkerOptions = {},
): DeadlineWorker {
  const now = options.now ?? Date.now;
  const limit = options.claimLimit ?? CLAIM_LIMIT;
  let running = false;
  let stopped = false;

  const runOnce = async (): Promise<number> => {
    if (running || stopped) return 0;
    running = true;
    let processed = 0;
    try {
      const currentTime = now();
      const tasks = await deadlines.claimDue(currentTime, limit);
      for (const task of tasks) {
        try {
          const result = await rooms.processDeadline(task, currentTime);
          if (result.ok && result.value) options.onRoomUpdated?.(result.value);
        } catch (error) {
          console.error('[deadline-worker:task]', task.id, error);
          continue;
        }
        await deadlines.remove(task);
        processed += 1;
      }
      return processed;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void runOnce().catch((error: unknown) => console.error('[deadline-worker:scan]', error));
  }, options.pollIntervalMs ?? POLL_INTERVAL_MS);
  timer.unref();
  void runOnce().catch((error: unknown) => console.error('[deadline-worker:startup]', error));

  return {
    runOnce,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
