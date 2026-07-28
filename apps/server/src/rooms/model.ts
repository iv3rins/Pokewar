import type { DomainEvent, GameErrorCode, GameMode, GameState } from '@pokewar/domain';
import type { RoomCommand } from '@pokewar/protocol';

export interface LobbyMember {
  readonly identityId: string;
  readonly displayName: string;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly joinedAt: number;
}

export interface RoomEventBatch {
  readonly gameVersion: number;
  readonly events: readonly DomainEvent[];
}

export interface AcceptedActionResult {
  readonly identityId: string;
  readonly actionId: string;
  readonly command: RoomCommand;
  readonly roomVersion: number;
  readonly gameVersion: number;
  readonly events: readonly DomainEvent[];
}

export interface RoomState {
  readonly id: string;
  readonly version: number;
  readonly hostIdentityId: string;
  readonly kind?: 'private' | 'matchmade' | 'pve';
  readonly ranked?: boolean;
  readonly mode: GameMode;
  readonly members: readonly LobbyMember[];
  readonly bannedUntil: Readonly<Record<string, number>>;
  readonly game: GameState | null;
  readonly eventHistory?: readonly RoomEventBatch[];
  readonly acceptedActionResults?: readonly AcceptedActionResult[];
  readonly eliminationGroups?: readonly (readonly string[])[];
  readonly ratingsSettled?: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type RoomErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_ALREADY_STARTED'
  | 'ALREADY_IN_ROOM'
  | 'NOT_ROOM_MEMBER'
  | 'NOT_ROOM_HOST'
  | 'PLAYER_BANNED'
  | 'NOT_ALL_READY'
  | 'INVALID_PLAYER_COUNT'
  | 'STALE_ROOM_VERSION';

export type RoomMutation<T = RoomState> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: RoomErrorCode | GameErrorCode };
