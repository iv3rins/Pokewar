import type { BattleNotice, GameProjection } from '@pokewar/protocol';
import type { SoundName } from '../../services/audio.js';

export type EffectKind =
  | 'spade'
  | 'heart'
  | 'diamond'
  | 'club'
  | 'fusion'
  | 'joker-rescue'
  | 'execution'
  | 'elimination'
  | 'timeout'
  | 'turn'
  | 'game-over'
  | 'text';

export interface EffectCue {
  readonly id: string;
  readonly noticeId: string;
  readonly kind: EffectKind;
  readonly actorPlayerId: string | null;
  readonly targetPlayerId: string | null;
  readonly value: number | null;
  readonly text: string;
  readonly sound: SoundName | null;
  readonly durationMs: number;
  readonly priority: 'critical' | 'normal' | 'low';
  readonly shake: boolean;
  readonly cards: BattleNotice['cards'];
  readonly hpLost: number;
  readonly shieldLost: number;
  readonly healing: number;
  readonly shieldGained: number;
}

export interface EffectContext {
  readonly game: GameProjection;
  readonly notice: BattleNotice;
  readonly previousNotice: BattleNotice | null;
}

export type EffectHandler = (context: EffectContext) => EffectCue;

export interface EffectCanvasAdapter {
  mount(canvas: HTMLCanvasElement): void;
  play(cue: EffectCue): void;
  clear(): void;
  unmount(): void;
}

export const nullCanvasAdapter: EffectCanvasAdapter = {
  mount: () => undefined,
  play: () => undefined,
  clear: () => undefined,
  unmount: () => undefined,
};
