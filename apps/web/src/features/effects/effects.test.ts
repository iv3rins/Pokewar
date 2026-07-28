import type { GameProjection } from '@pokewar/protocol';
import { describe, expect, it } from 'vitest';
import { noticeDescription } from './BattleEffects.js';
import { registeredEffectKeys, resolveEffect } from './registry.js';

const game: GameProjection = {
  id: 'A2BCD',
  version: 2,
  mode: 'quick',
  phase: 'PLAYING',
  currentPlayerId: 'self',
  turnDeadline: 30_000,
  pendingAction: null,
  notices: [],
  players: [
    {
      id: 'self',
      displayName: '自己',
      seat: 0,
      connected: true,
      eliminated: false,
      handCount: 5,
      activeCharacter: null,
    },
    {
      id: 'bot',
      displayName: '机器人',
      seat: 1,
      connected: true,
      eliminated: false,
      handCount: 5,
      activeCharacter: null,
    },
  ],
};

const spadeNotice = {
  id: '2:cards:played:0',
  kind: 'play' as const,
  actorPlayerId: 'self',
  targetPlayerId: 'bot',
  value: 7,
  cards: [{ kind: 'physical' as const, suit: 'spade' as const, value: 7, fused: false }],
};

describe('battle effect registry', () => {
  it('resolves a spade play into visual, audio, and text cue', () => {
    const cue = resolveEffect({ game, notice: spadeNotice, previousNotice: null });
    expect(cue).toMatchObject({
      kind: 'spade',
      sound: 'attack',
      shake: true,
      actorPlayerId: 'self',
      targetPlayerId: 'bot',
      value: 7,
    });
    expect(cue.text).toContain('自己');
    expect(cue.text).toContain('机器人');
  });

  it('produces a structured accessible history description', () => {
    expect(noticeDescription(game, spadeNotice)).toBe('自己 打出 7♠，攻击 机器人；总点数 7');
  });

  it('exposes registered handlers for read-only development diagnostics', () => {
    expect(registeredEffectKeys()).toEqual(
      expect.arrayContaining(['play:spade', 'play:heart', 'play:diamond', 'play:club', 'rescue']),
    );
  });
});
