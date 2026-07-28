import { describe, expect, it } from 'vitest';
import { composePublicName, NAME_NOUNS, NAME_PREFIXES } from './nameVocabulary.js';

describe('reviewed public name vocabulary', () => {
  it('contains exactly 100 unique prefixes and 100 unique nouns', () => {
    expect(NAME_PREFIXES).toHaveLength(100);
    expect(NAME_NOUNS).toHaveLength(100);
    expect(new Set(NAME_PREFIXES).size).toBe(100);
    expect(new Set(NAME_NOUNS).size).toBe(100);
  });

  it('creates bounded public names without arbitrary text', () => {
    expect(composePublicName('静默', '星轨')).toBe('静默星轨');
    expect(NAME_PREFIXES.every((word) => word.length >= 2 && word.length <= 3)).toBe(true);
    expect(NAME_NOUNS.every((word) => word.length === 2)).toBe(true);
  });
});
