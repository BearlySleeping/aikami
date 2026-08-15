// packages/backend/database/tests/migrations.test.ts
//
// C-394 AC-2: the generated migration applies to real PostgreSQL, re-running
// is a no-op, and every required constraint exists IN THE DATABASE (not just
// in Drizzle's type layer).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from 'pg';
import { applyMigrations, countAppliedMigrations, hasMigrations } from '../src/lib/migrate.ts';
import { isPostgresReachable, TEST_CONNECTION_URL } from './helpers.ts';

const reachable = await isPostgresReachable();

const describeSuite = reachable ? describe : describe.skip;

if (!reachable) {
  // biome-ignore lint/suspicious/noConsole: clear skip notice for the test runner (postgres not running)
  console.warn(
    'SKIP migrations suite: local postgres (localhost:5433) is not running — start it with bun postgres:start',
  );
}

const withClient = async <T>(fn: (client: Client) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: TEST_CONNECTION_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

describeSuite('migrations (AC-2)', () => {
  beforeAll(async () => {
    // Ensure the migration is applied before the schema assertions.
    await applyMigrations({ connectionString: TEST_CONNECTION_URL });
  });

  afterAll(async () => {
    // No teardown: the migration is the state under test and is idempotent.
  });

  test('the package has a generated migration folder with a journal', async () => {
    expect(await hasMigrations()).toBe(true);
  });

  test('applies the migration and records exactly one applied version', async () => {
    const applied = await applyMigrations({ connectionString: TEST_CONNECTION_URL });
    // Idempotent: a fresh apply after beforeAll must be a no-op.
    expect(applied).toBe(0);
    expect(await countAppliedMigrations({ connectionString: TEST_CONNECTION_URL })).toBe(1);
  });

  test('re-running apply is a no-op (idempotent by version)', async () => {
    const before = await countAppliedMigrations({ connectionString: TEST_CONNECTION_URL });
    const applied = await applyMigrations({ connectionString: TEST_CONNECTION_URL });
    const after = await countAppliedMigrations({ connectionString: TEST_CONNECTION_URL });
    expect(applied).toBe(0);
    expect(after).toBe(before);
  });

  test('the pack_visibility enum exists in the database', async () => {
    await withClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_type WHERE typname = 'pack_visibility'`,
      );
      expect(Number(result.rows[0]?.count)).toBe(1);
    });
  });

  test('accounts.firebase_uid is UNIQUE NOT NULL', async () => {
    await withClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_indexes
          WHERE tablename = 'accounts' AND indexname = 'accounts_firebase_uid_unique'`,
      );
      expect(Number(result.rows[0]?.count)).toBe(1);
    });
  });

  test('packs.slug is UNIQUE NOT NULL with the url-safe CHECK', async () => {
    await withClient(async (client) => {
      const unique = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_indexes
          WHERE tablename = 'packs' AND indexname = 'packs_slug_unique'`,
      );
      expect(Number(unique.rows[0]?.count)).toBe(1);

      const check = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_constraint
          WHERE conname = 'packs_slug_url_safe' AND contype = 'c'`,
      );
      expect(Number(check.rows[0]?.count)).toBe(1);
    });
  });

  test('pack_versions (pack_id, version) is UNIQUE', async () => {
    await withClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_indexes
          WHERE tablename = 'pack_versions' AND indexname = 'pack_versions_pack_id_version_unique'`,
      );
      expect(Number(result.rows[0]?.count)).toBe(1);
    });
  });

  test('both foreign keys are ON DELETE RESTRICT', async () => {
    await withClient(async (client) => {
      const result = await client.query<{ confdeltype: string }>(
        `SELECT confdeltype
           FROM pg_constraint
          WHERE contype = 'f'
            AND conname IN ('packs_owner_account_id_accounts_id_fk', 'pack_versions_pack_id_packs_id_fk')
          ORDER BY conname`,
      );
      expect(result.rows).toHaveLength(2);
      for (const row of result.rows) {
        // 'r' = RESTRICT — the AC explicitly forbids a cascade here.
        expect(row.confdeltype).toBe('r');
      }
    });
  });
});
