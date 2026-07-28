import type { DeckState } from '../deck/deck.js';
import type { HandEntity, Suit } from '../model/cards.js';
import type { CharacterRank, CharacterState } from '../model/characters.js';
import type { RandomState } from '../random/prng.js';

export type GameMode = 'normal' | 'quick';
export type GamePhase =
  'SELECTING_STARTER' | 'PLAYING' | 'WAITING_FOR_JOKER' | 'SELECTING_REPLACEMENT' | 'GAME_OVER';

export interface GamePlayer {
  readonly id: string;
  readonly displayName: string;
  readonly avatarId?: string;
  readonly originalJoinIndex: number;
  readonly seat: number | null;
  readonly characters: readonly CharacterState[];
  readonly activeCharacterId: string | null;
  readonly hand: readonly HandEntity[];
  readonly eliminated: boolean;
  readonly connected: boolean;
  readonly disconnectDeadline: number | null;
}

export interface StarterDeadline {
  readonly playerId: string;
  readonly at: number;
}

export interface PendingDeathResolution {
  readonly attackerPlayerId: string;
  readonly victimPlayerId: string;
  readonly attackerSeat: number;
  readonly diamondDrawCount: number;
  readonly rewardKiller: boolean;
  readonly supplyAttacker: boolean;
  readonly rescueQueue: readonly string[];
  readonly rescueIndex: number;
  readonly rescueDeadline: number;
  readonly replacementDeadline: number | null;
}

export interface AcceptedCommandRecord {
  readonly version: number;
  readonly command: GameCommand;
}

export interface GameState {
  readonly id: string;
  readonly domainVersion: 1;
  readonly version: number;
  readonly mode: GameMode;
  readonly phase: GamePhase;
  readonly players: readonly GamePlayer[];
  readonly deck: DeckState | null;
  readonly currentPlayerId: string | null;
  readonly turnDeadline: number | null;
  readonly starterDeadlines: readonly StarterDeadline[];
  readonly pendingDeath: PendingDeathResolution | null;
  readonly random: RandomState;
  readonly acceptedCommands: readonly AcceptedCommandRecord[];
}

interface CommandBase {
  readonly actionId: string;
  readonly expectedVersion: number;
  readonly playerId: string;
  readonly now: number;
}

export interface SelectStarterCommand extends CommandBase {
  readonly kind: 'game:select-starter';
  readonly characterId: string;
}

export interface StarterTimeoutCommand extends CommandBase {
  readonly kind: 'system:starter-timeout';
}

export interface CreateFusionCommand extends CommandBase {
  readonly kind: 'game:create-fusion';
  readonly cardIds: readonly [string, string];
  readonly selectedSuit: Suit;
  readonly fusedCardId: string;
}

export interface PlayCardsCommand extends CommandBase {
  readonly kind: 'game:play-cards';
  readonly cardIds:
    | readonly [string]
    | readonly [string, string, string]
    | readonly [string, string, string, string, string];
  readonly targetPlayerId?: string;
}

export interface RescueWithJokerCommand extends CommandBase {
  readonly kind: 'game:rescue-with-joker';
  readonly jokerCardId: string;
}

export interface DeclineRescueCommand extends CommandBase {
  readonly kind: 'game:decline-rescue';
}

export interface RescueOfferTimeoutCommand extends CommandBase {
  readonly kind: 'system:rescue-offer-timeout';
}

export interface SelectReplacementCommand extends CommandBase {
  readonly kind: 'game:select-replacement';
  readonly characterId: string;
}

export interface ReplacementTimeoutCommand extends CommandBase {
  readonly kind: 'system:replacement-timeout';
}

export interface ExecuteCharacterCommand extends CommandBase {
  readonly kind: 'game:execute-character';
  readonly jokerCardIds: readonly [string, string];
  readonly targetPlayerId: string;
}

export interface TurnTimeoutCommand extends CommandBase {
  readonly kind: 'system:turn-timeout';
}

export interface PlayerDisconnectedCommand extends CommandBase {
  readonly kind: 'system:player-disconnected';
}

export interface PlayerReconnectedCommand extends CommandBase {
  readonly kind: 'system:player-reconnected';
}

export interface DisconnectTimeoutCommand extends CommandBase {
  readonly kind: 'system:disconnect-timeout';
}

export interface LeaveMatchCommand extends CommandBase {
  readonly kind: 'game:leave-match';
}

export type GameCommand =
  | SelectStarterCommand
  | StarterTimeoutCommand
  | CreateFusionCommand
  | PlayCardsCommand
  | RescueWithJokerCommand
  | DeclineRescueCommand
  | RescueOfferTimeoutCommand
  | SelectReplacementCommand
  | ReplacementTimeoutCommand
  | ExecuteCharacterCommand
  | TurnTimeoutCommand
  | PlayerDisconnectedCommand
  | PlayerReconnectedCommand
  | DisconnectTimeoutCommand
  | LeaveMatchCommand;

