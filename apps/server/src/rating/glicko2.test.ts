import { describe, expect, it } from 'vitest';
import { ratingTier, updateGlicko2 } from './glicko2.js';

describe('Glicko-2', () => {
  it('matches the official worked example', () => {
    const updated = updateGlicko2(
      { rating: 1500, deviation: 200, volatility: 0.06 },
      [
        { opponent: { rating: 1400, deviation: 30, volatility: 0.06 }, score: 1 },
        { opponent: { rating: 1550, deviation: 100, volatility: 0.06 }, score: 0 },
        { opponent: { rating: 1700, deviation: 300, volatility: 0.06 }, score: 0 },
      ],
      0.5,
    );
    expect(updated.rating).toBeCloseTo(1464.06, 1);
    expect(updated.deviation).toBeCloseTo(151.52, 1);
    expect(updated.volatility).toBeCloseTo(0.059996, 5);
  });

  it('maps exact rating boundaries to six tiers', () => {
    expect([1199, 1200, 1400, 1600, 1800, 2000].map(ratingTier)).toEqual([
      'bronze',
      'silver',
      'gold',
      'platinum',
      'diamond',
      'champion',
    ]);
  });
});
