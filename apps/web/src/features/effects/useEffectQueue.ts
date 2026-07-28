import type { BattleNotice, GameProjection } from '@pokewar/protocol';
import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../../services/audio.js';
import { registeredEffectKeys, resolveEffect } from './registry.js';
import { nullCanvasAdapter, type EffectCanvasAdapter, type EffectCue } from './types.js';

const MAX_QUEUE = 8;

function compressQueue(queue: readonly EffectCue[]): readonly EffectCue[] {
  if (queue.length <= MAX_QUEUE) return queue;
  const critical = queue.filter((cue) => cue.priority === 'critical');
  const normal = queue.filter((cue) => cue.priority === 'normal');
  const low = queue.filter((cue) => cue.priority === 'low');
  return [...critical, ...normal, ...low.slice(-1)].slice(-MAX_QUEUE);
}

export function useEffectQueue(
  game: GameProjection,
  adapter: EffectCanvasAdapter = nullCanvasAdapter,
): { readonly cue: EffectCue | null; readonly queueLength: number } {
  const seen = useRef(new Set<string>());
  const initialized = useRef(false);
  const queue = useRef<readonly EffectCue[]>([]);
  const timer = useRef<number | null>(null);
  const [cue, setCue] = useState<EffectCue | null>(null);
  const [queueLength, setQueueLength] = useState(0);

  useEffect(() => {
    if (!initialized.current) {
      for (const notice of game.notices) seen.current.add(notice.id);
      initialized.current = true;
      return;
    }
    const additions: EffectCue[] = [];
    let previous: BattleNotice | null = null;
    for (const notice of game.notices) {
      if (seen.current.has(notice.id)) {
        previous = notice;
        continue;
      }
      seen.current.add(notice.id);
      additions.push(resolveEffect({ game, notice, previousNotice: previous }));
      previous = notice;
    }
    if (additions.length > 0) {
      queue.current = compressQueue([...queue.current, ...additions]);
      setQueueLength(queue.current.length);
    }
  }, [game]);

  useEffect(() => {
    if (cue || queue.current.length === 0) return;
    const [next, ...remaining] = queue.current;
    if (!next) return;
    queue.current = remaining;
    setQueueLength(remaining.length);
    setCue(next);
    if (next.sound) audioEngine.play(next.sound);
    adapter.play(next);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = window.setTimeout(() => setCue(null), reduced ? 80 : next.durationMs);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [adapter, cue, queueLength]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__POKEWAR_EFFECTS__ = {
      currentCue: cue,
      queueLength,
      registeredHandlers: registeredEffectKeys(),
    };
  }, [cue, queueLength]);

  return { cue, queueLength };
}

declare global {
  interface Window {
    __POKEWAR_EFFECTS__?: {
      readonly currentCue: EffectCue | null;
      readonly queueLength: number;
      readonly registeredHandlers: readonly string[];
    };
  }
}
