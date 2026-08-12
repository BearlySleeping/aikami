// packages/frontend/storage/src/lib/__tests__/local_database_factory.test.ts
//
// C-384 AC-5: The factory refuses to return a database whose migrations
// failed — the promise rejects, no handle is cached in the module
// singleton, and a subsequent call retries with a fresh database.
//
// The failing migration is simulated by mocking the migrations module
// (applyMigrations throws on the first call, succeeds afterwards).

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Module-scoped switch controlling whether the mocked applyMigrations
// throws. The factory is re-imported after the mock is registered so the
// mock takes effect on the module graph.
let migrationShouldFail = true;

describe('local_database_factory (AC-5)', () => {
  let factory: typeof import('../local_database_factory.ts');

  beforeEach(async () => {
    migrationShouldFail = true;
    mock.module('../migrations.ts', () => ({
      applyMigrations: mock(async () => {
        if (migrationShouldFail) {
          throw new Error('simulated migration failure');
        }
        return 1;
      }),
    }));
    factory = await import('../local_database_factory.ts');
  });

  afterEach(async () => {
    factory.resetLocalDatabase();
    try {
      await factory.closeLocalDatabase();
    } catch {
      // no-op — nothing to close
    }
  });

  test('AC-5: rejects when migrations fail and does not cache a broken handle', async () => {
    await expect(
      factory.getLocalDatabase({ platform: 'wasm', databasePath: ':memory:' }),
    ).rejects.toThrow('simulated migration failure');
  });

  test('AC-5: a subsequent call retries and succeeds', async () => {
    // First call fails...
    await expect(
      factory.getLocalDatabase({ platform: 'wasm', databasePath: ':memory:' }),
    ).rejects.toThrow('simulated migration failure');

    // ...second call (migrations now succeed) must return a working handle.
    migrationShouldFail = false;
    const db = await factory.getLocalDatabase({ platform: 'wasm', databasePath: ':memory:' });
    expect(db).toBeDefined();

    // The cached handle is usable — verify via a real query.
    const result = await db.query({ sql: 'SELECT 1 AS n', args: [] });
    expect(result.rows[0]?.n).toBe(1);

    await factory.closeLocalDatabase();
  });
});
