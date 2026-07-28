import type { RoomState } from '../rooms/model.js';
import type { RoomService } from '../rooms/roomService.js';
import { beginnerStrategy, type BotStrategy } from './strategy.js';

export class BotService {
  readonly #runningRooms = new Set<string>();

  constructor(
    private readonly rooms: RoomService,
    private readonly strategy: BotStrategy = beginnerStrategy,
  ) {}

  async executeBotTurnIfNeeded(roomId: string, now: number): Promise<RoomState | null> {
    const room = await this.rooms.get(roomId);
    if (!room?.game || room.game.phase === 'GAME_OVER') return null;

    const actorId = this.botActorId(room.game);
    if (!actorId) return null;
    const command = this.strategy(room.game, actorId, now);
    if (!command) return null;

    return this.rooms.executeBotCommand(roomId, command);
  }

  private botActorId(game: NonNullable<RoomState['game']>): string | null {
    if (game.phase === 'SELECTING_STARTER') {
      return (
        game.players.find(
          (player) => this.isBotPlayer(player.id) && player.activeCharacterId === null,
        )?.id ?? null
      );
    }
    if (game.phase === 'WAITING_FOR_JOKER' && game.pendingDeath) {
      const offered = game.pendingDeath.rescueQueue[game.pendingDeath.rescueIndex];
      return offered && this.isBotPlayer(offered) ? offered : null;
    }
    if (game.phase === 'SELECTING_REPLACEMENT' && game.pendingDeath) {
      const victim = game.pendingDeath.victimPlayerId;
      return this.isBotPlayer(victim) ? victim : null;
    }
    const currentPlayerId = game.currentPlayerId;
    return currentPlayerId && this.isBotPlayer(currentPlayerId) ? currentPlayerId : null;
  }

  async executeBotSequence(
    roomId: string,
    onUpdated: (room: RoomState) => void,
    delayMs = 800,
  ): Promise<void> {
    if (this.#runningRooms.has(roomId)) return;
    this.#runningRooms.add(roomId);
    try {
      let continueSequence = true;
      while (continueSequence) {
        const room = await this.rooms.get(roomId);
        if (!room?.game || !this.botActorId(room.game)) return;
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        const updated = await this.executeBotTurnIfNeeded(roomId, Date.now());
        if (!updated) return;
        onUpdated(updated);
        continueSequence = updated.game !== null && this.botActorId(updated.game) !== null;
      }
    } finally {
      this.#runningRooms.delete(roomId);
    }
  }

  isBotPlayer(identityId: string): boolean {
    return identityId.startsWith('bot:');
  }
}
