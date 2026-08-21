// apps/frontend/client/src/lib/services/auth/__tests__/better_auth_client.test.ts
//
// C-426 AC-5: the client's Better Auth login + device handoff.
//
// Unit tests the fetch-based Better Auth client service against a mocked hub
// (fetch) and a mocked localStorage. The device handoff is exercised with a
// fake poll that returns a token after N attempts, verifying the same polling
// UX as the old Firebase flow but adopting a Better Auth session.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('@aikami/frontend/configs', () => ({
  getPublicMode: () => 'emulator',
}));

// ── localStorage mock ────────────────────────────────────────────────────
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// ── fetch mock ───────────────────────────────────────────────────────────
let fetchMock: ReturnType<typeof mock>;
const setFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  fetchMock = mock(impl);
  Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });
};

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

beforeEach(() => {
  storage.clear();
});

afterEach(() => {
  storage.clear();
});

describe('better_auth_client (AC-5)', () => {
  test('signInWithEmailAndPassword stores the session token', async () => {
    setFetch(async () =>
      jsonResponse({ token: 'abc', user: { id: 'u1' } }, 200, {
        'set-cookie': 'better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax',
      }),
    );

    const { signInWithEmailAndPassword } = await import('../better_auth_client.svelte.ts');
    const token = await signInWithEmailAndPassword({ email: 'a@b.c', password: 'pw' });
    expect(token).toBe('abc');
    expect(storage.get('better_auth.session_token')).toBe('abc');
  });

  test('getSession returns the user when a token is stored', async () => {
    storage.set('better_auth.session_token', 'abc');
    setFetch(async () =>
      jsonResponse({
        user: { id: 'u1', email: 'a@b.c', name: 'Alice', emailVerified: true },
        session: { id: 's1', expiresAt: '2026-01-01', token: 'abc' },
      }),
    );

    const { getSession } = await import('../better_auth_client.svelte.ts');
    const session = await getSession();
    expect(session?.user.email).toBe('a@b.c');
  });

  test('getSession returns undefined when signed out', async () => {
    setFetch(async () => jsonResponse(null));
    const { getSession } = await import('../better_auth_client.svelte.ts');
    expect(await getSession()).toBeUndefined();
  });

  test('startDeviceHandoff polls and adopts the Better Auth session', async () => {
    const opened: string[] = [];
    let polls = 0;
    const token = await (async () => {
      const { startDeviceHandoff } = await import('../better_auth_client.svelte.ts');
      return startDeviceHandoff({
        openUrl: async (url) => void opened.push(url),
        poll: async () => {
          polls += 1;
          return polls >= 3 ? 'handoff-token' : undefined;
        },
        intervalMs: 1,
        timeoutMs: 1000,
      });
    })();
    expect(token).toBe('handoff-token');
    expect(opened[0]).toContain('/link?code=');
    expect(polls).toBe(3);
    expect(storage.get('better_auth.session_token')).toBe('handoff-token');
  });

  test('startDeviceHandoff times out when the user never approves', async () => {
    const { startDeviceHandoff } = await import('../better_auth_client.svelte.ts');
    await expect(
      startDeviceHandoff({
        openUrl: async () => undefined,
        poll: async () => undefined,
        intervalMs: 1,
        timeoutMs: 20,
      }),
    ).rejects.toThrow();
  });
});
