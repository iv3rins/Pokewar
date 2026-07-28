import { randomInt } from '../random/prng.js';
import { decideDeathPhase } from './death.js';
import type {
  DomainEvent,
  GameCommand,
  GameState,
  StarterDeadline,
  TransitionResult,
} from './model.js';
import { createFusionInGame, playCardsInGame } from './playing.js';
import { beginPlaying } from './start.js';
import { decideSystemBehavior } from './system.js';

function starterDeadline(state: GameState, playerId: string): StarterDeadline | undefined {
  return state.starterDeadlines.find((deadline) => deadline.playerId === playerId);
}

function decideStarter(state: GameState, command: GameCommand): TransitionResult {
  if (command.kind !== 'game:select-starter' && command.kind !== 'system:starter-timeout') {
    return { ok: false, code: 'INVALID_PHASE' };
  }
  if (state.phase !== 'SELECTING_STARTER') return { ok: false, code: 'INVALID_PHASE' };

  const player = state.players.find((candidate) => candidate.id === command.playerId);
  if (!player) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (player.activeCharacterId) return { ok: false, code: 'STARTER_ALREADY_SELECTED' };
  const deadline = starterDeadline(state, player.id);
  if (!deadline) return { ok: false, code: 'INVALID_PHASE' };

  let characterId: string;
  let random = state.random;
  let selectionEvent: DomainEvent;
  if (command.kind === 'game:select-starter') {
    if (command.now > deadline.at) return { ok: false, code: 'DEADLINE_EXPIRED' };
    if (
      !player.characters.some(
        (character) => character.id === command.characterId && !character.eliminated,
      )
    ) {
      return { ok: false, code: 'CHARACTER_NOT_AVAILABLE' };
    }
    characterId = command.characterId;
    selectionEvent = { kind: 'starter:selected', playerId: player.id };
  } else {
    if (command.now <= deadline.at) return { ok: false, code: 'DEADLINE_NOT_REACHED' };
    const draw = randomInt(random, player.characters.length);
    random = draw.random;
    const selected = player.characters[draw.value];
    if (!selected) throw new Error('AUTO_STARTER_NOT_FOUND');
    characterId = selected.id;
    selectionEvent = { kind: 'starter:auto-selected', playerId: player.id };
  }

  let nextState: GameState = {
    ...state,
    players: state.players.map((candidate) =>
      candidate.id === player.id ? { ...candidate, activeCharacterId: characterId } : candidate,
    ),
    random,
  };
  const events: DomainEvent[] = [selectionEvent];
  if (nextState.players.every((candidate) => candidate.activeCharacterId !== null)) {
    const finalized = beginPlaying(nextState, command.now);
    nextState = finalized.state;
    events.push(...finalized.events);
  }
  return { ok: true, state: nextState, events };
}

function decideCommand(state: GameState, command: GameCommand): TransitionResult {
  switch (command.kind) {
    case 'game:select-starter':
    case 'system:starter-timeout':
      return decideStarter(state, command);
    case 'game:create-fusion':
      return createFusionInGame(state, command);
    case 'game:play-cards':
      return playCardsInGame(state, command);
    case 'game:rescue-with-joker':
    case 'game:decline-rescue':
    case 'system:rescue-offer-timeout':
    case 'game:select-replacement':
    case 'system:replacement-timeout':
      return decideDeathPhase(state, command);
    case 'game:execute-character':
    case 'system:turn-timeout':
    case 'system:player-disconnected':
    case 'system:player-reconnected':
    case 'system:disconnect-timeout':
    case 'game:leave-match':
      return decideSystemBehavior(state, command);
  }
}

export function decide(state: GameState, command: GameCommand): TransitionResult {
  if (state.acceptedCommands.some((record) => record.command.actionId === command.actionId)) {
    return { ok: false, code: 'ACTION_ID_REUSED' };
  }
  if (command.expectedVersion !== state.version) return { ok: false, code: 'STALE_GAME_VERSION' };

  const result = decideCommand(state, command);
  if (!result.ok) return result;
  const nextVersion = state.version + 1;
  return {
    ok: true,
    state: {
      ...result.state,
      version: nextVersion,
      acceptedCommands: [...state.acceptedCommands, { version: nextVersion, command }],
    },
    events: result.events,
  };
}
