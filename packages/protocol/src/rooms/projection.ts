import { z } from 'zod';
import { roomIdSchema } from '../commands/envelope.js';

export const gameModeSchema = z.enum(['normal', 'quick']);
export const suitSchema = z.enum(['spade', 'heart', 'diamond', 'club']);
export const gamePhaseSchema = z.enum([
  'SELECTING_STARTER',
  'PLAYING',
  'WAITING_FOR_JOKER',
  'SELECTING_REPLACEMENT',
  'GAME_OVER',
]);

const physicalCardSchema = z.object({
  kind: z.literal('physical'),
  id: z.string(),
  suit: suitSchema,
  rank: z.union([z.enum(['A', 'J', 'Q', 'K']), z.int().min(2).max(10)]),
});
const fusedCardSchema = z.object({
  kind: z.literal('fused'),
  id: z.string(),
  suit: suitSchema,
  value: z.int().positive(),
  sourceCardIds: z.tuple([z.string(), z.string()]).readonly(),
});
const jokerCardSchema = z.object({ kind: z.literal('joker'), id: z.string() });
export const handEntitySchema = z.discriminatedUnion('kind', [
  physicalCardSchema,
  fusedCardSchema,
  jokerCardSchema,
]);

export const publicCharacterSchema = z.object({
  id: z.string(),
  rank: z.enum(['J', 'Q', 'K']),
  suit: suitSchema,
  hp: z.int().nonnegative(),
  shield: z.int().nonnegative(),
  eliminated: z.boolean(),
});

export const playerProjectionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarId: z.string().optional(),
  seat: z.int().nonnegative().nullable(),
  connected: z.boolean(),
  eliminated: z.boolean(),
  handCount: z.int().nonnegative(),
  hand: z.array(handEntitySchema).readonly().optional(),
  activeCharacter: publicCharacterSchema.nullable(),
  characters: z.array(publicCharacterSchema).readonly().optional(),
});

export const playedCardNoticeSchema = z.object({
  kind: z.enum(['physical', 'fused']),
  suit: suitSchema,
  value: z.int().positive(),
  fused: z.boolean(),
});

export const battleNoticeSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'play',
    'combat',
    'fusion',
    'rescue',
    'elimination',
    'replacement',
    'timeout',
    'turn',
    'game-over',
  ]),
  actorPlayerId: z.string().nullable(),
  targetPlayerId: z.string().nullable(),
  value: z.int().nonnegative().nullable(),
  cards: z.array(playedCardNoticeSchema).readonly().optional(),
  hpLost: z.int().nonnegative().optional(),
  shieldLost: z.int().nonnegative().optional(),
  healing: z.int().nonnegative().optional(),
  shieldGained: z.int().nonnegative().optional(),
});

export const gameProjectionSchema = z.object({
  id: z.string(),
  version: z.int().nonnegative(),
  mode: gameModeSchema,
  phase: gamePhaseSchema,
  currentPlayerId: z.string().nullable(),
  turnDeadline: z.int().nonnegative().nullable(),
  players: z.array(playerProjectionSchema).readonly(),
  notices: z.array(battleNoticeSchema).readonly().default([]),
  pendingAction: z
    .object({
      victimPlayerId: z.string(),
      offeredPlayerId: z.string().nullable(),
      rescueDeadline: z.int().nonnegative(),
      replacementDeadline: z.int().nonnegative().nullable(),
    })
    .nullable(),
});

export const roomMemberProjectionSchema = z.object({
  identityId: z.string(),
  displayName: z.string(),
  avatarId: z.string().optional(),
  ready: z.boolean(),
  connected: z.boolean(),
  isSelf: z.boolean(),
});

export const roomProjectionSchema = z.object({
  id: roomIdSchema,
  version: z.int().nonnegative(),
  hostIdentityId: z.string(),
  kind: z.enum(['private', 'matchmade', 'pve']),
  mode: gameModeSchema,
  members: z.array(roomMemberProjectionSchema).min(1).max(12).readonly(),
  game: gameProjectionSchema.nullable(),
});

export type GameMode = z.infer<typeof gameModeSchema>;
export type RoomProjection = z.infer<typeof roomProjectionSchema>;
export type RoomMemberProjection = z.infer<typeof roomMemberProjectionSchema>;
export type GameProjection = z.infer<typeof gameProjectionSchema>;
export type BattleNotice = z.infer<typeof battleNoticeSchema>;
