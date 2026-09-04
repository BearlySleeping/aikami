// apps/frontend/hub/src/lib/server/api/tests/account_sessions.test.ts
//
// C-464 AC-10: Revoke-all-sessions through Better Auth's session API.

// biome-ignore-all lint/style/useNamingConvention: Cloudflare D1 binding name is SCREAMING_SNAKE_CASE

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

type MockBetterAuth = {
  api: {
    getSession(options: { headers: Headers }): Promise<{ user: { id: string } } | undefined>;
    listSessions(options: { headers: Headers }): Promise<Array<{ token: string }>>;
    revokeSession(options: { headers: Headers; body: { token: string } }): Promise<void>;
  };
};

let betterAuthMock: MockBetterAuth | undefined;

// Mock better_auth before importing the module under test
mock.module('../better_auth.ts', () => ({
  getBetterAuth: () => betterAuthMock,
}));

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';

mock.module('$env/dynamic/private', () => ({
  env: {
    BETTER_AUTH_URL: 'http://localhost:5173',
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
  } as Record<string, string | undefined>,
}));

const BASE_URL = 'http://localhost:5173';

let client: Client;

const applyD1Migrations = async (): Promise<void> => {
  const dir = join(
    import.meta.dir,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages',
    'backend',
    'database',
    'drizzle-d1',
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) {
        await client.execute(trimmed);
      }
    }
  }
};

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  await applyD1Migrations();
});

beforeEach(() => {
  betterAuthMock = undefined;
});

afterAll(() => {
  client.close();
});

describe('POST /api/account/sessions/revoke-all — AC-10', () => {
  test('returns 503 when Better Auth is not configured (no env injected)', async () => {
    const { handleRevokeAllSessions } = await import('../account_sessions.ts');

    const request = new Request(`${BASE_URL}/api/account/sessions/revoke-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const response = await handleRevokeAllSessions(request);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe('auth_unconfigured');
  });

  test('returns an incomplete failure after attempting every session when one revocation fails', async () => {
    const revokeSession = mock(async (options: { body: { token: string } }) => {
      if (options.body.token === 'failed-token') {
        throw new Error('revocation failed');
      }
    });
    betterAuthMock = {
      api: {
        getSession: mock(async () => ({ user: { id: 'test-user' } })),
        listSessions: mock(async () => [
          { token: 'first-token' },
          { token: 'failed-token' },
          { token: 'last-token' },
        ]),
        revokeSession,
      },
    };

    const { handleRevokeAllSessions } = await import('../account_sessions.ts');
    const request = new Request(`${BASE_URL}/api/account/sessions/revoke-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const response = await handleRevokeAllSessions(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'incomplete', revoked: 2, failed: 1 });
    expect(revokeSession).toHaveBeenCalledTimes(3);
  });
});
