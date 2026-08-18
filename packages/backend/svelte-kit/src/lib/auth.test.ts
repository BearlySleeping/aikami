// packages/backend/svelte-kit/src/lib/auth.test.ts
//
// Unit tests for getUserSessionFromCookies / verifySessionCookieWithFallback.
// Verifies that strict revocation failures (auth/session-cookie-revoked,
// auth/id-token-revoked) are rethrown WITHOUT the signature-only fallback,
// while non-authentication failures (e.g. revocation-permission errors)
// still fall back so login keeps working.
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

let verifySessionCookieImpl: (
  cookie: string,
  checkRevoked?: boolean,
) => Promise<Record<string, unknown>>;

mock.module('@aikami/backend/utils/auth', () => ({
  verifyIdToken: mock(async () => ({})),
  verifySessionCookie: mock(async (cookie: string, checkRevoked?: boolean) =>
    verifySessionCookieImpl(cookie, checkRevoked),
  ),
}));

// auth.ts imports toUserSessionDataFromToken via the '.ts'-suffixed
// specifier — mock that specifier too so the same module shape is used.
mock.module('@aikami/backend/utils/auth.ts', () => ({
  verifyIdToken: mock(async () => ({})),
  verifySessionCookie: mock(async (cookie: string, checkRevoked?: boolean) =>
    verifySessionCookieImpl(cookie, checkRevoked),
  ),
  toUserSessionDataFromToken: mock((token: Record<string, unknown>) => ({
    id: token.uid ?? 'user-1',
    userRole: 'player',
  })),
}));

mock.module('@aikami/backend/svelte-kit/cookies.ts', () => ({
  getCookie: mock((_name: string, _options: unknown) => 'session-cookie-value'),
  deleteCookie: mock(() => {}),
}));

mock.module('$logger', () => ({
  logger: {
    debug: mock(() => {}),
    log: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

const { getUserSessionFromCookies } = await import('./auth.ts');

const { verifySessionCookie } = await import('@aikami/backend/utils/auth');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getUserSessionFromCookies', () => {
  beforeEach(() => {
    (verifySessionCookie as ReturnType<typeof mock>).mockClear?.();
    verifySessionCookieImpl = async (_cookie: string, checkRevoked?: boolean) => {
      if (checkRevoked) {
        const err = new Error('revoked') as Error & { code?: string };
        err.code = 'auth/session-cookie-revoked';
        throw err;
      }
      return { uid: 'user-1', exp: 9999999999 };
    };
  });

  const options = {
    cookies: {} as never,
    url: new URL('http://localhost'),
    request: new Request('http://localhost'),
  };

  test('revoked session cookie does NOT use the loose fallback', async () => {
    const [userSession] = await getUserSessionFromCookies(options);

    // Revocation is a definitive auth failure — the session is rejected
    // (the cookie is deleted) and verification must not be retried with
    // checkRevoked=false.
    expect(userSession).toBeUndefined();

    const calls = (verifySessionCookie as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0]?.[1]).toBe(true); // checkRevoked must stay true
  });

  test('id-token-revoked error does NOT use the loose fallback', async () => {
    verifySessionCookieImpl = async (_cookie: string, checkRevoked?: boolean) => {
      if (checkRevoked) {
        const err = new Error('revoked') as Error & { code?: string };
        err.code = 'auth/id-token-revoked';
        throw err;
      }
      return { uid: 'user-1', exp: 9999999999 };
    };

    const [userSession, shouldReAuth] = await getUserSessionFromCookies(options);
    expect(userSession).toBeUndefined();
    expect(shouldReAuth).toBe(true);

    const calls = (verifySessionCookie as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0]?.[1]).toBe(true);
  });

  test('non-authentication failures still use the loose fallback', async () => {
    // Simulate a service account lacking the accounts:lookup permission —
    // the Admin SDK wraps it as auth/internal-error. Login must keep working
    // via signature-only verification.
    verifySessionCookieImpl = async (_cookie: string, checkRevoked?: boolean) => {
      if (checkRevoked) {
        const err = new Error('internal') as Error & { code?: string };
        err.code = 'auth/internal-error';
        throw err;
      }
      return { uid: 'user-1', exp: 9999999999 };
    };

    const [userSession] = await getUserSessionFromCookies(options);
    expect(userSession).toBeDefined();

    const calls = (verifySessionCookie as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0]?.[1]).toBe(true);
    expect(calls[1]?.[1]).toBe(false); // loose fallback used
  });
});
