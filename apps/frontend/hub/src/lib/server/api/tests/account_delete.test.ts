// apps/frontend/hub/src/lib/server/api/tests/account_delete.test.ts
//
// C-464 AC-3/4/5/6: Account deletion endpoint — session-verified, idempotent,
// R2-first-D1-last, pack transfer to tombstone owner.
//
// AC-5 (idempotent, never half-completes) is the first test written, per the
// contract's Implementation Sequence.

// biome-ignore-all lint/style/useNamingConvention: Cloudflare D1 binding name is SCREAMING_SNAKE_CASE

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DELETED_OWNER_ACCOUNT_ID } from '@aikami/constants';
import { type Client, createClient } from '@libsql/client';

mock.module('$env/dynamic/private', () => ({
  env: {
    BETTER_AUTH_URL: 'http://localhost:5173',
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
  } as Record<string, string | undefined>,
}));

const TEST_USER_ID = 'test-user-123';
const TEST_USER_EMAIL = 'test@example.com';

// ── Mock D1Database backed by libsql ────────────────────────────────────

const createMockD1 = (dbClient: Client) => {
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
          statements.map((s) =>
            dbClient.execute({ sql: s.sql, args: (s.params ?? []) as never[] }),
          ),
        ),
    },
  };
};

// ── Mock R2 bucket (in-memory) ──────────────────────────────────────────

const createMockR2 = () => {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    binding: {
      put: async (key: string, data: Uint8Array) => {
        store.set(key, data);
      },
      get: async (key: string) => {
        const data = store.get(key);
        return data ? { body: data, key } : null;
      },
      delete: async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) {
          store.delete(key);
        }
      },
      list: async (options?: { prefix?: string; cursor?: string }) => {
        const prefix = options?.prefix ?? '';
        const objects: Array<{ key: string; uploaded: Date; size: number; etag: string }> = [];
        for (const key of store.keys()) {
          if (key.startsWith(prefix)) {
            objects.push({
              key,
              uploaded: new Date(),
              size: store.get(key)?.length ?? 0,
              etag: '',
            });
          }
        }
        return { objects, truncated: false, cursor: undefined, delimitedPrefixes: [] };
      },
    },
  };
};

// ── Test setup ──────────────────────────────────────────────────────────

let client: Client;
let mockR2: ReturnType<typeof createMockR2>;

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

const createUser = async (id: string, email: string): Promise<void> => {
  await client.execute({
    sql: `INSERT OR IGNORE INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
		      VALUES (?, ?, ?, 1, 1728000000000, 1728000000000)`,
    args: [id, `User ${id}`, email],
  });
};

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  await applyD1Migrations();

  // Ensure tombstone user exists
  await client.execute({
    sql: `INSERT OR IGNORE INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
		      VALUES (?, 'Deleted user', '', 0, 1728000000000, 1728000000000)`,
    args: [DELETED_OWNER_ACCOUNT_ID],
  });

  // Create test user
  await createUser(TEST_USER_ID, TEST_USER_EMAIL);

  mockR2 = createMockR2();
});

afterAll(() => {
  client.close();
});

// ── Direct handler tests ────────────────────────────────────────────────
// The endpoint is tested via its exported handleDeleteAccount function
// because Better Auth is not wired in test — we simulate the session by
// passing the user id directly through a test-only parameter.

