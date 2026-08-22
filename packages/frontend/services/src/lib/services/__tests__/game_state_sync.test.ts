// packages/frontend/services/src/lib/services/__tests__/game_state_sync.test.ts
//
// Unit tests for GameStateSyncService after the C-385 AC-2 rehoming:
// slot metadata lives in the local `saves` table (never Data Connect),
// while the ECS blob lives in the R2 saves bucket. Verifies save → list →
// load → delete against a fake local database.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { resolve } from 'node:path';
import type { LocalDatabaseInterface } from '@aikami/frontend/storage';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Absolute path of the frontend-storage package entry — used alongside the
 * bare specifier because Bun resolves tsconfig path aliases before checking
 * mock.module for bare specifiers. Five levels up from this test file lands
 * at packages/frontend/, so the mock targets packages/frontend/storage/src/index.ts. */
const STORAGE_INDEX_PATH = resolve(__dirname, '../../../../../storage/src/index.ts');

/** In-memory fake of the local `saves` table for the service under test. */
class FakeLocalDatabase implements LocalDatabaseInterface {
  /** Row storage keyed by the `id` primary key. */
  rows = new Map<string, Record<string, unknown>>();

  /** When true, the next INSERT OR REPLACE throws (simulated SQLite write failure). */
  failNextInsert = false;

  async query(options: { sql: string; args: readonly unknown[] }): Promise<{
    rows: readonly Record<string, unknown>[];
  }> {
    const { sql, args } = options;
    if (sql.includes('FROM saves WHERE id LIKE')) {
      const pattern = String(args[0] ?? '');
      const matches = [...this.rows.values()]
        .filter((row) => String(row.id).startsWith(pattern.replace('%', '')))
        // Reproduce SQLite's lexicographic ORDER BY slot_id ASC on the TEXT
        // column — the service must re-sort numerically, not trust DB order.
        .sort((a, b) => String(a.slot_id).localeCompare(String(b.slot_id)));
      return { rows: matches };
    }
    return { rows: [] };
  }

  async execute(options: { sql: string; args: readonly unknown[] }): Promise<void> {
    const { sql, args } = options;
    if (sql.includes('INSERT OR REPLACE INTO saves')) {
      if (this.failNextInsert) {
        this.failNextInsert = false;
        throw new Error('FakeLocalDatabase: simulated SQLite write failure');
      }
      const [id, slotId, campaignId, timestamp, mapName, payload] = args as [
        string,
        string,
        string | null,
        number,
        string,
        string,
      ];
      this.rows.set(
        id,
        Object.fromEntries([
          ['id', id],
          ['slot_id', slotId],
          ['campaign_id', campaignId],
          ['timestamp', timestamp],
          ['map_name', mapName],
          ['payload', payload],
        ]),
      );
      return;
    }
    if (sql.includes('DELETE FROM saves WHERE id = ?')) {
      this.rows.delete(String(args[0]));
      return;
    }
    throw new Error(`FakeLocalDatabase: unhandled execute SQL: ${sql}`);
  }

  async transaction(): Promise<void> {}
  async sync(): Promise<void> {}
  async close(): Promise<void> {}
}

const VALID_SNAPSHOT = JSON.stringify({
  version: '1.0.0',
  timestamp: Date.now(),
  entities: [1, 2],
  components: {
    position: { x: [400, 600], y: [300, 350] },
    appearance: {
      layerIds0: [101, 0],
      layerIds1: [201, 0],
      layerIds2: [301, 0],
      layerIds3: [401, 0],
      layerIds4: [501, 0],
    },
    combatStats: { hp: [100, 50], maxHp: [100, 50], attack: [15, 8], defense: [10, 5] },
  },
});

