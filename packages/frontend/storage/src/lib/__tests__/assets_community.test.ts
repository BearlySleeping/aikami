// packages/frontend/storage/src/lib/__tests__/assets_community.test.ts
//
// C-513 AC-4 / AC-11: importing an approved community asset into the local
// registry as an `r2` source, and surfacing collisions explicitly.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { registerCommunityAssetRow } from '../assets_community.ts';
import { AIKAMI_MIGRATIONS } from '../migrations.ts';
import { WasmStorageAdapter } from '../wasm_storage_adapter.ts';

const R2_BASE = 'https://assets.bearlysing.test';
const HASH = 'a1'.repeat(32);

const createDb = async (): Promise<WasmStorageAdapter> => {
  const db = new WasmStorageAdapter({ databasePath: ':memory:' });
  await db.open();
  for (const ddl of AIKAMI_MIGRATIONS[0].statements) {
    await db.execute({ sql: ddl, args: [] });
  }
  return db;
};

/** Inserts a pre-existing registry row (seed catalog or local generated). */
const insertRow = async (
  db: WasmStorageAdapter,
  options: { id: string; packId: string; hash: string; version?: number },
): Promise<void> => {
  await db.execute({
    sql: `INSERT INTO assets (id, pack_id, category, hash, version, size_bytes, license, attribution, tags_json)
          VALUES (?, ?, 'music', ?, ?, 4, 'unknown', 'seed', '[]')`,
    args: [options.id, options.packId, options.hash, options.version ?? 1],
  });
};

describe('registerCommunityAssetRow (AC-4)', () => {
  let db: WasmStorageAdapter;

  beforeEach(async () => {
    db = await createDb();
  });

  afterEach(async () => {
    await db.close();
  });

  test('writes the asset row and an r2 source at the content-addressed URL', async () => {
    const result = await registerCommunityAssetRow(db, {
      tag: 'music:community:tavern',
      hash: HASH,
      sizeBytes: 1024,
      category: 'music',
      url: `${R2_BASE}/assets/${HASH.slice(0, 2)}/${HASH}.ogg`,
      provenanceSource: 'original',
      license: 'CC-BY-4.0',
    });

    expect(result.imported).toBe(true);
    expect(result.version).toBe(1);

    const row = await db.query({
      sql: 'SELECT pack_id, hash, size_bytes, license FROM assets WHERE id = ?',
      args: ['music:community:tavern'],
    });
    expect(row.rows[0]?.pack_id).toBe('community');
    expect(row.rows[0]?.hash).toBe(HASH);
    expect(row.rows[0]?.license).toBe('CC-BY-4.0');

    const sources = await db.query({
      sql: 'SELECT backend, url, priority FROM asset_sources WHERE asset_id = ?',
      args: ['music:community:tavern'],
    });
    expect(sources.rows[0]?.backend).toBe('r2');
    expect(String(sources.rows[0]?.url)).toBe(`${R2_BASE}/assets/${HASH.slice(0, 2)}/${HASH}.ogg`);
    expect(Number(sources.rows[0]?.priority)).toBe(0);
  });

  test('re-importing identical bytes is idempotent', async () => {
    const input = {
      tag: 'sfx:community:coin',
      hash: HASH,
      sizeBytes: 512,
      category: 'sfx',
      url: `${R2_BASE}/assets/${HASH.slice(0, 2)}/${HASH}.ogg`,
      provenanceSource: 'original',
    };
    const first = await registerCommunityAssetRow(db, input);
    const second = await registerCommunityAssetRow(db, input);

    expect(first.version).toBe(1);
    expect(second.unchanged).toBe(true);
    expect(second.version).toBe(1);
    const rows = await db.query({
      sql: 'SELECT COUNT(*) AS count FROM asset_sources WHERE asset_id = ?',
      args: [input.tag],
    });
    expect(Number(rows.rows[0]?.count)).toBe(1);
  });
});

describe('import collisions are explicit (AC-11)', () => {
  let db: WasmStorageAdapter;

  beforeEach(async () => {
    db = await createDb();
  });

  afterEach(async () => {
    await db.close();
  });

  test('a curated (seed) tag is never shadowed', async () => {
    await insertRow(db, { id: 'music:seed:theme', packId: 'emberwatch', hash: 'b'.repeat(64) });
    const result = await registerCommunityAssetRow(db, {
      tag: 'music:seed:theme',
      hash: HASH,
      sizeBytes: 1024,
      category: 'music',
      url: `${R2_BASE}/assets/${HASH.slice(0, 2)}/${HASH}.ogg`,
      provenanceSource: 'original',
    });

    expect(result.imported).toBe(false);
    expect(result.collision?.kind).toBe('seed');
    expect(result.collision?.existingHash).toBe('b'.repeat(64));

    // Nothing changed.
    const row = await db.query({
      sql: 'SELECT pack_id, hash FROM assets WHERE id = ?',
      args: ['music:seed:theme'],
    });
    expect(row.rows[0]?.hash).toBe('b'.repeat(64));
    expect(row.rows[0]?.pack_id).toBe('emberwatch');
  });

  test('a local generated asset is not silently re-pointed', async () => {
    await insertRow(db, { id: 'music:local:theme', packId: 'generated', hash: 'c'.repeat(64) });
    const result = await registerCommunityAssetRow(db, {
      tag: 'music:local:theme',
      hash: HASH,
      sizeBytes: 1024,
      category: 'music',
      url: `${R2_BASE}/assets/${HASH.slice(0, 2)}/${HASH}.ogg`,
      provenanceSource: 'original',
    });

    expect(result.imported).toBe(false);
    expect(result.collision?.kind).toBe('local-generated');
    const row = await db.query({
      sql: 'SELECT hash FROM assets WHERE id = ?',
      args: ['music:local:theme'],
    });
    expect(row.rows[0]?.hash).toBe('c'.repeat(64));
  });

  test('an explicit version decision resolves the collision', async () => {
    await insertRow(db, {
      id: 'music:local:theme',
      packId: 'generated',
      hash: 'c'.repeat(64),
      version: 3,
    });
    await db.execute({
      sql: `INSERT INTO asset_sources (asset_id, backend, url, priority)
            VALUES (?, 'local-generated', 'local-generated:old', -1),
                   (?, 'self-hosted', 'https://mirror.test/old.ogg', 1)`,
      args: ['music:local:theme', 'music:local:theme'],
    });
    const result = await registerCommunityAssetRow(db, {
      tag: 'music:local:theme',
      hash: HASH,
      sizeBytes: 1024,
      category: 'music',
      url: `${R2_BASE}/assets/${HASH.slice(0, 2)}/${HASH}.ogg`,
      provenanceSource: 'original',
      collision: 'version',
    });

    expect(result.imported).toBe(true);
    expect(result.version).toBe(4);
    const row = await db.query({
      sql: 'SELECT hash, version FROM assets WHERE id = ?',
      args: ['music:local:theme'],
    });
    expect(row.rows[0]?.hash).toBe(HASH);
    expect(Number(row.rows[0]?.version)).toBe(4);
    const sources = await db.query({
      sql: 'SELECT backend FROM asset_sources WHERE asset_id = ? ORDER BY priority',
      args: ['music:local:theme'],
    });
    expect(sources.rows.map((source) => String(source.backend))).toEqual(['r2', 'self-hosted']);
  });
});
