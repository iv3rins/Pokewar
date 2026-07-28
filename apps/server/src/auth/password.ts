import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
const KEY_LENGTH = 32;
const DEFAULT_COST = 16_384;

export async function hashPassword(password: string, cost = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N: cost, r: 8, p: 1 });
  return `scrypt$v1$${String(cost)}$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, version, costText, blockText, parallelText, saltText, keyText] =
    encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    version !== 'v1' ||
    !costText ||
    !blockText ||
    !parallelText ||
    !saltText ||
    !keyText
  )
    return false;
  const cost = Number(costText);
  const block = Number(blockText);
  const parallel = Number(parallelText);
  if (!Number.isInteger(cost) || !Number.isInteger(block) || !Number.isInteger(parallel))
    return false;
  const expected = Buffer.from(keyText, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length, {
    N: cost,
    r: block,
    p: parallel,
  });
  return timingSafeEqual(actual, expected);
}
