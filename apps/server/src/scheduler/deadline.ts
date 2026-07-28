import type { GameCommand, GameState } from '@pokewar/domain';

type SystemCommand = Extract<GameCommand, { readonly kind: `system:${string}` }>;
import type { RoomState } from '../rooms/model.js';

export type DeadlineKind = 'disconnect' | 'rescue' | 'starter' | 'replacement' | 'turn';

export interface DeadlineTask {
  readonly id: string;
  readonly roomId: string;
  readonly kind: DeadlineKind;
  readonly playerId: string;
  readonly dueAt: number;
  readonly gameVersion: number;
}

const PRIORITY: Readonly<Record<DeadlineKind, number>> = {
  disconnect: 0,
  rescue: 1,
  starter: 2,
  replacement: 2,
  turn: 3,
};

export function deadlineScore(task: DeadlineTask): number {
  return task.dueAt * 10 + PRIORITY[task.kind];
}

function task(
  roomId: string,
  kind: DeadlineKind,
  playerId: string,
  dueAt: number,
  gameVersion: number,
): DeadlineTask {
  return {
    id: `${roomId}|${kind}|${playerId}|${String(dueAt)}|${String(gameVersion)}`,
    roomId,
    kind,
    playerId,
    dueAt,
    gameVersion,
  };
}

export function extractDeadlines(room: RoomState): readonly DeadlineTask[] {
  const game = room.game;
  if (!game || game.phase === 'GAME_OVER') return [];
  const tasks: DeadlineTask[] = [];
  for (const player of game.players) {
    if (!player.eliminated && player.disconnectDeadline !== null) {
      tasks.push(task(room.id, 'disconnect', player.id, player.disconnectDeadline, game.version));
    }
  }
  if (game.phase === 'SELECTING_STARTER') {
    for (const deadline of game.starterDeadlines) {
      const player = game.players.find((candidate) => candidate.id === deadline.playerId);
      if (player?.activeCharacterId === null) {
        tasks.push(task(room.id, 'starter', player.id, deadline.at, game.version));
      }
    }
  }
  if (game.phase === 'WAITING_FOR_JOKER' && game.pendingDeath) {
    const playerId = game.pendingDeath.rescueQueue[game.pendingDeath.rescueIndex];
    if (playerId) {
      tasks.push(task(room.id, 'rescue', playerId, game.pendingDeath.rescueDeadline, game.version));
    }
  }
  if (
    game.phase === 'SELECTING_REPLACEMENT' &&
    game.pendingDeath?.replacementDeadline !== null &&
    game.pendingDeath !== null
  ) {
    tasks.push(
      task(
        room.id,
        'replacement',
        game.pendingDeath.victimPlayerId,
        game.pendingDeath.replacementDeadline,
        game.version,
      ),
    );
  }
  if (game.phase === 'PLAYING' && game.currentPlayerId && game.turnDeadline !== null) {
    tasks.push(task(room.id, 'turn', game.currentPlayerId, game.turnDeadline, game.version));
  }
  return tasks.sort((left, right) => deadlineScore(left) - deadlineScore(right));
}

export function deadlineCommand(taskValue: DeadlineTask, now: number): SystemCommand {
  const base = {
    actionId: `deadline:${taskValue.id}`,
    expectedVersion: taskValue.gameVersion,
    playerId: taskValue.playerId,
    now,
  };
  switch (taskValue.kind) {
    case 'disconnect':
      return { ...base, kind: 'system:disconnect-timeout' };
    case 'rescue':
      return { ...base, kind: 'system:rescue-offer-timeout' };
    case 'starter':
      return { ...base, kind: 'system:starter-timeout' };
    case 'replacement':
      return { ...base, kind: 'system:replacement-timeout' };
    case 'turn':
      return { ...base, kind: 'system:turn-timeout' };
  }
}

export function gameForDeadline(room: RoomState, taskValue: DeadlineTask): GameState | null {
  return room.game?.version === taskValue.gameVersion ? room.game : null;
}
