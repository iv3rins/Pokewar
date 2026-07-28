import { describe, expect, it } from 'vitest';
import type { QueueEntry } from './model.js';
import { eligibleSizes, groupRatingCompatible, matchmakingRange } from './model.js';

const entry = (
  id: string,
  rating: number,
  requestedSize: 4 | 8 | 12 = 12,
  enqueuedAt = 0,
): QueueEntry => ({
  identity: { id, kind: 'account', nickname: id, displayName: `${id}#TEST` },
  mode: 'quick',
  requestedSize,
  allowFallback: true,
  rating,
  enqueuedAt,
});

describe('multiplayer matchmaking rules', () => {
  it('expands rating range by 50 every ten seconds and caps at 500', () => {
    expect(
      [0, 9_999, 10_000, 80_000].map((now) => matchmakingRange(entry('a', 1500), now)),
    ).toEqual([100, 100, 150, 500]);
  });
  it('uses stepwise 12 to 8 to 4 fallback after sixty-second steps', () => {
    expect(eligibleSizes(entry('a', 1500), 59_999)).toEqual([12]);
    expect(eligibleSizes(entry('a', 1500), 60_000)).toEqual([12, 8]);
    expect(eligibleSizes(entry('a', 1500), 120_000)).toEqual([12, 8, 4]);
    expect(eligibleSizes({ ...entry('b', 1500, 8), allowFallback: false }, 999_999)).toEqual([8]);
  });
  it('revalidates every player against each incremental group average', () => {
    expect(groupRatingCompatible([entry('a', 1400), entry('b', 1500)], 0)).toBe(true);
    expect(groupRatingCompatible([entry('a', 1400), entry('b', 1500), entry('c', 1700)], 0)).toBe(
      false,
    );
  });
});
