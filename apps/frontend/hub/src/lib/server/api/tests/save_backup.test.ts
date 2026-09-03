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

const createMockD1 = (dbClient: Client) => {
  let failNextAccountBackupDelete = false;
  const prepareStatement = (sql: string) => ({
    bind: (...params: never[]) => ({
      all: async () => {
        const res = await dbClient.execute({ sql, args: params as never[] });
        return { results: res.rows };
      },
      first: async () => {
        const res = await dbClient.execute({ sql, args: params as never[] });
        return res.rows[0] ?? null;
      },
      run: async () => {
        if (failNextAccountBackupDelete && /delete from [`"]?account_backups/i.test(sql)) {
          failNextAccountBackupDelete = false;
          throw new Error('D1 account_backups delete failed');
        }
        const _res = await dbClient.execute({ sql, args: params as never[] });
        return { meta: { last_row_id: 0, changes: 0 } };
      },
      raw: async () => {
        const res = await dbClient.execute({ sql, args: params as never[] });
        return res.rows;
      },
    }),
  });
  return {
    binding: {
      prepare: prepareStatement,
      exec: async (sql: string) => {
        await dbClient.execute(sql);
      },
      batch: async (statements: Array<{ sql: string; params?: unknown[] }>) =>
        Promise.all(
          statements.map((statement) =>
            dbClient.execute({ sql: statement.sql, args: (statement.params ?? []) as never[] }),
          ),
        ),
    },
    failNextAccountBackupDelete: () => {
      failNextAccountBackupDelete = true;
    },
  };
};

// ── Mock R2 bucket (in-memory) ──────────────────────────────────────────
const createMockR2 = () => {
  const store = new Map<string, Uint8Array>();
  const deleteCalls: string[] = [];
  let failPut = false;
  return {
    store,
    deleteCalls,
    failPut: (v: boolean) => {
      failPut = v;
    },
    put: async (key: string, value: ArrayBuffer | Uint8Array<ArrayBufferLike>) => {
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
      return { body: new Blob([bytes as BlobPart]).stream() };
    },
    delete: async (key: string) => {
      deleteCalls.push(key);
      store.delete(key);
    },
  };
};

let client: Client;
type BetterAuthEnv = {
  DB: import('@cloudflare/workers-types').D1Database;
};
type SaveBackupEnv = {
  DB: import('@cloudflare/workers-types').D1Database;
  SAVES_BUCKET: import('@cloudflare/workers-types').R2Bucket;
};

let setBetterAuthEnv: (env: BetterAuthEnv | undefined) => void;
let setSaveBackupEnv: (env: SaveBackupEnv | undefined) => void;
let app: import('../index.ts').App;
let r2: ReturnType<typeof createMockR2>;
let saveD1: ReturnType<typeof createMockD1>;

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
    body: bytes as unknown as BodyInit,
  });

const get = (path: string, cookie?: string) =>
  new Request(`${BASE_URL}${path}`, { headers: cookie ? { cookie } : {} });

const del = (path: string, cookie?: string) =>
  new Request(`${BASE_URL}${path}`, { method: 'DELETE', headers: cookie ? { cookie } : {} });

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
  const betterAuthD1 = createMockD1(client);
  setBetterAuthEnv({
    DB: betterAuthD1.binding as unknown as import('@cloudflare/workers-types').D1Database,
  });
  const saveBackupModule = await import('../save_backup.ts');
  setSaveBackupEnv = saveBackupModule.setSaveBackupEnv;
  r2 = createMockR2();
  saveD1 = createMockD1(client);
  setSaveBackupEnv({
    DB: saveD1.binding as unknown as import('@cloudflare/workers-types').D1Database,
    SAVES_BUCKET: r2 as unknown as import('@cloudflare/workers-types').R2Bucket,
  });
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
    expect(res.headers.get('cache-control')).toBe('no-store');
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

  // ── C-462: DELETE endpoint ───────────────────────────────────────────

  test('delete without a session is rejected 401', async () => {
    const res = await app.handle(del('/api/saves/some-id'));
    expect(res.status).toBe(401);
  });

  test('delete of owned backup removes R2 object and D1 row', async () => {
    const cookie = await signInCookie('diana@example.com');
    const bytes = new Uint8Array([10, 20, 30]);
    const createRes = await app.handle(
      postBytes('/api/saves/backup?filename=save.db', bytes, cookie),
    );
    expect(createRes.status).toBe(201);
    const body = (await createRes.json()) as { backupId: string; r2Key: string };
    const { backupId, r2Key } = body;

    // Verify it exists before delete.
    expect(r2.store.has(r2Key)).toBe(true);
    const rowsBefore = await client.execute('SELECT id FROM account_backups');
    const beforeCount = rowsBefore.rows.length;

    const delRes = await app.handle(del(`/api/saves/${backupId}`, cookie));
    expect(delRes.status).toBe(200);

    // R2 object is gone.
    expect(r2.store.has(r2Key)).toBe(false);

    // D1 row count decreased by 1.
    const rowsAfter = await client.execute('SELECT id FROM account_backups');
    expect(rowsAfter.rows.length).toBe(beforeCount - 1);
  });

  test('delete of another user backup is rejected 404', async () => {
    const aliceCookie = await signInCookie('alice@example.com');
    const createRes = await app.handle(
      postBytes('/api/saves/backup?filename=save.db', new Uint8Array([1, 2, 3]), aliceCookie),
    );
    expect(createRes.status).toBe(201);
    const body = (await createRes.json()) as { backupId: string; r2Key: string };
    const { backupId, r2Key } = body;

    const eveCookie = await signInCookie('eve@example.com');
    const res = await app.handle(del(`/api/saves/${backupId}`, eveCookie));
    expect(res.status).toBe(404);

    // The backup should still exist (owned by Alice).
    expect(r2.store.has(r2Key)).toBe(true);
  });

  test('a metadata delete failure is retryable after the R2 object is gone', async () => {
    const cookie = await signInCookie('retry-delete@example.com');
    const createRes = await app.handle(
      postBytes('/api/saves/backup?filename=save.db', new Uint8Array([7, 8, 9]), cookie),
    );
    const { backupId, r2Key } = (await createRes.json()) as {
      backupId: string;
      r2Key: string;
    };

    saveD1.failNextAccountBackupDelete();
    const firstDelete = await app.handle(del(`/api/saves/${backupId}`, cookie));
    expect(firstDelete.status).toBe(500);
    expect(r2.store.has(r2Key)).toBe(false);

    const rowAfterFailure = await client.execute({
      sql: 'SELECT id FROM account_backups WHERE id = ?',
      args: [backupId],
    });
    expect(rowAfterFailure.rows).toHaveLength(1);

    const retryDelete = await app.handle(del(`/api/saves/${backupId}`, cookie));
    expect(retryDelete.status).toBe(200);
    expect(r2.deleteCalls.filter((key) => key === r2Key)).toHaveLength(2);

    const rowAfterRetry = await client.execute({
      sql: 'SELECT id FROM account_backups WHERE id = ?',
      args: [backupId],
    });
    expect(rowAfterRetry.rows).toHaveLength(0);
  });

  test('quota recovers after delete', async () => {
    const cookie = await signInCookie('fiona@example.com');

    // Create MAX_BACKUPS_PER_ACCOUNT backups.
    const backupIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await app.handle(
        postBytes('/api/saves/backup?filename=save.db', new Uint8Array([i]), cookie),
      );
      expect(res.status).toBe(201);
      const { backupId } = (await res.json()) as { backupId: string };
      backupIds.push(backupId);
    }

    // 21st backup should be rejected (quota_exceeded).
    const quotaRes = await app.handle(
      postBytes('/api/saves/backup?filename=save.db', new Uint8Array([99]), cookie),
    );
    expect(quotaRes.status).toBe(429);

    // Delete one backup.
    const delRes = await app.handle(del(`/api/saves/${backupIds[0]}`, cookie));
    expect(delRes.status).toBe(200);

    // Now the 21st backup should succeed.
    const successRes = await app.handle(
      postBytes('/api/saves/backup?filename=save.db', new Uint8Array([99]), cookie),
    );
    expect(successRes.status).toBe(201);
  });
});
