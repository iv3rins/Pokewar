import { describe, expect, it } from 'vitest';
import { roomCommandSchema, systemCommandSchema } from './envelope.js';

const base = {
  roomId: 'A2BCD',
  actionId: '123e4567-e89b-42d3-a456-426614174000',
  expectedVersion: 3,
};

describe('roomCommandSchema', () => {
  it.each([1, 3, 5] as const)('accepts a %i-card play command', (count) => {
    expect(
      roomCommandSchema.safeParse({
        ...base,
        kind: 'game:play-cards',
        cardIds: Array.from({ length: count }, (_, index) => `card-${String(index)}`),
        targetPlayerId: 'player-2',
      }).success,
    ).toBe(true);
  });

  it.each([2, 4, 6])('rejects a %i-card play command at the boundary', (count) => {
    expect(
      roomCommandSchema.safeParse({
        ...base,
        kind: 'game:play-cards',
        cardIds: Array.from({ length: count }, (_, index) => `card-${String(index)}`),
      }).success,
    ).toBe(false);
  });

  it('requires exactly two Joker IDs for execution', () => {
    expect(
      roomCommandSchema.safeParse({
        ...base,
        kind: 'game:execute-character',
        jokerCardIds: ['joker-1', 'joker-2'],
        targetPlayerId: 'player-2',
      }).success,
    ).toBe(true);
  });

  it('keeps internal system commands outside the public room command schema', () => {
    const systemCommand = {
      ...base,
      playerId: 'player-1',
      now: 31_001,
      kind: 'system:turn-timeout',
    };
    expect(roomCommandSchema.safeParse(systemCommand).success).toBe(false);
    expect(systemCommandSchema.safeParse(systemCommand).success).toBe(true);
  });
});