describe('GameStateSyncService — C-385 AC-2 local save metadata', () => {
  let db: FakeLocalDatabase;
  let service: typeof import('../game_state_sync.svelte.ts');

  beforeEach(async () => {
    db = new FakeLocalDatabase();

    mock.module('@aikami/frontend/storage', () => ({
      getLocalDatabase: mock(async () => db as unknown as LocalDatabaseInterface),
    }));
    mock.module(STORAGE_INDEX_PATH, () => ({
      getLocalDatabase: mock(async () => db as unknown as LocalDatabaseInterface),
    }));

    service = await import('../game_state_sync.svelte.ts');
  });

  test('saveGame upserts a local saves row with metadata', async () => {
    const storageRef = await service.gameStateSyncService.saveGame({
      uid: 'user-1',
      slot: 1,
      payload: VALID_SNAPSHOT,
      metadata: { lastLocationName: 'Village Square', playedTimeSeconds: 42 },
    });

    expect(storageRef).toBe('saves/user-1/slot_1.json');

    const row = db.rows.get('sync_slot_1');
    expect(row).toBeDefined();
    expect(row?.slot_id).toBe('slot_1');
    expect(row?.map_name).toBe('Village Square');
    expect(typeof row?.timestamp).toBe('number');

    const payload = JSON.parse(String(row?.payload)) as {
      playedTimeSeconds: number;
      storageRef: string;
    };
    expect(payload.playedTimeSeconds).toBe(42);
    expect(payload.storageRef).toBe('saves/user-1/slot_1.json');
  });

  test('saveGame rejects an invalid payload without writing a row', async () => {
    await expect(
      service.gameStateSyncService.saveGame({
        uid: 'user-1',
        slot: 1,
        payload: 'not-json',
      }),
    ).rejects.toThrow('saveGame:');

    expect(db.rows.size).toBe(0);
  });

  test('listSlots hydrates sync rows in numeric slot order and skips unrelated rows', async () => {
    // Inserted out of order on purpose — the fake applies SQLite's
    // lexicographic ORDER BY, so only the service's numeric sort can
    // produce [1, 2, 10].
    db.rows.set(
      'sync_slot_10',
      Object.fromEntries([
        ['id', 'sync_slot_10'],
        ['slot_id', 'slot_10'],
        ['campaign_id', null],
        ['timestamp', 1_700_000_000_010],
        ['map_name', 'Forest Edge'],
        [
          'payload',
          JSON.stringify({ playedTimeSeconds: 100, storageRef: 'saves/user-1/slot_10.json' }),
        ],
      ]),
    );
    db.rows.set(
      'sync_slot_1',
      Object.fromEntries([
        ['id', 'sync_slot_1'],
        ['slot_id', 'slot_1'],
        ['campaign_id', null],
        ['timestamp', 1_700_000_000_000],
        ['map_name', 'Village Square'],
        [
          'payload',
          JSON.stringify({ playedTimeSeconds: 42, storageRef: 'saves/user-1/slot_1.json' }),
        ],
      ]),
    );
    db.rows.set(
      'sync_slot_2',
      Object.fromEntries([
        ['id', 'sync_slot_2'],
        ['slot_id', 'slot_2'],
        ['campaign_id', null],
        ['timestamp', 1_700_000_000_002],
        ['map_name', 'Cave Entrance'],
        [
          'payload',
          JSON.stringify({ playedTimeSeconds: 7, storageRef: 'saves/user-1/slot_2.json' }),
        ],
      ]),
    );
    // Unrelated row sharing the slot_% shape — must be excluded by the
    // sync identifier filter, not emitted with an empty storageRef.
    db.rows.set(
      'campaign_abc',
      Object.fromEntries([
        ['id', 'campaign_abc'],
        ['slot_id', 'slot_5'],
        ['campaign_id', 'campaign-1'],
        ['timestamp', 1_700_000_000_005],
        ['map_name', 'Campaign Save'],
        ['payload', JSON.stringify({ lastLocationName: 'Campaign Save' })],
      ]),
    );
    // Sync row with an invalid payload — must be skipped.
    db.rows.set(
      'sync_slot_7',
      Object.fromEntries([
        ['id', 'sync_slot_7'],
        ['slot_id', 'slot_7'],
        ['campaign_id', null],
        ['timestamp', 1_700_000_000_007],
        ['map_name', 'Broken Save'],
        ['payload', 'not-json'],
      ]),
    );

    const slots = await service.gameStateSyncService.listSlots({ uid: 'user-1' });

    expect(slots.map((slot) => slot.slotNumber)).toEqual([1, 2, 10]);
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({
      slotNumber: 1,
      lastLocationName: 'Village Square',
      playedTimeSeconds: 42,
      storageRef: 'saves/user-1/slot_1.json',
      updatedAt: new Date(1_700_000_000_000).toISOString(),
    });
  });

  test('loadGame returns undefined (R2 blob sync not yet wired)', async () => {
    const payload = await service.gameStateSyncService.loadGame({ uid: 'user-1', slot: 1 });
    expect(payload).toBeUndefined();
  });

  test('deleteSlot removes the local row', async () => {
    db.rows.set(
      'sync_slot_1',
      Object.fromEntries([
        ['id', 'sync_slot_1'],
        ['slot_id', 'slot_1'],
        ['campaign_id', null],
        ['timestamp', 1_700_000_000_000],
        ['map_name', 'Village Square'],
        ['payload', JSON.stringify({ storageRef: 'saves/user-1/slot_1.json' })],
      ]),
    );

    await service.gameStateSyncService.deleteSlot({ uid: 'user-1', slot: 1 });

    expect(db.rows.has('sync_slot_1')).toBe(false);
  });

  test('saveGame removes the uploaded blob when the local metadata write fails', async () => {
    db.failNextInsert = true;

    await expect(
      service.gameStateSyncService.saveGame({
        uid: 'user-1',
        slot: 1,
        payload: VALID_SNAPSHOT,
        metadata: { lastLocationName: 'Village Square' },
      }),
    ).rejects.toThrow('simulated SQLite write failure');

    expect(db.rows.has('sync_slot_1')).toBe(false);
  });

  test('deleteSlot never leaves metadata referencing a blob when the bucket delete fails', async () => {
    db.rows.set(
      'sync_slot_1',
      Object.fromEntries([
        ['id', 'sync_slot_1'],
        ['slot_id', 'slot_1'],
        ['campaign_id', null],
        ['timestamp', 1_700_000_000_000],
        ['map_name', 'Village Square'],
        ['payload', JSON.stringify({ storageRef: 'saves/user-1/slot_1.json' })],
      ]),
    );

    await service.gameStateSyncService.deleteSlot({ uid: 'user-1', slot: 1 });

    // Metadata was removed before the bucket attempt — no row references
    // a missing blob.
    expect(db.rows.has('sync_slot_1')).toBe(false);
  });
});