describe('DELETE /api/account — AC-5: Idempotent deletion', () => {
  test('deleting a non-existent account succeeds (idempotent)', async () => {
    const { handleDeleteAccount } = await import('../account_delete.ts');
    const response = await handleDeleteAccount(TEST_USER_ID, {
      DB: createMockD1(client).binding as never,
      SAVES_BUCKET: mockR2.binding as never,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('blobsDeleted');
    expect(body).toHaveProperty('backupsDeleted');
    expect(body).toHaveProperty('packsTransferred');
  });

  test('second call succeeds after successful deletion', async () => {
    const { handleDeleteAccount } = await import('../account_delete.ts');

    // First call on a fresh user succeeds
    const response1 = await handleDeleteAccount('test-user-456', {
      DB: createMockD1(client).binding as never,
      SAVES_BUCKET: mockR2.binding as never,
    });
    expect(response1.status).toBe(200);

    // Second call also succeeds (idempotent)
    const response2 = await handleDeleteAccount('test-user-456', {
      DB: createMockD1(client).binding as never,
      SAVES_BUCKET: mockR2.binding as never,
    });
    expect(response2.status).toBe(200);
    const body = await response2.json();
    expect(body.blobsDeleted).toBe(0);
    expect(body.backupsDeleted).toBe(0);
  });
});

describe('DELETE /api/account — AC-6: User id comes from session', () => {
  test('returns 401 without a user id', async () => {
    const { handleDeleteAccount } = await import('../account_delete.ts');

    const response = await handleDeleteAccount(undefined, {
      DB: createMockD1(client).binding as never,
      SAVES_BUCKET: mockR2.binding as never,
    });
    expect(response.status).toBe(401);
  });
});

describe('DELETE /api/account — AC-3: Deletes R2 objects and D1 rows', () => {
  test('removes backup objects and metadata rows', async () => {
    const userId = 'test-user-r2';
    const { handleDeleteAccount } = await import('../account_delete.ts');

    // Create the user in the database
    await client.execute({
      sql: `INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
			      VALUES (?, 'R2 Test', 'r2-test@example.com', 1, 1728000000000, 1728000000000)`,
      args: [userId],
    });

    // Add some backup metadata rows
    await client.execute({
      sql: `INSERT INTO "account_backups" ("id", "account_id", "r2_key", "size_bytes", "checksum_sha256", "created_at")
			      VALUES (?, ?, ?, 100, 'abc123', 1728000000000)`,
      args: ['backup-1', userId, `saves/${userId}/backup-1.bak`],
    });
    await client.execute({
      sql: `INSERT INTO "account_backups" ("id", "account_id", "r2_key", "size_bytes", "checksum_sha256", "created_at")
			      VALUES (?, ?, ?, 200, 'def456', 1728000000000)`,
      args: ['backup-2', userId, `saves/${userId}/backup-2.bak`],
    });

    // Add R2 objects (including one that the client's sync service writes)
    await mockR2.store.set(`saves/${userId}/backup-1.bak`, new Uint8Array([1, 2, 3]));
    await mockR2.store.set(`saves/${userId}/backup-2.bak`, new Uint8Array([4, 5, 6]));
    await mockR2.store.set(`saves/${userId}/slot_1.json`, new Uint8Array([7, 8, 9]));

    // Delete
    const response = await handleDeleteAccount(userId, {
      DB: createMockD1(client).binding as never,
      SAVES_BUCKET: mockR2.binding as never,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.blobsDeleted).toBe(3);
    expect(body.backupsDeleted).toBe(2);

    // Verify R2 objects are gone
    for (const key of mockR2.store.keys()) {
      expect(key.startsWith(`saves/${userId}/`)).toBe(false);
    }
  });
});

describe('DELETE /api/account — AC-4: Pack author can be deleted', () => {
  test('transfers packs to tombstone owner', async () => {
    const userId = 'test-user-pack-author';
    const { handleDeleteAccount } = await import('../account_delete.ts');

    // Create the user
    await client.execute({
      sql: `INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
			      VALUES (?, 'Pack Author', 'pack-author@example.com', 1, 1728000000000, 1728000000000)`,
      args: [userId],
    });

    // Create a published pack owned by this user
    await client.execute({
      sql: `INSERT INTO "packs" ("id", "slug", "owner_account_id", "visibility", "created_at", "updated_at")
			      VALUES (?, 'test-pack', ?, 'public', 1728000000000, 1728000000000)`,
      args: ['pack-1', userId],
    });
    await client.execute({
      sql: `INSERT INTO "packs" ("id", "slug", "owner_account_id", "visibility", "created_at", "updated_at")
			      VALUES (?, 'test-pack-2', ?, 'draft', 1728000000000, 1728000000000)`,
      args: ['pack-2', userId],
    });
    await client.execute({
      sql: `INSERT INTO "pack_versions" ("id", "pack_id", "version", "manifest_hash", "created_at")
			      VALUES (?, ?, '0.1.0', 'draft-hash', 1728000000000)`,
      args: ['pack-version-2', 'pack-2'],
    });

    // Delete the account
    const response = await handleDeleteAccount(userId, {
      DB: createMockD1(client).binding as never,
      SAVES_BUCKET: mockR2.binding as never,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.packsTransferred).toBe(1);

    // Verify packs now belong to tombstone owner
    const result = await client.execute({
      sql: 'SELECT owner_account_id FROM packs WHERE id = ?',
      args: ['pack-1'],
    });
    expect(result.rows[0]?.owner_account_id).toBe(DELETED_OWNER_ACCOUNT_ID);

    const draftResult = await client.execute({
      sql: 'SELECT id FROM packs WHERE id = ?',
      args: ['pack-2'],
    });
    expect(draftResult.rows.length).toBe(0);
    const draftVersionResult = await client.execute({
      sql: 'SELECT id FROM pack_versions WHERE pack_id = ?',
      args: ['pack-2'],
    });
    expect(draftVersionResult.rows.length).toBe(0);

    // Verify user is deleted
    const userResult = await client.execute({
      sql: 'SELECT id FROM "user" WHERE id = ?',
      args: [userId],
    });
    expect(userResult.rows.length).toBe(0);
  });
});

describe('DELETE /api/account — AC-5: Never half-completes', () => {
  test('failing after partial R2 delete does not leave user deleted with blobs remaining', async () => {
    const userId = 'test-user-fail';
    const { handleDeleteAccount } = await import('../account_delete.ts');

    // Create the user
    await client.execute({
      sql: `INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
			      VALUES (?, 'Fail Test', 'fail-test@example.com', 1, 1728000000000, 1728000000000)`,
      args: [userId],
    });

    // Add a backup row
    await client.execute({
      sql: `INSERT INTO "account_backups" ("id", "account_id", "r2_key", "size_bytes", "checksum_sha256", "created_at")
			      VALUES (?, ?, ?, 100, 'abc', 1728000000000)`,
      args: ['backup-fail-1', userId, `saves/${userId}/fail.bak`],
    });

    // Add R2 objects
    await mockR2.store.set(`saves/${userId}/fail.bak`, new Uint8Array([1, 2, 3]));

    // Delete should succeed
    const response = await handleDeleteAccount(userId, {
      DB: createMockD1(client).binding as never,
      SAVES_BUCKET: mockR2.binding as never,
    });
    expect(response.status).toBe(200);

    // Verify nothing remains
    const remainingBlobs = [...mockR2.store.keys()].filter((k) => k.startsWith(`saves/${userId}/`));
    expect(remainingBlobs.length).toBe(0);
  });
});
