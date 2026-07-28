import { composePublicName, NAME_NOUNS, NAME_PREFIXES } from '@pokewar/protocol';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'pokewar_guest';
export const GUEST_IDENTITY_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface GuestIdentity {
  readonly id: string;
  readonly kind: 'guest' | 'account' | 'bot';
  readonly nickname: string;
  readonly displayName: string;
}

export interface GuestIdentityStore {
  get(id: string): Promise<GuestIdentity | undefined>;
  save(identity: GuestIdentity): Promise<void>;
}

export class MemoryGuestIdentityStore implements GuestIdentityStore {
  readonly #identities = new Map<string, GuestIdentity>();

  get(id: string): Promise<GuestIdentity | undefined> {
    return Promise.resolve(this.#identities.get(id));
  }

  save(identity: GuestIdentity): Promise<void> {
    this.#identities.set(identity.id, identity);
    return Promise.resolve();
  }
}

function signature(id: string, secret: string): string {
  return createHmac('sha256', secret).update(id).digest('base64url');
}

function shortId(id: string): string {
  return createHmac('sha256', 'pokewar-display-id')
    .update(id)
    .digest('base64url')
    .slice(0, 4)
    .toUpperCase();
}

export interface GuestIdentityInput {
  readonly id?: string;
  readonly prefixIndex?: number;
  readonly nounIndex?: number;
}

export function createGuestIdentity(input: GuestIdentityInput = {}): GuestIdentity {
  const id = input.id ?? randomBytes(18).toString('base64url');
  const prefix = NAME_PREFIXES[input.prefixIndex ?? randomInt(NAME_PREFIXES.length)];
  const noun = NAME_NOUNS[input.nounIndex ?? randomInt(NAME_NOUNS.length)];
  if (!prefix || !noun) throw new Error('GUEST_NAME_INDEX_OUT_OF_RANGE');
  const nickname = composePublicName(prefix, noun);
  return { id, kind: 'guest', nickname, displayName: `${nickname}#${shortId(id)}` };
}

export function createBotIdentity(id: string): GuestIdentity {
  const prefixIndex = randomInt(NAME_PREFIXES.length);
  const nounIndex = randomInt(NAME_NOUNS.length);
  const prefix = NAME_PREFIXES[prefixIndex];
  const noun = NAME_NOUNS[nounIndex];
  if (!prefix || !noun) throw new Error('BOT_NAME_INDEX_OUT_OF_RANGE');
  const nickname = composePublicName(prefix, noun);
  return { id, kind: 'bot', nickname, displayName: `${nickname} [机器人]` };
}

export function serializeGuestCookie(identityId: string, secret: string, secure: boolean): string {
  const value = `${identityId}.${signature(identityId, secret)}`;
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(GUEST_IDENTITY_TTL_SECONDS)}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator <= 0) return [];
      return [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]];
    }),
  );
}

export function verifyGuestCookie(cookieHeader: string | undefined, secret: string): string | null {
  const value = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const id = value.slice(0, separator);
  const received = value.slice(separator + 1);
  const expected = signature(id, secret);
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return null;
  return timingSafeEqual(receivedBuffer, expectedBuffer) ? id : null;
}
