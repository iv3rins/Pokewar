import { z } from 'zod';
import { NAME_NOUNS, NAME_PREFIXES } from './nameVocabulary.js';

export const loginNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{4,24}$/);
export const passwordSchema = z
  .string()
  .min(8)
  .max(72)
  .refine(
    (value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value),
    'PASSWORD_REQUIRES_LETTER_AND_NUMBER',
  );
export const namePrefixSchema = z.enum(NAME_PREFIXES);
export const nameNounSchema = z.enum(NAME_NOUNS);

export const registerAccountSchema = z.object({
  loginName: loginNameSchema,
  password: passwordSchema,
  prefix: namePrefixSchema,
  noun: nameNounSchema,
});
export const loginAccountSchema = z.object({
  loginName: loginNameSchema,
  password: z.string().min(1).max(72),
});
export const accountIdentitySchema = z.object({
  displayName: z.string(),
  kind: z.literal('account'),
});

export type RegisterAccountInput = z.infer<typeof registerAccountSchema>;
export type LoginAccountInput = z.infer<typeof loginAccountSchema>;
