import { describe, expect, it } from 'vitest';
import { loginNameSchema, passwordSchema, registerAccountSchema } from './account.js';

describe('account wire schemas', () => {
  it('normalizes private login names and validates reviewed public words', () => {
    expect(loginNameSchema.parse('  Player_01 ')).toBe('player_01');
    expect(
      registerAccountSchema.safeParse({
        loginName: 'player_01',
        password: 'secret123',
        prefix: '静默',
        noun: '星轨',
      }).success,
    ).toBe(true);
    expect(
      registerAccountSchema.safeParse({
        loginName: 'player_01',
        password: 'secret123',
        prefix: '自定义',
        noun: '星轨',
      }).success,
    ).toBe(false);
  });

  it('requires an 8-72 character password with letters and numbers', () => {
    expect(passwordSchema.safeParse('password').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
    expect(passwordSchema.safeParse('secure123').success).toBe(true);
  });
});
