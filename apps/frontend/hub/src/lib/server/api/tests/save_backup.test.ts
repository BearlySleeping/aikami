// apps/frontend/hub/src/lib/server/api/tests/save_backup.test.ts
//
// C-426 AC-6/AC-7: Turso save backup/restore to R2, gated by a verified
// Better Auth session.

// biome-ignore-all lint/style/useNamingConvention: Cloudflare D1 binding name is SCREAMING_SNAKE_CASE
//
// Uses the same mock D1Database (libsql-backed) as auth.test.ts plus an
// in-memory mock R2 bucket. Verifies the session guard (401 without a
// session), the account_backups metadata row written only after the R2 PUT,
// and ownership-checked restore.

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
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
      Promise.all(statements.map((s) => client.execute({ sql: s.sql, args: s.params ?? [] }))),
  };
};

// ── Mock R2 bucket (in-memory) ──────────────────────────────────────────
const createMockR2 = () => {
  const store = new Map<string, Uint8Array>();
  let failPut = false;
  return {
    store,
    failPut: (v: boolean) => {
      failPut = v;
    },
    put: async (key: string, value: ArrayBuffer | Uint8Array) => {
      if (failPut) {
        throw new Error('R2 put failed');
      }
      store.set(key, new Uint8Array(value as ArrayBuffer));
      return { key };
    },
    get: async (key: string) => {
      const bytes = store.get(key);
      if (!bytes) {
        return null;
      }
      return { body: new Blob([bytes]).stream() };
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
};

let client: Client;
let setBetterAuthEnv: (
  env:
    | {
        DB: unknown;
      }
    | undefined,
) => void;
let setSaveBackupEnv: (env: unknown) => void;
let app: Awaited<ReturnType<typeof import('../index.ts')>>['app'];
let r2: ReturnType<typeof createMockR2>;

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

/** POST raw bytes to a path (for the backup upload). */
const postBytes = (path: string, bytes: Uint8Array, cookie?: string) =>
  new Request(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: bytes,
  });

const get = (path: string, cookie?: string) =>
  new Request(`${BASE_URL}${path}`, { headers: cookie ? { cookie } : {} });

/** Sign up + sign in, returning the session cookie. */
const signInCookie = async (email: string): Promise<string> => {
  const handleAuth = (request: Request) => app.handle(request);
  await handleAuth(
    post('/api/auth/sign-up/email', {
      name: 'Alice',
      email,
      password: 'password123',
    }),
  );
  const res = await handleAuth(
    post('/api/auth/sign-in/email', {
      email,
      password: 'password123',
    }),
  );
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
};

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  await applyD1Migrations();
  const betterAuthModule = await import('../better_auth.ts');
  setBetterAuthEnv = betterAuthModule.setBetterAuthEnv;
  setBetterAuthEnv({ DB: createMockD1(client) });
  const saveBackupModule = await import('../save_backup.ts');
  setSaveBackupEnv = saveBackupModule.setSaveBackupEnv;
  r2 = createMockR2();
  setSaveBackupEnv({ DB: createMockD1(client), SAVES_BUCKET: r2 });
  ({ app } = await import('../index.ts'));
});

afterAll(async () => {
  setBetterAuthEnv(undefined);
  setSaveBackupEnv(undefined);
  await client.close();
});

describe('save backup/restore (AC-6/AC-7)', () => {
  test('backup without a session is rejected 401 and issues no R2 write', async () => {
    const res = await app.handle(
      postBytes('/api/saves/backup?filename=save.db', new Uint8Array([1, 2, 3])),
    );
    expect(res.status).toBe(401);
    expect(r2.store.size).toBe(0);
  });

  test('backup with a session uploads to R2 and records an account_backups row', async () => {
    const cookie = await signInCookie('alice@example.com');
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const res = await app.handle(postBytes('/api/saves/backup?filename=save.db', bytes, cookie));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { backupId?: string; r2Key?: string };
    expect(body.backupId).toBeDefined();
    expect(body.r2Key).toContain('saves/');

    // The metadata row exists and the R2 object was written.
    const rows = await client.execute(
      'SELECT id, r2_key, size_bytes, checksum_sha256 FROM account_backups',
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].size_bytes).toBe(5);
    // The SHA-256 checksum is persisted, not an empty string.
    expect(rows.rows[0].checksum_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r2.store.size).toBe(1);
  });

  test('a failed R2 PUT returns a failure and records no account_backups row', async () => {
    const cookie = await signInCookie('dave@example.com');
    const before = await client.execute('SELECT id FROM account_backups');
    const beforeCount = before.rows.length;
    const beforeR2 = r2.store.size;
    r2.failPut(true);
    try {
      const res = await app.handle(
        postBytes('/api/saves/backup?filename=save.db', new Uint8Array([9, 9, 9]), cookie),
      );
      expect(res.status).not.toBe(201);
      // No new metadata row and no new R2 object were created.
      const after = await client.execute('SELECT id FROM account_backups');
      expect(after.rows.length).toBe(beforeCount);
      expect(r2.store.size).toBe(beforeR2);
    } finally {
      r2.failPut(false);
    }
  });

  test('list returns the signed-in user backups', async () => {
    const cookie = await signInCookie('bob@example.com');
    const res = await app.handle(get('/api/saves', cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    // Bob has no backups yet.
    expect(body).toHaveLength(0);
  });

  test('restore returns the bytes for an owned backup', async () => {
    // Self-contained: create the backup as Alice within this test.
    const cookie = await signInCookie('alice@example.com');
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const createRes = await app.handle(
      postBytes('/api/saves/backup?filename=save.db', bytes, cookie),
    );
    expect(createRes.status).toBe(201);
    const { backupId } = (await createRes.json()) as { backupId: string };

    const res = await app.handle(get(`/api/saves/${backupId}`, cookie));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(String.fromCharCode(1, 2, 3, 4, 5));
  });

  test('restore of another user backup is rejected 404', async () => {
    // Self-contained: create the backup as Alice, then authenticate as Carol.
    const aliceCookie = await signInCookie('alice@example.com');
    const createRes = await app.handle(
      postBytes('/api/saves/backup?filename=save.db', new Uint8Array([1, 2, 3]), aliceCookie),
    );
    expect(createRes.status).toBe(201);
    const { backupId } = (await createRes.json()) as { backupId: string };

    const carolCookie = await signInCookie('carol@example.com');
    const res = await app.handle(get(`/api/saves/${backupId}`, carolCookie));
    expect(res.status).toBe(404);
  });
});