export type GameErrorCode =
  | 'ACTION_ID_REUSED'
  | 'STALE_GAME_VERSION'
  | 'INVALID_PHASE'
  | 'PLAYER_NOT_FOUND'
  | 'NOT_CURRENT_ACTOR'
  | 'CHARACTER_NOT_AVAILABLE'
  | 'STARTER_ALREADY_SELECTED'
  | 'DEADLINE_NOT_REACHED'
  | 'DEADLINE_EXPIRED'
  | 'CARD_NOT_IN_HAND'
  | 'DUPLICATE_CARD_ID'
  | 'FUSED_CARD_ID_REUSED'
  | 'FUSION_REQUIRES_EXACTLY_TWO_PHYSICAL_CARDS'
  | 'FUSION_REQUIRES_ONE_ACE'
  | 'INVALID_FUSION_SUIT'
  | 'JOKER_NOT_ALLOWED'
  | 'INVALID_CARD_COUNT'
  | 'MIXED_SUITS'
  | 'TARGET_REQUIRED'
  | 'TARGET_NOT_ALLOWED'
  | 'INVALID_TARGET'
  | 'NOT_RESCUE_ACTOR'
  | 'JOKER_NOT_IN_HAND'
  | 'TWO_DISTINCT_JOKERS_REQUIRED'
  | 'NOT_REPLACEMENT_ACTOR'
  | 'PLAYER_ALREADY_DISCONNECTED'
  | 'PLAYER_ALREADY_CONNECTED'
  | 'DISCONNECT_DEADLINE_NOT_REACHED';

export interface PublicPlayedCard {
  readonly kind: 'physical' | 'fused';
  readonly suit: Suit;
  readonly value: number;
  readonly fused: boolean;
}

export type DomainEvent =
  | { readonly kind: 'starter:selected'; readonly playerId: string }
  | { readonly kind: 'starter:auto-selected'; readonly playerId: string }
  | { readonly kind: 'starters:revealed'; readonly starters: Readonly<Record<string, string>> }
  | { readonly kind: 'seats:assigned'; readonly playerIds: readonly string[] }
  | { readonly kind: 'initial-hands:dealt'; readonly cardCounts: Readonly<Record<string, number>> }
  | { readonly kind: 'fusion:created'; readonly playerId: string; readonly card: PublicPlayedCard }
  | {
      readonly kind: 'cards:played';
      readonly playerId: string;
      readonly targetPlayerId: string | null;
      readonly cards: readonly PublicPlayedCard[];
      readonly totalValue: number;
      readonly bypassSuitImmunity: boolean;
    }
  | {
      readonly kind: 'combat:resolved';
      readonly attackerPlayerId: string;
      readonly targetPlayerId: string | null;
      readonly hpLost: number;
      readonly shieldLost: number;
      readonly healing: number;
      readonly shieldGained: number;
      readonly immuneToSuitEffect: boolean;
    }
  | {
      readonly kind: 'cards:drawn';
      readonly playerId: string;
      readonly count: number;
      readonly reason: 'diamond' | 'empty-supply' | 'rescue' | 'replacement' | 'elimination-reward';
    }
  | {
      readonly kind: 'joker:rescue-started';
      readonly victimPlayerId: string;
      readonly offeredPlayerId: string;
      readonly deadline: number;
    }
  | {
      readonly kind: 'joker:rescue-declined';
      readonly playerId: string;
      readonly reason: 'declined' | 'timeout';
    }
  | {
      readonly kind: 'joker:rescued';
      readonly rescuerPlayerId: string;
      readonly victimPlayerId: string;
    }
  | {
      readonly kind: 'character:eliminated';
      readonly playerId: string;
      readonly characterId: string;
    }
  | { readonly kind: 'replacement:started'; readonly playerId: string; readonly deadline: number }
  | {
      readonly kind: 'replacement:selected';
      readonly playerId: string;
      readonly characterId: string;
      readonly automatic: boolean;
    }
  | {
      readonly kind: 'character:executed';
      readonly attackerPlayerId: string;
      readonly victimPlayerId: string;
    }
  | {
      readonly kind: 'turn:timed-out';
      readonly playerId: string;
      readonly hpLost: number;
      readonly discardedCardId: string | null;
    }
  | { readonly kind: 'player:disconnected'; readonly playerId: string; readonly deadline: number }
  | { readonly kind: 'player:reconnected'; readonly playerId: string }
  | {
      readonly kind: 'player:eliminated';
      readonly playerId: string;
      readonly reason?: 'characters' | 'disconnect' | 'left';
    }
  | { readonly kind: 'game:over'; readonly winnerPlayerId: string }
  | { readonly kind: 'turn:started'; readonly playerId: string; readonly deadline: number };

export type TransitionResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly DomainEvent[] }
  | { readonly ok: false; readonly code: GameErrorCode };

export interface CreateGamePlayer {
  readonly id: string;
  readonly displayName: string;
  readonly avatarId?: string;
}

export interface CreateGameInput {
  readonly id: string;
  readonly mode: GameMode;
  readonly players: readonly CreateGamePlayer[];
  readonly seed: string;
  readonly now: number;
}

export interface CharacterTemplate {
  readonly rank: CharacterRank;
  readonly suit: Suit;
}
