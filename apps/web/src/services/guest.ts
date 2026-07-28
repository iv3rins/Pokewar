export interface GuestSession {
  readonly identity: {
    readonly displayName: string;
    readonly kind: 'guest' | 'account';
  };
}

async function sessionRequest(input: RequestInfo, init?: RequestInit): Promise<GuestSession> {
  const response = await fetch(input, { ...init, credentials: 'include' });
  const body = (await response.json()) as unknown;
  if (!response.ok)
    throw new Error(response.status === 401 ? 'IDENTITY_REQUIRED' : 'SESSION_FAILED');
  return body as GuestSession;
}

export function getGuestSession(): Promise<GuestSession> {
  return sessionRequest('/api/guest/session');
}

let pendingGuestSession: Promise<GuestSession> | null = null;

export function ensureGuestSession(): Promise<GuestSession> {
  pendingGuestSession ??= sessionRequest('/api/guest/session', { method: 'POST' }).finally(() => {
    pendingGuestSession = null;
  });
  return pendingGuestSession;
}
