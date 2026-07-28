import { describe, expect, it, vi } from 'vitest';
import { RoomLock } from '../rooms/lock.js';
import { RoomService } from '../rooms/roomService.js';
import { MemoryRoomStore } from '../storage/roomStore.js';
import { BotService } from './botService.js';

const human = {
  id: 'human',
  displayName: '静默旅者#A001',
  nickname: '静默旅者',
  kind: 'guest' as const,
};

describe('BotService sequence', () => {
  it('selects starters for every bot in sequence and stops for the human actor', async () => {
    const rooms = new RoomService(new MemoryRoomStore(), new RoomLock());
    const room = await rooms.createPveRoom(human, 'normal', 4, Date.now());
    const bots = new BotService(rooms);
    const onUpdated = vi.fn();

    await bots.executeBotSequence(room.id, onUpdated, 0);

    const updated = await rooms.get(room.id);
    const botPlayers =
      updated?.game?.players.filter((player) => player.id.startsWith('bot:')) ?? [];
    expect(botPlayers).toHaveLength(3);
    expect(botPlayers.every((player) => player.activeCharacterId !== null)).toBe(true);
    expect(updated?.game?.phase).toBe('SELECTING_STARTER');
    expect(onUpdated).toHaveBeenCalledTimes(3);
  });
});
