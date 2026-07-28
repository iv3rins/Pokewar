import type { LoginAccountInput, RegisterAccountInput } from '@pokewar/protocol';
import type { GuestSession } from './guest.js';

async function authRequest(path: string, body?: unknown): Promise<GuestSession> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload = (await response.json()) as { readonly code?: unknown };
    throw new Error(typeof payload.code === 'string' ? payload.code : 'AUTH_FAILED');
  }
  return (await response.json()) as GuestSession;
}

export function registerAccount(input: RegisterAccountInput): Promise<GuestSession> {
  return authRequest('/api/auth/register', input);
}

export function loginAccount(input: LoginAccountInput): Promise<GuestSession> {
  return authRequest('/api/auth/login', input);
}
