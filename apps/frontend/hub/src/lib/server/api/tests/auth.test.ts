// apps/frontend/hub/src/lib/server/api/tests/auth.test.ts
//
// C-426 AC-4: the hub's login flow is served by Better Auth mounted in the
// dedicated SvelteKit catch-all route (routes/api/auth/[...auth]/+server.ts),
// backed by D1.

// biome-ignore-all lint/style/useNamingConvention: Cloudflare D1 binding name is SCREAMING_SNAKE_CASE
//
// The route's `fallback` handler is a module singleton; the D1 database is
// injected per-test via `platform.env.DB` with a mock D1Database backed by an
// in-memory libsql instance (the same SQLite engine D1 uses, with the generated
// D1 migration applied). This exercises the real production path: Better Auth
// handler → drizzle D1 driver → D1 schema.

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';

// Must be registered before any module that imports $env/dynamic/private
// (better_auth.ts, the route) is loaded — hence dynamic imports below.
mock.module('$env/dynamic/private', () => ({
  env: {
    // biome-ignore lint/style/useNamingConvention: env key is a SCREAMING_SNAKE_CASE literal
    BETTER_AUTH_URL: 'http://localhost:5173',
    // biome-ignore lint/style/useNamingConvention: env key is a SCREAMING_SNAKE_CASE literal
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
  } as Record<string, string | undefined>,
}));

const BASE_URL = 'http://localhost:5173';

// ── Mock D1Database backed by libsql ────────────────────────────────────
// The drizzle-orm/d1 driver calls prepare(sql).bind(...).all()/.first()/.run()
// and exec(sql). We map those onto the libsql client's execute().

const createMockD1 = (dbClient: Client): unknown => {
  const prepareStatement = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      all: async () => {
        const res = await dbClient.execute({ sql, args: params });
        return { results: res.rows };
      },
      first: async () => {
        const res = await dbClient.execute({ sql, args: params });
        return res.rows[0] ?? null;
      },
      run: async () => {
        const res = await dbClient.execute({ sql, args: params });
        return { meta: res.meta };
      },
      raw: async () => {
        const res = await dbClient.execute({ sql, args: params });
        return res.rows;
      },
    }),
  });
  return {
    prepare: prepareStatement,
    exec: async (sql: string) => {
      await dbClient.execute(sql);
    },
    batch: async (statements: Array<{ sql: string; params?: unknown[] }>) =>
      Promise.all(statements.map((s) => dbClient.execute({ sql: s.sql, args: s.params ?? [] }))),
  };
};

let client: Client;
let fallback: (v: {
  request: Request;
  platform?: { env: { DB: unknown } };
}) => Response | Promise<Response>;

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
  const route = await import('../../../../routes/api/auth/[...auth]/+server.ts');
  fallback = route.fallback;
});

afterAll(async () => {
  await client.close();
});

const handle = (request: Request) =>
  fallback({ request, platform: { env: { DB: createMockD1(client) } } });

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
    // Better Auth returns `null` (no session) for an invalid/absent token.
    expect(body === null || body.user === undefined).toBe(true);
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

  test('getBetterAuth() returns undefined and the route 503s with no D1 env', async () => {
    const betterAuthModule = await import('../better_auth.ts');
    const res = await fallback({
      request: post('/api/auth/sign-in/email', {
        email: 'alice@example.com',
        password: 'password123',
      }),
      platform: undefined,
    });
    expect(betterAuthModule.getBetterAuth()).toBeUndefined();
    expect(res.status).toBe(503);
  });
});
