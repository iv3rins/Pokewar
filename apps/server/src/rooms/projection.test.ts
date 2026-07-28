import { createGame } from '@pokewar/domain';
import { describe, expect, it } from 'vitest';
import { projectGame } from './projection.js';

describe('viewer-specific game projection', () => {
  it('shows owner private state while redacting opponent reserves and all canonical internals', () => {
    const game = createGame({
      id: 'projection-game',
      mode: 'quick',
      seed: 'private-seed',
      now: 1_000,
      players: [
        { id: 'owner', displayName: '自己#A001' },
        { id: 'opponent', displayName: '对手#B002' },
      ],
    });
    const projection = projectGame(game, 'owner');
    const owner = projection.players.find((player) => player.id === 'owner');
    const opponent = projection.players.find((player) => player.id === 'opponent');
    expect(owner?.hand).toHaveLength(5);
    expect(owner?.characters).toHaveLength(1);
    expect(opponent?.hand).toBeUndefined();
    expect(opponent?.characters).toBeUndefined();
    expect(opponent?.handCount).toBe(5);
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('private-seed');
    expect(serialized).not.toContain('drawPile');
    expect(serialized).not.toContain('acceptedCommands');
    expect(serialized).not.toContain('sourceCardIds');
  });

  it('projects only stable public battle notices from recent domain events', () => {
    const game = createGame({
      id: 'notice-game',
      mode: 'quick',
      seed: 'notice-seed',
      now: 1_000,
      players: [
        { id: 'owner', displayName: '自己#A001' },
        { id: 'opponent', displayName: '对手#B002' },
      ],
    });
    const projection = projectGame(game, 'owner', [
      {
        gameVersion: 1,
        events: [
          {
            kind: 'combat:resolved',
            attackerPlayerId: 'owner',
            targetPlayerId: 'opponent',
            hpLost: 7,
            shieldLost: 0,
            healing: 0,
            shieldGained: 0,
            immuneToSuitEffect: false,
          },
        ],
      },
    ]);
    expect(projection.notices).toEqual([
      {
        id: '1:combat:resolved:0',
        kind: 'combat',
        actorPlayerId: 'owner',
        targetPlayerId: 'opponent',
        value: 7,
        hpLost: 7,
        shieldLost: 0,
        healing: 0,
        shieldGained: 0,
      },
    ]);
  });

  it('projects public card faces for the central played-card presentation', () => {
    const game = createGame({
      id: 'cards-game',
      mode: 'quick',
      seed: 'cards-seed',
      now: 1_000,
      players: [
        { id: 'owner', displayName: '自己#A001' },
        { id: 'opponent', displayName: '对手#B002' },
      ],
    });
    const projection = projectGame(game, 'owner', [
      {
        gameVersion: 2,
        events: [
          {
            kind: 'cards:played',
            playerId: 'owner',
            targetPlayerId: 'opponent',
            cards: [
              { kind: 'physical', suit: 'heart', value: 7, fused: false },
              { kind: 'fused', suit: 'heart', value: 9, fused: true },
              { kind: 'physical', suit: 'heart', value: 4, fused: false },
            ],
            totalValue: 20,
            bypassSuitImmunity: true,
          },
        ],
      },
    ]);
    expect(projection.notices[0]).toMatchObject({
      kind: 'play',
      actorPlayerId: 'owner',
      targetPlayerId: 'opponent',
      value: 20,
      cards: [
        { suit: 'heart', value: 7, fused: false },
        { suit: 'heart', value: 9, fused: true },
        { suit: 'heart', value: 4, fused: false },
      ],
    });
  });
});
