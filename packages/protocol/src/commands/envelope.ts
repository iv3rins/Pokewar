import { z } from 'zod';

export const roomIdSchema = z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
export const actionIdSchema = z.uuid();
export const cardIdSchema = z.string().min(1).max(80);

const commandBase = {
  roomId: roomIdSchema,
  actionId: actionIdSchema,
  expectedVersion: z.int().nonnegative(),
};

export const roomCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    ...commandBase,
    kind: z.literal('game:select-starter'),
    characterId: z.string().min(1).max(80),
  }),
  z.object({
    ...commandBase,
    kind: z.literal('game:create-fusion'),
    cardIds: z.tuple([cardIdSchema, cardIdSchema]),
    selectedSuit: z.enum(['spade', 'heart', 'diamond', 'club']),
  }),
  z.object({
    ...commandBase,
    kind: z.literal('game:play-cards'),
    cardIds: z.union([
      z.tuple([cardIdSchema]),
      z.tuple([cardIdSchema, cardIdSchema, cardIdSchema]),
      z.tuple([cardIdSchema, cardIdSchema, cardIdSchema, cardIdSchema, cardIdSchema]),
    ]),
    targetPlayerId: z.string().min(1).max(80).optional(),
  }),
  z.object({
    ...commandBase,
    kind: z.literal('game:rescue-with-joker'),
    jokerCardId: cardIdSchema,
  }),
  z.object({
    ...commandBase,
    kind: z.literal('game:decline-rescue'),
  }),
  z.object({
    ...commandBase,
    kind: z.literal('game:select-replacement'),
    characterId: z.string().min(1).max(80),
  }),
  z.object({
    ...commandBase,
    kind: z.literal('game:execute-character'),
    jokerCardIds: z.tuple([cardIdSchema, cardIdSchema]),
    targetPlayerId: z.string().min(1).max(80),
  }),
  z.object({
    ...commandBase,
    kind: z.literal('game:leave-match'),
  }),
]);

const systemCommandBase = {
  roomId: roomIdSchema,
  actionId: actionIdSchema,
  expectedVersion: z.int().nonnegative(),
  playerId: z.string().min(1).max(80),
  now: z.int().nonnegative(),
};

export const systemCommandSchema = z.discriminatedUnion('kind', [
  z.object({ ...systemCommandBase, kind: z.literal('system:starter-timeout') }),
  z.object({ ...systemCommandBase, kind: z.literal('system:turn-timeout') }),
  z.object({ ...systemCommandBase, kind: z.literal('system:rescue-offer-timeout') }),
  z.object({ ...systemCommandBase, kind: z.literal('system:replacement-timeout') }),
  z.object({ ...systemCommandBase, kind: z.literal('system:player-disconnected') }),
  z.object({ ...systemCommandBase, kind: z.literal('system:player-reconnected') }),
  z.object({ ...systemCommandBase, kind: z.literal('system:disconnect-timeout') }),
]);

export type RoomCommand = z.infer<typeof roomCommandSchema>;
export type SystemCommand = z.infer<typeof systemCommandSchema>;
