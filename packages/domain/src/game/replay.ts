import { createGame } from './create.js';
import type { AcceptedCommandRecord, CreateGameInput, GameState } from './model.js';
import { decide } from './reducer.js';

export interface CommandReplay {
  readonly initial: CreateGameInput;
  readonly commands: readonly AcceptedCommandRecord[];
}

export function replayCommands(replay: CommandReplay): GameState {
  let state = createGame(replay.initial);
  for (const record of replay.commands) {
    const result = decide(state, record.command);
    if (!result.ok) throw new Error(`REPLAY_COMMAND_REJECTED:${result.code}`);
    if (result.state.version !== record.version) throw new Error('REPLAY_VERSION_MISMATCH');
    state = result.state;
  }
  return state;
}
