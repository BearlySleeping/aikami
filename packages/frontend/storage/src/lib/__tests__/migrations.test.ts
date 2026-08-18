// packages/frontend/storage/src/lib/__tests__/migrations.test.ts
//
// C-384 AC-1..AC-4: Tests for the local SQLite migration runner
// (applyMigrations) against BOTH adapters:
//   - WasmStorageAdapter  (:memory:)
//   - TursoStorageAdapter (:memory:)
//
// Covers: fresh-database migration (AC-1), legacy v0 convergence (AC-2),
// column-add via new migration (AC-3), exactly-once + atomicity (AC-4).
// The version-2 migrations used in AC-3/AC-4 are test fixtures passed via
// the runner's optional `migrations` parameter — they are NEVER part of
// the production AIKAMI_MIGRATIONS list.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AIKAMI_MIGRATIONS, applyMigrations, type Migration } from '../migrations.ts';
import type { LocalDatabaseInterface } from '../storage_adapter.ts';
import { TursoStorageAdapter } from '../turso_storage_adapter.ts';
import { WasmStorageAdapter } from '../wasm_storage_adapter.ts';

// ---------------------------------------------------------------------------
// Adapter harness
// ---------------------------------------------------------------------------

const createWasm = async (): Promise<WasmStorageAdapter> => {
  const adapter = new WasmStorageAdapter({ databasePath: ':memory:' });
  await adapter.open();
  return adapter;
};

const createTurso = async (): Promise<TursoStorageAdapter> => {
  const adapter = new TursoStorageAdapter({ databasePath: ':memory:' });
  await adapter.open();
  return adapter;
};

type AdapterKind = 'wasm' | 'turso';

const createAdapter = async (kind: AdapterKind): Promise<LocalDatabaseInterface> =>
  kind === 'wasm' ? await createWasm() : await createTurso();

/** Runs the legacy pre-C-384 path: apply schema v1 statements, no version bump. */
const applyLegacySchema = async (db: LocalDatabaseInterface): Promise<void> => {
  for (const ddl of AIKAMI_MIGRATIONS[0].statements) {
    await db.execute({ sql: ddl, args: [] });
  }
};

/** Queries user_version through the portable pragma table form. */
const readUserVersion = async (db: LocalDatabaseInterface): Promise<number> => {
  const result = await db.query({ sql: 'SELECT * FROM pragma_user_version', args: [] });
  const row = result.rows[0];
  if (!row) {
    throw new Error('no user_version row');
  }
  return (row.user_version ?? row.pragma_user_version) as number;
};

/** Ordered sqlite_master snapshot for schema deep-equality (AC-2). */
const schemaSnapshot = async (
  db: LocalDatabaseInterface,
): Promise<Array<Record<string, unknown>>> => {
  const result = await db.query({
    sql: 'SELECT type, name, sql FROM sqlite_master ORDER BY type, name',
    args: [],
  });
  return result.rows.map((row) => ({ type: row.type, name: row.name, sql: row.sql }));
};

const SCHEMA_TABLES = [
  'asset_sources',
  'assets',
  'campaigns',
  'capability_profile',
  'characters',
  'chat_history',
  'compacted_summaries',
  'install_state',
  'journal_entries',
  'meta',
  'npc_schedules',
  'saves',
  'session_checkpoints',
  'sessions',
  'string_registry',
] as const;

const SCHEMA_INDEXES = [
  'idx_assets_hash',
  'idx_assets_pack',
  'idx_chat_history_session',
  'idx_compacted_campaign',
  'idx_install_state_status',
  'idx_journal_campaign',
  'idx_session_checkpoints_campaign',
  'idx_session_checkpoints_session',
  'idx_sessions_game',
] as const;

// ---------------------------------------------------------------------------
// Fixture migrations (AC-3 / AC-4 — test-only, never in production list)
// ---------------------------------------------------------------------------

/** v2 fixture: adds a junk column to characters (AC-3 regression). */
const makeV2AddColumn = (): Migration => ({
  version: 2,
  name: 'fixture-add-test-column',
  statements: ['ALTER TABLE characters ADD COLUMN test_column TEXT'],
});

/** v2 fixture: non-idempotent probe insert (AC-4 exactly-once). */
const makeV2Probe = (): Migration => ({
  version: 2,
  name: 'fixture-insert-probe',
  statements: [`INSERT INTO meta (key, value) VALUES ('probe', '1')`],
});

