import type { BattleNotice } from '@pokewar/protocol';
import type { EffectContext, EffectCue, EffectHandler, EffectKind } from './types.js';

function playerName(context: EffectContext, playerId: string | null): string {
  return context.game.players.find((player) => player.id === playerId)?.displayName ?? '牌桌';
}

function cue(
  context: EffectContext,
  kind: EffectKind,
  text: string,
  options: Partial<Pick<EffectCue, 'sound' | 'durationMs' | 'priority' | 'shake'>> = {},
): EffectCue {
  const notice = context.notice;
  return {
    id: `cue:${notice.id}`,
    noticeId: notice.id,
    kind,
    actorPlayerId: notice.actorPlayerId,
    targetPlayerId: notice.targetPlayerId,
    value: notice.value,
    text,
    sound: options.sound ?? null,
    durationMs: options.durationMs ?? 800,
    priority: options.priority ?? 'normal',
    shake: options.shake ?? false,
    cards: notice.cards,
    hpLost: notice.hpLost ?? 0,
    shieldLost: notice.shieldLost ?? 0,
    healing: notice.healing ?? 0,
    shieldGained: notice.shieldGained ?? 0,
  };
}

const handlerKey = (notice: BattleNotice): string => {
  if (notice.kind === 'play') return `play:${notice.cards?.[0]?.suit ?? 'unknown'}`;
  return notice.kind;
};

const handlers = new Map<string, EffectHandler>();

export function registerEffect(key: string, handler: EffectHandler): () => void {
  handlers.set(key, handler);
  return () => handlers.delete(key);
}

export function registeredEffectKeys(): readonly string[] {
  return [...handlers.keys()].sort();
}

export function resolveEffect(context: EffectContext): EffectCue {
  try {
    const handler = handlers.get(handlerKey(context.notice)) ?? handlers.get(context.notice.kind);
    if (handler) return handler(context);
  } catch (error) {
    if (import.meta.env.DEV) console.error('[effects] handler failed', error);
  }
  const actor = playerName(context, context.notice.actorPlayerId);
  return cue(context, 'text', `${actor} 触发了 ${context.notice.kind}`, { priority: 'low' });
}

registerEffect('play:spade', (context) =>
  cue(
    context,
    'spade',
    `${playerName(context, context.notice.actorPlayerId)} 用黑桃攻击 ${playerName(context, context.notice.targetPlayerId)}`,
    { sound: 'attack', shake: true },
  ),
);
registerEffect('play:heart', (context) =>
  cue(
    context,
    'heart',
    `${playerName(context, context.notice.actorPlayerId)} 用红桃攻击 ${playerName(context, context.notice.targetPlayerId)}`,
    { sound: 'heal' },
  ),
);
registerEffect('play:diamond', (context) =>
  cue(
    context,
    'diamond',
    `${playerName(context, context.notice.actorPlayerId)} 打出方块并触发丰收`,
    { sound: 'draw' },
  ),
);
registerEffect('play:club', (context) =>
  cue(context, 'club', `${playerName(context, context.notice.actorPlayerId)} 打出梅花获得护盾`, {
    sound: 'shield',
  }),
);
registerEffect('fusion', (context) =>
  cue(context, 'fusion', `${playerName(context, context.notice.actorPlayerId)} 完成万化融合`, {
    sound: 'joker',
    priority: 'critical',
  }),
);
registerEffect('rescue', (context) =>
  cue(
    context,
    'joker-rescue',
    `${playerName(context, context.notice.actorPlayerId)} 救援 ${playerName(context, context.notice.targetPlayerId)}`,
    { sound: 'joker', priority: 'critical', durationMs: 900 },
  ),
);
registerEffect('elimination', (context) =>
  cue(context, 'elimination', `${playerName(context, context.notice.targetPlayerId)} 被淘汰`, {
    sound: 'damage',
    priority: 'critical',
    shake: true,
  }),
);
registerEffect('timeout', (context) =>
  cue(context, 'timeout', `${playerName(context, context.notice.actorPlayerId)} 回合超时`, {
    sound: 'error',
    priority: 'normal',
  }),
);
registerEffect('turn', (context) =>
  cue(context, 'turn', `轮到 ${playerName(context, context.notice.actorPlayerId)} 行动`, {
    sound: 'turn',
    priority: 'low',
    durationMs: 500,
  }),
);
registerEffect('game-over', (context) =>
  cue(context, 'game-over', `${playerName(context, context.notice.actorPlayerId)} 赢得对局`, {
    sound: 'win',
    priority: 'critical',
    durationMs: 1000,
  }),
);
