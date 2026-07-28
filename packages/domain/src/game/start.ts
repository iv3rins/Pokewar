import { createDeck, drawCards } from '../deck/deck.js';
import { randomInt, shuffle } from '../random/prng.js';
import type { DomainEvent, GamePlayer, GameState } from './model.js';

const TURN_MS = 30_000;

export function beginPlaying(
  state: GameState,
  now: number,
): { readonly state: GameState; readonly events: readonly DomainEvent[] } {
  if (state.players.some((player) => player.activeCharacterId === null)) {
    throw new Error('ACTIVE_CHARACTER_REQUIRED');
  }

  const seatShuffle = shuffle(state.players, state.random);
  let random = seatShuffle.random;
  let players = seatShuffle.value.map((player, seat): GamePlayer => ({ ...player, seat }));
  const firstPlayerDraw = randomInt(random, players.length);
  random = firstPlayerDraw.random;
  const firstPlayer = players[firstPlayerDraw.value];
  if (!firstPlayer) throw new Error('FIRST_PLAYER_NOT_FOUND');

  const createdDeck = createDeck(players.length, random);
  let deck = createdDeck.deck;
  random = createdDeck.random;

  for (let round = 0; round < 5; round += 1) {
    for (const player of players) {
      const draw = drawCards(deck, 1, random);
      deck = draw.deck;
      random = draw.random;
      if (draw.cards.length === 0) break;
      players = players.map((candidate) =>
        candidate.id === player.id
          ? { ...candidate, hand: [...candidate.hand, ...draw.cards] }
          : candidate,
      );
    }
  }

  const starters = Object.fromEntries(
    players.map((player) => [player.id, player.activeCharacterId ?? '']),
  );
  const cardCounts = Object.fromEntries(players.map((player) => [player.id, player.hand.length]));
  const turnDeadline = now + TURN_MS;
  return {
    state: {
      ...state,
      phase: 'PLAYING',
      players,
      deck,
      currentPlayerId: firstPlayer.id,
      turnDeadline,
      starterDeadlines: [],
      random,
    },
    events: [
      { kind: 'starters:revealed', starters },
      { kind: 'seats:assigned', playerIds: players.map((player) => player.id) },
      { kind: 'initial-hands:dealt', cardCounts },
      { kind: 'turn:started', playerId: firstPlayer.id, deadline: turnDeadline },
    ],
  };
}