/** v2 fixture: first statement valid, second statement invalid (AC-4 atomicity). */
const makeV2Invalid = (): Migration => ({
  version: 2,
  name: 'fixture-invalid-statement',
  statements: [
    `INSERT INTO meta (key, value) VALUES ('partial-write', '1')`,
    'INSERT INTO table_that_does_not_exist VALUES (1)',
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const kind of ['wasm', 'turso'] as const) {
  describe(`applyMigrations (${kind})`, () => {
    let db: LocalDatabaseInterface;

    beforeEach(async () => {
      db = await createAdapter(kind);
    });

    afterEach(async () => {
      await db.close();
    });

    // ── AC-1: Fresh database migrates to the latest version ──────────

    test('AC-1: fresh database reaches latest version with full schema', async () => {
      const version = await applyMigrations(db);

      expect(version).toBe(AIKAMI_MIGRATIONS.length);
      expect(await readUserVersion(db)).toBe(AIKAMI_MIGRATIONS.length);

      // Assert the FULL table set against sqlite_master — a count would pass
      // when a table is renamed.
      const objects = await db.query({
        sql: "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')",
        args: [],
      });
      const names = objects.rows.map((row) => row.name as string);
      for (const table of SCHEMA_TABLES) {
        expect(names).toContain(table);
      }
      for (const index of SCHEMA_INDEXES) {
        expect(names).toContain(index);
      }
    });

    // ── AC-2: Legacy v0 database converges on the identical schema ────

    test('AC-2: legacy v0 database converges with rows intact', async () => {
      // Build a "legacy" database: schema v1 applied directly with no
      // version bump, plus real rows in campaigns/sessions/chat_history.
      await applyLegacySchema(db);
      expect(await readUserVersion(db)).toBe(0);

      await db.execute({
        sql: `INSERT INTO campaigns (id, data, updated_at) VALUES ('legacy-c1', '{"id":"legacy-c1"}', '2026-01-01T00:00:00.000Z')`,
        args: [],
      });
      await db.execute({
        sql: `INSERT INTO sessions (id, game_id, session_number, started_at) VALUES ('legacy-s1', 'game-1', 1, '2026-01-01T00:00:00.000Z')`,
        args: [],
      });
      await db.execute({
        sql: `INSERT INTO chat_history (session_id, role, content) VALUES ('legacy-s1', 'user', 'hello legacy')`,
        args: [],
      });

      const version = await applyMigrations(db);

      expect(version).toBe(AIKAMI_MIGRATIONS.length);
      expect(await readUserVersion(db)).toBe(AIKAMI_MIGRATIONS.length);

      // Rows survive the migration.
      const campaigns = await db.query({
        sql: 'SELECT COUNT(*) AS n FROM campaigns',
        args: [],
      });
      const sessions = await db.query({ sql: 'SELECT COUNT(*) AS n FROM sessions', args: [] });
      const chat = await db.query({ sql: 'SELECT COUNT(*) AS n FROM chat_history', args: [] });
      expect(campaigns.rows[0].n).toBe(1);
      expect(sessions.rows[0].n).toBe(1);
      expect(chat.rows[0].n).toBe(1);

      // Migration 1 is all IF NOT EXISTS — applying it to an already-
      // schema'd v0 database must not change the legacy tables. Later
      // versions (v2-v5, C-386) append NEW tables, so the overall schema
      // snapshot is allowed to grow; the legacy tables must be untouched.
      const schemaAfter = await schemaSnapshot(db);
      const afterNames = schemaAfter
        .filter((row) => row.type === 'table')
        .map((row) => row.name as string);
      for (const table of SCHEMA_TABLES) {
        expect(afterNames).toContain(table);
      }
      // New C-386 tables exist after migration.
      for (const table of ['chats', 'chat_links', 'personas', 'npcs', 'custom_agents']) {
        expect(afterNames).toContain(table);
      }
    });

    test('AC-2: legacy v0 and fresh-migrated databases have identical schemas', async () => {
      // Fresh path
      const fresh = await createAdapter(kind);
      try {
        await applyMigrations(fresh);
        const freshSchema = await schemaSnapshot(fresh);

        // Legacy path
        await applyLegacySchema(db);
        await applyMigrations(db);
        const legacySchema = await schemaSnapshot(db);

        // Deep equality — comparing only table names would pass while
        // columns diverge, which is the exact bug this contract prevents.
        expect(legacySchema).toEqual(freshSchema);
      } finally {
        await fresh.close();
      }
    });

    // ── AC-3: Column added in a new migration reaches existing database ──

    test('AC-3: v2 ALTER TABLE reaches a v1 database, preserving rows', async () => {
      // Land at v1 with ONLY migration 1 — not the full production list — so
      // this fixture test stays isolated if future migrations are appended.
      await applyMigrations(db, [AIKAMI_MIGRATIONS[0]]);

      await db.execute({
        sql: `INSERT INTO characters (id, display_name, appearance_json, stats_json) VALUES ('char-1', 'Hero', '{}', '{"hp":10}')`,
        args: [],
      });

      const migrations = [AIKAMI_MIGRATIONS[0], makeV2AddColumn()];
      const version = await applyMigrations(db, migrations);

      expect(version).toBe(2);
      expect(await readUserVersion(db)).toBe(2);

      // New column exists with NULL in the pre-existing row.
      const cols = await db.query({
        sql: "PRAGMA table_info('characters')",
        args: [],
      });
      const colNames = cols.rows.map((row) => row.name as string);
      expect(colNames).toContain('test_column');

      const rows = await db.query({
        sql: 'SELECT id, test_column FROM characters',
        args: [],
      });
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].id).toBe('char-1');
      expect(rows.rows[0].test_column).toBeNull();
    });

    // ── AC-4: Exactly once + atomicity ────────────────────────────────

    test('AC-4: migrations run exactly once', async () => {
      const migrations = [AIKAMI_MIGRATIONS[0], makeV2Probe()];

      await applyMigrations(db, migrations);
      await applyMigrations(db, migrations);
      await applyMigrations(db, migrations);
      await applyMigrations(db, migrations);

      const probes = await db.query({
        sql: "SELECT COUNT(*) AS n FROM meta WHERE key = 'probe'",
        args: [],
      });
      expect(probes.rows[0].n).toBe(1);
    });

    test('AC-4: failed migration rolls back atomically and keeps version', async () => {
      const migrations = [AIKAMI_MIGRATIONS[0], makeV2Invalid()];

      // Land at v1 with ONLY migration 1 (isolated from future production
      // migrations), then attempt the invalid v2 fixture.
      await applyMigrations(db, [AIKAMI_MIGRATIONS[0]]);

      await expect(applyMigrations(db, migrations)).rejects.toThrow();

      // Version unchanged — the version bump lives in the same transaction.
      expect(await readUserVersion(db)).toBe(1);

      // First statement's effect is NOT present (rolled back).
      const partial = await db.query({
        sql: "SELECT COUNT(*) AS n FROM meta WHERE key = 'partial-write'",
        args: [],
      });
      expect(partial.rows[0].n).toBe(0);
    });

    test('AC-4: version bump lands inside the transaction', async () => {
      // If the adapter executed the version bump outside the transaction,
      // a failed migration would still bump user_version. This proves the
      // pragma is transactional alongside the DDL/DML.
      const migrations = [AIKAMI_MIGRATIONS[0], makeV2Invalid()];
      // Baseline = migration 1 only (isolated from future production migrations).
      await applyMigrations(db, [AIKAMI_MIGRATIONS[0]]);
      await expect(applyMigrations(db, migrations)).rejects.toThrow();
      expect(await readUserVersion(db)).toBe(1);
    });

    // ── Validation ────────────────────────────────────────────────────

    test('invalid migration list (gap) throws before touching the database', async () => {
      const bad: Migration[] = [
        AIKAMI_MIGRATIONS[0],
        { version: 3, name: 'gap-skip-2', statements: ['SELECT 1'] },
      ];
      await expect(applyMigrations(db, bad)).rejects.toThrow(/expected version 2/);
      expect(await readUserVersion(db)).toBe(0);
    });

    test('already-current database is a cheap no-op', async () => {
      await applyMigrations(db);
      // Second run must not apply anything and must return the same version.
      const version = await applyMigrations(db);
      expect(version).toBe(AIKAMI_MIGRATIONS.length);
    });
  });
}
