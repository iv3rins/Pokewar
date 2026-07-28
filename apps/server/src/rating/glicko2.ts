export interface GlickoRating {
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
}

export interface GlickoResult {
  readonly opponent: GlickoRating;
  readonly score: 0 | 0.5 | 1;
}

const SCALE = 173.7178;
const EPSILON = 0.000001;

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expected(mu: number, opponentMu: number, opponentPhi: number): number {
  return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

export function updateGlicko2(
  player: GlickoRating,
  results: readonly GlickoResult[],
  tau = 0.5,
): GlickoRating {
  if (results.length === 0) {
    return {
      ...player,
      deviation: SCALE * Math.sqrt((player.deviation / SCALE) ** 2 + player.volatility ** 2),
    };
  }
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.deviation / SCALE;
  const converted = results.map(({ opponent, score }) => ({
    mu: (opponent.rating - 1500) / SCALE,
    phi: opponent.deviation / SCALE,
    score,
  }));
  const variance =
    1 /
    converted.reduce((sum, result) => {
      const estimate = expected(mu, result.mu, result.phi);
      return sum + g(result.phi) ** 2 * estimate * (1 - estimate);
    }, 0);
  const delta =
    variance *
    converted.reduce(
      (sum, result) => sum + g(result.phi) * (result.score - expected(mu, result.mu, result.phi)),
      0,
    );
  const alpha = Math.log(player.volatility ** 2);
  const f = (x: number): number => {
    const exponential = Math.exp(x);
    const numerator = exponential * (delta ** 2 - phi ** 2 - variance - exponential);
    const denominator = 2 * (phi ** 2 + variance + exponential) ** 2;
    return numerator / denominator - (x - alpha) / tau ** 2;
  };

  let lower = alpha;
  let upper: number;
  if (delta ** 2 > phi ** 2 + variance) {
    upper = Math.log(delta ** 2 - phi ** 2 - variance);
  } else {
    let step = 1;
    while (f(alpha - step * tau) < 0) step += 1;
    upper = alpha - step * tau;
  }
  let lowerValue = f(lower);
  let upperValue = f(upper);
  while (Math.abs(upper - lower) > EPSILON) {
    const candidate = lower + ((lower - upper) * lowerValue) / (upperValue - lowerValue);
    const candidateValue = f(candidate);
    if (candidateValue * upperValue <= 0) {
      lower = upper;
      lowerValue = upperValue;
    } else {
      lowerValue /= 2;
    }
    upper = candidate;
    upperValue = candidateValue;
  }
  const volatility = Math.exp(lower / 2);
  const preDeviation = Math.sqrt(phi ** 2 + volatility ** 2);
  const nextDeviation = 1 / Math.sqrt(1 / preDeviation ** 2 + 1 / variance);
  const nextMu =
    mu +
    nextDeviation ** 2 *
      converted.reduce(
        (sum, result) => sum + g(result.phi) * (result.score - expected(mu, result.mu, result.phi)),
        0,
      );
  return {
    rating: 1500 + SCALE * nextMu,
    deviation: SCALE * nextDeviation,
    volatility,
  };
}

export type RatingTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'champion';
export function ratingTier(rating: number): RatingTier {
  if (rating < 1200) return 'bronze';
  if (rating < 1400) return 'silver';
  if (rating < 1600) return 'gold';
  if (rating < 1800) return 'platinum';
  if (rating < 2000) return 'diamond';
  return 'champion';
}
