import { describe, expect, it } from 'vitest';
import { randomInt, shuffle, type RandomState } from './prng.js';

const seed = (value = 'test-seed'): RandomState => ({ seed: value, cursor: 0 });

describe('deterministic random', () => {
  it('returns the same sequence for the same seed and cursor', () => {
    const first = randomInt(seed(), 1000);
    const second = randomInt(first.random, 1000);
    const replayFirst = randomInt(seed(), 1000);
    const replaySecond = randomInt(replayFirst.random, 1000);
    expect([first.value, second.value]).toEqual([replayFirst.value, replaySecond.value]);
    expect(second.random.cursor).toBe(2);
  });

  it('shuffles deterministically without mutating the input', () => {
    const values = [1, 2, 3, 4, 5];
    const first = shuffle(values, seed());
    const replay = shuffle(values, seed());
    expect(first).toEqual(replay);
    expect(values).toEqual([1, 2, 3, 4, 5]);
    expect(first.value).not.toEqual(values);
  });
});
