export interface RandomState {
  readonly seed: string;
  readonly cursor: number;
}

export interface RandomValue<T> {
  readonly value: T;
  readonly random: RandomState;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashSeed(seed: string, cursor: number): number {
  let hash = FNV_OFFSET;
  const input = `${seed}:${String(cursor)}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function randomInt(random: RandomState, maxExclusive: number): RandomValue<number> {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('RANDOM_MAX_MUST_BE_POSITIVE_INTEGER');
  }
  return {
    value: hashSeed(random.seed, random.cursor) % maxExclusive,
    random: { ...random, cursor: random.cursor + 1 },
  };
}

export function shuffle<T>(values: readonly T[], random: RandomState): RandomValue<readonly T[]> {
  const shuffled = [...values];
  let nextRandom = random;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const draw = randomInt(nextRandom, index + 1);
    nextRandom = draw.random;
    const other = draw.value;
    const currentValue = shuffled[index];
    const otherValue = shuffled[other];
    if (currentValue === undefined || otherValue === undefined)
      throw new Error('SHUFFLE_INDEX_ERROR');
    shuffled[index] = otherValue;
    shuffled[other] = currentValue;
  }
  return { value: shuffled, random: nextRandom };
}
