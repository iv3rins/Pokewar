import type { ReplayRepository } from './replayRepository.js';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

export function startReplayCleanup(
  repository: ReplayRepository,
  intervalMs = CLEANUP_INTERVAL_MS,
): () => void {
  const run = () => {
    void repository.purgeExpired(Date.now()).catch((error: unknown) => {
      console.error('[replay-cleanup]', error);
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
