// packages/backend/auth/tests/better_auth.test.ts
//
// C-426 AC-2: Better Auth sign-in works end-to-end against the D1 schema.
//
// Runs against an in-memory libsql database (the same SQLite engine D1 uses)
// with the generated D1 migration applied, then drives Better Auth's
// email/password flow (Open Question 1 resolved: keep email/password) through
// its real HTTP handler — the same path the hub mounts at `/api/auth/*`.
// Google OAuth is configured but not exercised here (it needs a live OAuth
// client); the email/password path proves the adapter, schema, session-cookie
// and get-session machinery work against D1.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { createBetterAuth } from '../src/lib/better_auth.ts';

const BASE_URL = 'http://localhost:5173';

let client: Client;
let auth: ReturnType<typeof createBetterAuth>;

const applyD1Migrations = async (): Promise<void> => {
  const dir = join(import.meta.dir, '..', '..', 'database', 'drizzle-d1');
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

const post = (path: string, body: unknown, cookie?: string, origin?: string) =>
  new Request(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie: string) =>
  new Request(`${BASE_URL}${path}`, { headers: { cookie } });

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  await applyD1Migrations();
  const db = drizzle(client);
  auth = createBetterAuth(db, {
    baseURL: BASE_URL,
    secret: 'test-secret-that-is-long-enough-for-better-auth',
  });
});

afterAll(async () => {
  await client.close();
});

describe('Better Auth against D1 (AC-2)', () => {
  test('email/password sign-up creates a user row and a session in D1', async () => {
    const res = await auth.handler(
      post('/api/auth/sign-up/email', {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'password123',
      }),
    );
    expect(res.status).toBe(200);

    // A user row must now exist in the D1 `user` table.
    const rows = await client.execute(
      "SELECT id, email FROM user WHERE email = 'alice@example.com'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].email).toBe('alice@example.com');
  });

  test('email/password sign-in sets a session cookie and get-session recognizes it', async () => {
    // Self-contained: create the user before signing in (don't depend on the
    // sign-up test having run first).
    await auth.handler(
      post('/api/auth/sign-up/email', {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'password123',
      }),
    );
    const signInRes = await auth.handler(
      post('/api/auth/sign-in/email', {
        email: 'alice@example.com',
        password: 'password123',
      }),
    );
    expect(signInRes.status).toBe(200);

    const setCookie = signInRes.headers.get('set-cookie');
    expect(setCookie).toContain('better-auth.session_token=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    const cookie = setCookie?.split(';')[0] ?? '';

    // A session row must exist in the D1 `session` table.
    const sessionRows = await client.execute('SELECT token, user_id FROM session');
    expect(sessionRows.rows.length).toBeGreaterThan(0);

    // The hub's protected-route check (get-session) recognizes the cookie.
    const getRes = await auth.handler(get('/api/auth/get-session', cookie));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { user?: { email?: string } };
    expect(body.user?.email).toBe('alice@example.com');
  });

  test('a wrong password is rejected (401)', async () => {
    const res = await auth.handler(
      post('/api/auth/sign-in/email', {
        email: 'alice@example.com',
        password: 'wrong-password',
      }),
    );
    expect(res.status).toBe(401);
  });

  test('a duplicate email sign-up is rejected', async () => {
    const res = await auth.handler(
      post('/api/auth/sign-up/email', {
        name: 'Alice2',
        email: 'alice@example.com',
        password: 'password123',
      }),
    );
    expect(res.status).toBe(422);
  });
});

// The Tauri desktop client cannot OAuth-popup, so it starts the device-
// authorization flow from inside its webview. That POST carries the webview's
// own origin, which is not a *.bearlysleeping.com origin — until it was added
// to trustedOrigins, Better Auth answered with a bare "Invalid origin" and
// desktop Google sign-in was impossible in staging and production.
//
// 🔴 This asserts the resolved config, NOT the handler, and that is deliberate:
// Better Auth force-disables the origin check whenever it detects a test
// environment (create-context.mjs → `skipOriginCheck: … isTest() ? true`, and
// `isTest()` is `nodeENV === 'test'`, captured at import). `bun test` sets
// NODE_ENV=test, so ANY assertion driving auth.handler() with an Origin header
// passes for every origin — including hostile ones — and proves nothing. The
// real check runs only against a deployed hub.
describe('Tauri webview origins are trusted (C-426 AC-5)', () => {
  const secret = 'test-secret-that-is-long-enough-for-better-auth';
  const tauriOrigins = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];

  test('production config keeps the subdomain wildcard AND trusts the webview', () => {
    // Matches the deployed hub (better_auth.ts → deriveCookieDomain).
    const prodAuth = createBetterAuth(drizzle(client), {
      baseURL: 'https://hub.bearlysleeping.com',
      secret,
      cookieDomain: 'bearlysleeping.com',
    });

    expect(prodAuth.options.trustedOrigins).toEqual([
      'https://*.bearlysleeping.com',
      ...tauriOrigins,
    ]);
  });

  test('explicit trustedOrigins are preserved, not replaced', () => {
    const customAuth = createBetterAuth(drizzle(client), {
      baseURL: 'https://hub.example.com',
      secret,
      trustedOrigins: ['https://app.example.com'],
    });

    expect(customAuth.options.trustedOrigins).toEqual(['https://app.example.com', ...tauriOrigins]);
  });
});
