// apps/frontend/client/src/lib/services/__tests__/local_database_fixture.ts
//
// Shared real-database fixture for local repository contract tests.
//
// Opens a real in-memory libSQL database with the production migrations
// applied, so repository tests observe SQLite semantics — partial unique
// indexes, ORDER BY, duplicate-insert handling, transaction rollback —
// instead of the retired regex SQL fake that approximated them incorrectly.
//
// Infrastructure only: no feature names, no service inventory, no
// business-success defaults. Feature behavior belongs in the test file.

import { applyMigrations } from '@aikami/frontend/storage/migrations';
import type { LocalDatabaseInterface } from '@aikami/frontend/storage/storage_adapter';
import { WasmStorageAdapter } from '@aikami/frontend/storage/wasm_storage_adapter';

/** A real in-memory database plus test-isolation helpers. */
export type RealLocalDatabase = {
  /** The open connection. Repositories receive this via their mocked `getLocalDatabase`. */
  readonly db: LocalDatabaseInterface;
  /** Deletes every row from every user table so tests start clean. */
  reset(): Promise<void>;
  /** Closes the connection and releases WASM resources. */
  close(): Promise<void>;
};

/** Lists the user tables created by the production migrations. */
const USER_TABLE_SQL = `SELECT name FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`;

/**
 * Opens a migrated, isolated in-memory database for a repository test.
 *
 * Call once per test file, then register it with
 * `mock.module('@aikami/frontend/storage', () => ({ getLocalDatabase: async () => fixture.db }))`
 * before importing the repository under test.
 */
export const createRealLocalDatabase = async (): Promise<RealLocalDatabase> => {
  const adapter = new WasmStorageAdapter({ databasePath: ':memory:' });
  await adapter.open();
  await applyMigrations(adapter);

  const discovery = await adapter.query({ sql: USER_TABLE_SQL, args: [] });
  const tables = discovery.rows
    .map((row) => (row as { name?: unknown }).name)
    .filter((name): name is string => typeof name === 'string');

  return {
    db: adapter,
    async reset(): Promise<void> {
      // Foreign keys are on (the adapter enables them); disable for the
      // duration of the wipe so parent rows can be removed in any order.
      await adapter.execute({ sql: 'PRAGMA foreign_keys = OFF', args: [] });
      try {
        for (const table of tables) {
          await adapter.execute({ sql: `DELETE FROM "${table}"`, args: [] });
        }
      } finally {
        await adapter.execute({ sql: 'PRAGMA foreign_keys = ON', args: [] });
      }
    },
    async close(): Promise<void> {
      await adapter.close();
    },
  };
};

/** Counts rows in a table using a real query. */
export const countTableRows = async (
  db: LocalDatabaseInterface,
  table: string,
): Promise<number> => {
  const result = await db.query({ sql: `SELECT COUNT(*) AS n FROM "${table}"`, args: [] });
  return Number((result.rows[0] as { n?: unknown } | undefined)?.n ?? 0);
};
