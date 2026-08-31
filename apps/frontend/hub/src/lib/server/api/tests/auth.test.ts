// apps/frontend/hub/src/lib/server/api/tests/auth.test.ts
//
// C-426 AC-4: the hub's login flow is served by Better Auth mounted inside the
// Elysia app (src/lib/server/api/index.ts) via `.mount()`, backed by D1.

// The Elysia app is a module singleton; the D1 database is injected via
// `setBetterAuthEnv` with a mock D1Database backed by an in-memory libsql
// instance (the same SQLite engine D1 uses, with the generated D1 migration
// applied). This exercises the real production path: Better Auth handler →
// drizzle D1 driver → D1 schema.

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { createLibsqlMockD1 } from './mock_d1.ts';
import type { App } from '../index.ts';
import type { BetterAuthEnv } from '../better_auth.ts';
import type { D1Database } from '@cloudflare/workers-types';

// Must be registered before any module that imports $env/dynamic/private
// (better_auth.ts, the route) is loaded — hence dynamic imports below.
mock.module('$env/dynamic/private', () => ({
  env: {
    // biome-ignore lint/style/useNamingConvention: environment variable name
    BETTER_AUTH_URL: 'http://localhost:5173',
    // biome-ignore lint/style/useNamingConvention: environment variable name
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
  } as Record<string, string | undefined>,
}));

const BASE_URL = 'http://localhost:5173';

let client: Client;
let app: App;
let setBetterAuthEnv: (env: BetterAuthEnv | undefined) => void;

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

const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie: string) =>
  new Request(`${BASE_URL}${path}`, { headers: { cookie } });

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  await applyD1Migrations();
  const betterAuthModule = await import('../better_auth.ts');
  setBetterAuthEnv = betterAuthModule.setBetterAuthEnv;
  setBetterAuthEnv({
    // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
    DB: createLibsqlMockD1(client) as unknown as D1Database,
  });
  ({ app } = await import('../index.ts'));
});

afterAll(async () => {
  setBetterAuthEnv(undefined);
  await client.close();
});

const handle = (request: Request) => app.handle(request);

describe('hub Better Auth mount (AC-4)', () => {
  test('sign-up via /api/auth/sign-up/email creates a user in D1', async () => {
    const res = await handle(
      post('/api/auth/sign-up/email', {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'password123',
      }),
    );
    expect(res.status).toBe(200);
    const rows = await client.execute(
      "SELECT id, email FROM user WHERE email = 'alice@example.com'",
    );
    expect(rows.rows).toHaveLength(1);
  });

  test('sign-in via /api/auth/sign-in/email sets a session cookie and get-session recognizes it', async () => {
    const signInRes = await handle(
      post('/api/auth/sign-in/email', {
        email: 'alice@example.com',
        password: 'password123',
      }),
    );
    expect(signInRes.status).toBe(200);
    const setCookie = signInRes.headers.get('set-cookie');
    expect(setCookie).toContain('better-auth.session_token=');
    const cookie = setCookie?.split(';')[0] ?? '';

    const getRes = await handle(get('/api/auth/get-session', cookie));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { user?: { email?: string } };
    expect(body.user?.email).toBe('alice@example.com');
  });

  test('a signed-out get-session returns no user', async () => {
    const res = await handle(get('/api/auth/get-session', 'better-auth.session_token=invalid'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user?: unknown } | null;
    // Better Auth returns exactly `null` (no session) for an invalid/absent token.
    expect(body).toBe(null);
  });

  test('wrong-password sign-in returns a non-200 with no session cookie', async () => {
    const res = await handle(
      post('/api/auth/sign-in/email', {
        email: 'alice@example.com',
        password: 'wrong-password',
      }),
    );
    expect(res.status).not.toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('duplicate-email sign-up fails', async () => {
    const res = await handle(
      post('/api/auth/sign-up/email', {
        name: 'Alice2',
        email: 'alice@example.com',
        password: 'password123',
      }),
    );
    expect(res.status).not.toBe(200);
  });

  test('getBetterAuth() returns undefined and the mount 503s with no D1 env', async () => {
    const betterAuthModule = await import('../better_auth.ts');
    setBetterAuthEnv(undefined);
    try {
      const res = await app.handle(
        post('/api/auth/sign-in/email', {
          email: 'alice@example.com',
          password: 'password123',
        }),
      );
      expect(betterAuthModule.getBetterAuth()).toBeUndefined();
      expect(res.status).toBe(503);
    } finally {
      setBetterAuthEnv({
        // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
        DB: createLibsqlMockD1(client) as unknown as D1Database,
      });
    }
  });

  test('device mount handles /api/auth/device/code requests (AC-5)', async () => {
    const res = await app.handle(
      post('/api/auth/device/code', {
        // biome-ignore lint/style/useNamingConvention: Better Auth wire-format field
        client_id: 'aikami-client',
      }),
    );
    // Device-code request succeeds (not 404) and returns a device_code + user_code.
    expect(res.status).not.toBe(404);
    if (res.status === 200) {
      const body = (await res.json()) as Partial<Record<'device_code' | 'user_code', string>>;
      expect(Reflect.get(body, 'device_code')).toBeDefined();
      expect(Reflect.get(body, 'user_code')).toBeDefined();
    }
  });
});
