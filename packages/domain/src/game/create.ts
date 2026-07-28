import { CHARACTER_MAX_HP, type CharacterRank } from '../model/characters.js';
import { SUITS, type Suit } from '../model/cards.js';
import { randomInt, type RandomState } from '../random/prng.js';
import type { CreateGameInput, GamePlayer, GameState } from './model.js';
import { beginPlaying } from './start.js';

const STARTER_SELECTION_MS = 15_000;

function createCharacter(
  gameId: string,
  playerId: string,
  rank: CharacterRank,
  random: RandomState,
): { character: GamePlayer['characters'][number]; random: RandomState } {
  const suitDraw = randomInt(random, SUITS.length);
  const suit: Suit | undefined = SUITS[suitDraw.value];
  if (!suit) throw new Error('CHARACTER_SUIT_NOT_FOUND');
  return {
    character: {
      id: `${gameId}:${playerId}:${rank}`,
      rank,
      suit,
      hp: CHARACTER_MAX_HP[rank],
      shield: 0,
      eliminated: false,
    },
    random: suitDraw.random,
  };
}

export function createGame(input: CreateGameInput): GameState {
  if (input.players.length < 2 || input.players.length > 12)
    throw new Error('PLAYER_COUNT_OUT_OF_RANGE');
  if (new Set(input.players.map((player) => player.id)).size !== input.players.length) {
    throw new Error('DUPLICATE_PLAYER_ID');
  }

  let random: RandomState = { seed: input.seed, cursor: 0 };
  const allRanks: readonly CharacterRank[] = ['J', 'Q', 'K'];
  const players = input.players.map((player, originalJoinIndex): GamePlayer => {
    let ranks = allRanks;
    if (input.mode === 'quick') {
      const rankDraw = randomInt(random, allRanks.length);
      random = rankDraw.random;
      const rank = allRanks[rankDraw.value];
      if (!rank) throw new Error('QUICK_CHARACTER_RANK_NOT_FOUND');
      ranks = [rank];
    }
    const characters = ranks.map((rank) => {
      const result = createCharacter(input.id, player.id, rank, random);
      random = result.random;
      return result.character;
    });
    return {
      id: player.id,
      displayName: player.displayName,
      ...(player.avatarId ? { avatarId: player.avatarId } : {}),
      originalJoinIndex,
      seat: null,
      characters,
      activeCharacterId: input.mode === 'quick' ? (characters[0]?.id ?? null) : null,
      hand: [],
      eliminated: false,
      connected: true,
      disconnectDeadline: null,
    };
  });

  const state: GameState = {
    id: input.id,
    domainVersion: 1,
    version: 0,
    mode: input.mode,
    phase: input.mode === 'quick' ? 'PLAYING' : 'SELECTING_STARTER',
    players,
    deck: null,
    currentPlayerId: null,
    turnDeadline: null,
    starterDeadlines:
      input.mode === 'normal'
        ? players.map((player) => ({
            playerId: player.id,
            at: input.now + STARTER_SELECTION_MS,
          }))
        : [],
    pendingDeath: null,
    random,
    acceptedCommands: [],
  };
  return input.mode === 'quick' ? beginPlaying(state, input.now).state : state;
}
