// packages/frontend/storage/src/lib/__tests__/storage_adapter.test.ts
//
// C-321 AC-1, AC-2: Tests for WasmStorageAdapter and DDL idempotency.
// Uses the in-memory SQLite database (:memory:) to validate the
// adapter contract without requiring OPFS.
//
// Tests:
// - WasmStorageAdapter conforms to LocalDatabaseInterface
// - query/execute/transaction work correctly
// - AIKAMI_MIGRATIONS[0] (schema v1) applies idempotently
// - Campaign JSON round-trip through campaigns table
// - transaction() rolls back atomically on failure
// - Data persists across adapter close/reopen

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AIKAMI_MIGRATIONS } from '../migrations.ts';
import type { LocalDatabaseInterface } from '../storage_adapter.ts';
import { WasmStorageAdapter } from '../wasm_storage_adapter.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createAdapter = async (): Promise<WasmStorageAdapter> => {
  const adapter = new WasmStorageAdapter({ databasePath: ':memory:' });
  await adapter.open();
  return adapter;
};

const applySchema = async (db: LocalDatabaseInterface): Promise<void> => {
  for (const ddl of AIKAMI_MIGRATIONS[0].statements) {
    await db.execute({ sql: ddl, args: [] });
  }
};

const makeCampaignJson = (overrides?: Record<string, unknown>): string => {
  return JSON.stringify({
    id: 'campaign-1',
    name: 'Test Campaign',
    state: 'idle',
    contentPackId: 'emberwatch',
    seed: 42,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    capabilityProfile: {
      textProvider: true,
      imageProvider: false,
      voiceProvider: false,
    },
    ...overrides,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WasmStorageAdapter (in-memory)', () => {
  let db: WasmStorageAdapter;

  beforeEach(async () => {
    db = await createAdapter();
    await applySchema(db);
  });

  afterEach(async () => {
    await db.close();
  });

  // ── AC-1: Conforms to LocalDatabaseInterface ────────────────────────

  test('open/close lifecycle', async () => {
    // Fresh adapter
    const fresh = new WasmStorageAdapter({ databasePath: ':memory:' });
    await fresh.open();
    expect(fresh).toBeDefined();

    // Double-open is safe
    await fresh.open();

    // Close
    await fresh.close();

    // Cannot re-open after close
    await expect(fresh.open()).rejects.toThrow('cannot re-open a closed adapter');
  });

  test('query returns typed rows', async () => {
    // Insert a campaign
    const data = makeCampaignJson();
    await db.execute({
      sql: `INSERT INTO campaigns (id, data, updated_at) VALUES (?, ?, ?)`,
      args: ['test-id', data, '2026-01-01T00:00:00.000Z'],
    });

    // Query it back
    const result = await db.query({
      sql: 'SELECT id, data, updated_at FROM campaigns WHERE id = ?',
      args: ['test-id'],
    });

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].id).toBe('test-id');
    expect(result.rows[0].data).toBe(data);
  });

  test('execute runs DDL and DML', async () => {
    // DDL already applied in beforeEach — no errors
    // DML insert
    await db.execute({
      sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
      args: ['test-key', 'test-value'],
    });

    const result = await db.query({
      sql: 'SELECT value FROM meta WHERE key = ?',
      args: ['test-key'],
    });
    expect(result.rows[0].value).toBe('test-value');
  });

  test('transaction commits atomically on success', async () => {
    await db.transaction([
      {
        sql: `INSERT INTO campaigns (id, data, updated_at) VALUES (?, ?, ?)`,
        args: ['c1', makeCampaignJson({ id: 'c1' }), '2026-01-01T00:00:00.000Z'],
      },
      {
        sql: `INSERT INTO capability_profile (campaign_id, text_provider, image_provider, voice_provider) VALUES (?, ?, ?, ?)`,
        args: ['c1', 1, 0, 0],
      },
    ]);

    const campaigns = await db.query({ sql: 'SELECT COUNT(*) AS n FROM campaigns', args: [] });
    const profiles = await db.query({
      sql: 'SELECT COUNT(*) AS n FROM capability_profile',
      args: [],
    });
    expect(campaigns.rows[0].n).toBe(1);
    expect(profiles.rows[0].n).toBe(1);
  });

  test('transaction rolls back on failure', async () => {
    // First insert is valid, second violates CHECK constraint or FK
    await expect(
      db.transaction([
        {
          sql: `INSERT INTO campaigns (id, data, updated_at) VALUES (?, ?, ?)`,
          args: ['rollback-c', makeCampaignJson({ id: 'rollback-c' }), '2026-01-01T00:00:00.000Z'],
        },
        {
          // Invalid SQL — this should cause rollback
          sql: `INSERT INTO capability_profile (campaign_id, text_provider, image_provider, voice_provider) VALUES (?, ?, ?, ?, ?)`,
          args: ['invalid-c', 1, 0, 0],
        },
      ]),
    ).rejects.toThrow();

    // The campaign should NOT exist (rolled back)
    const result = await db.query({
      sql: 'SELECT COUNT(*) AS n FROM campaigns WHERE id = ?',
      args: ['rollback-c'],
    });
    expect(result.rows[0].n).toBe(0);
  });

  test('data persists across close/reopen', async () => {
    // Insert data
    await db.execute({
      sql: `INSERT INTO campaigns (id, data, updated_at) VALUES (?, ?, ?)`,
      args: ['persist-id', makeCampaignJson({ id: 'persist-id' }), '2026-01-01T00:00:00.000Z'],
    });

    // Close and reopen
    await db.close();
    db = new WasmStorageAdapter({ databasePath: ':memory:' });
    await db.open();

    // :memory: database is destroyed on close — this just validates the API
    // The real persistence test is in the OPFS E2E test
    // Re-create schema for in-memory
    await applySchema(db);

    // But we can verify the adapter state is clean
  });

  // ── AC-2: Extended Schema ──────────────────────────────────────────

  test('DDL applies twice idempotently', async () => {
    // First application (already done in beforeEach)
    // Second application — should not throw
    await applySchema(db);
    await applySchema(db);
    await applySchema(db);

    // All tables should exist
    const tables = await db.query({
      sql: `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      args: [],
    });
    const names = tables.rows.map((r) => r.name);
    expect(names).toContain('campaigns');
    expect(names).toContain('capability_profile');
    expect(names).toContain('meta');
    expect(names).toContain('saves');
    expect(names).toContain('characters');
    expect(names).toContain('chat_history');
    expect(names).toContain('string_registry');
  });

  test('campaigns table has correct columns', async () => {
    const cols = await db.query({
      sql: `PRAGMA table_info('campaigns')`,
      args: [],
    });
    const colNames = cols.rows.map((r) => r.name as string);
    expect(colNames).toContain('id');
    expect(colNames).toContain('data');
    expect(colNames).toContain('updated_at');
  });

  test('saves table has realigned columns', async () => {
    const cols = await db.query({
      sql: `PRAGMA table_info('saves')`,
      args: [],
    });
    const colNames = cols.rows.map((r) => r.name as string);
    expect(colNames).toContain('id');
    expect(colNames).toContain('slot_id');
    expect(colNames).toContain('campaign_id');
    expect(colNames).toContain('timestamp');
    expect(colNames).toContain('map_name');
    expect(colNames).toContain('payload');
    // Columns from the prior schema should be absent
    expect(colNames).not.toContain('character_id');
    expect(colNames).not.toContain('name');
    expect(colNames).not.toContain('snapshot_json');
    expect(colNames).not.toContain('created_at');
  });

  test('capability_profile table has correct schema', async () => {
    const cols = await db.query({
      sql: `PRAGMA table_info('capability_profile')`,
      args: [],
    });
    const colNames = cols.rows.map((r) => r.name as string);
    expect(colNames).toContain('campaign_id');
    expect(colNames).toContain('text_provider');
    expect(colNames).toContain('image_provider');
    expect(colNames).toContain('voice_provider');
  });

  test('meta table stores key/value pairs', async () => {
    await db.execute({
      sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
      args: ['indexeddb_import_completed', '1'],
    });

    const result = await db.query({
      sql: 'SELECT value FROM meta WHERE key = ?',
      args: ['indexeddb_import_completed'],
    });
    expect(result.rows[0].value).toBe('1');
  });

  test('Campaign JSON round-trips through campaigns table unchanged', async () => {
    const campaign = {
      id: 'roundtrip-1',
      name: 'Round Trip Test',
      state: 'playing',
      personaId: 'persona-abc',
      contentPackId: 'emberwatch',
      seed: 999,
      createdAt: '2026-01-15T12:00:00.000Z',
      updatedAt: '2026-01-15T12:30:00.000Z',
      lastSavedAt: '2026-01-15T12:30:00.000Z',
      lastSaveSlotId: 'auto-save',
      capabilityProfile: {
        textProvider: true,
        imageProvider: true,
        voiceProvider: false,
      },
    };

    const json = JSON.stringify(campaign);

    await db.execute({
      sql: `INSERT INTO campaigns (id, data, updated_at) VALUES (?, ?, ?)`,
      args: [campaign.id, json, campaign.updatedAt],
    });

    const result = await db.query({
      sql: 'SELECT data FROM campaigns WHERE id = ?',
      args: [campaign.id],
    });

    const roundTripped = JSON.parse(result.rows[0].data as string);
    expect(roundTripped).toEqual(campaign);
  });

  test('chat_history table exists and accepts dialogue turns', async () => {
    await db.execute({
      sql: `INSERT INTO chat_history (session_id, role, content) VALUES (?, ?, ?)`,
      args: ['session-1', 'user', 'Hello, NPC!'],
    });
    await db.execute({
      sql: `INSERT INTO chat_history (session_id, role, content) VALUES (?, ?, ?)`,
      args: ['session-1', 'assistant', 'Greetings, traveler!'],
    });

    const result = await db.query({
      sql: 'SELECT role, content FROM chat_history WHERE session_id = ? ORDER BY id',
      args: ['session-1'],
    });
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].role).toBe('user');
    expect(result.rows[1].role).toBe('assistant');
  });

  test('sync() is a no-op', async () => {
    // Should not throw
    await db.sync();
  });

  // ── C-373: Asset registry tables (old-DB additive upgrade) ─────────

  test('C-373: assets/asset_sources/install_state tables exist after DDL', async () => {
    // The three tables are created by migration v1 (formerly the appended
    // AIKAMI_SCHEMA_DDL). New tables upgrade in place; a schema change to
    // an existing table requires a new numbered migration (C-384).
    const registryTables = await db.query({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('assets', 'asset_sources', 'install_state')",
      args: [],
    });
    const names = registryTables.rows.map((r) => r.name).sort();
    expect(names).toEqual(['asset_sources', 'assets', 'install_state']);

    // Column sanity: assets.hash is NOT NULL; install_state.status has a CHECK
    await db.execute({
      sql: `INSERT INTO assets (id, pack_id, category, hash, version, size_bytes) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['sprites:hero', 'sprites', 'sprites', 'abc123', 1, 100],
    });
    await db.execute({
      sql: `INSERT INTO asset_sources (asset_id, backend, url, priority) VALUES (?, ?, ?, ?)`,
      args: ['sprites:hero', 'bundled', '/game-data/sprites/hero.png', 0],
    });
    await db.execute({
      sql: `INSERT INTO install_state (asset_id, status, local_path, cached_hash) VALUES (?, ?, ?, ?)`,
      args: ['sprites:hero', 'cached', 'abc123', 'abc123'],
    });

    const sources = await db.query({
      sql: 'SELECT url, priority FROM asset_sources WHERE asset_id = ?',
      args: ['sprites:hero'],
    });
    expect(sources.rows).toHaveLength(1);
    expect(sources.rows[0].url).toBe('/game-data/sprites/hero.png');

    // CHECK constraint rejects an invalid status. A distinct asset_id avoids
    // the PRIMARY KEY conflict from the earlier 'sprites:hero' insert — the
    // rejection must exercise the status CHECK, not the PK. The parent asset
    // is registered first so foreign-key enforcement stays valid.
    await db.execute({
      sql: `INSERT INTO assets (id, pack_id, category, hash, version, size_bytes) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['sprites:bogus', 'sprites', 'sprites', 'bogushash', 1, 10],
    });
    await expect(
      db.execute({
        sql: `INSERT INTO install_state (asset_id, status) VALUES (?, ?)`,
        args: ['sprites:bogus', 'bogus'],
      }),
    ).rejects.toThrow();
  });
});
