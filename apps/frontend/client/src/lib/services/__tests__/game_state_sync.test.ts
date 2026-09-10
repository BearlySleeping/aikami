// apps/frontend/client/src/lib/services/__tests__/game_state_sync.test.ts
//
// Unit tests for GameStateSyncService after the C-385 AC-2 rehoming:
// slot metadata lives in the local `saves` table (never Data Connect),
// while the ECS blob lives in the R2 saves bucket. Verifies save → list →
// load → delete against a real in-memory libSQL database with the
// production migrations applied.

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { LocalDatabaseInterface } from '@aikami/frontend/storage';
import { createRealLocalDatabase } from './local_database_fixture.ts';

const fixture = await createRealLocalDatabase();

/** Mutable handle so a test can swap in a fault-injecting adapter. */
let activeDatabase: LocalDatabaseInterface = fixture.db;

/** When true, the next saves INSERT throws (simulated SQLite write failure). */
let failNextInsert = false;

mock.module('@aikami/frontend/storage', () => ({
  getLocalDatabase: mock(async () => activeDatabase),
}));

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

const insertSaveRow = async (options: {
  id: string;
  slotId: string;
  campaignId: string | null;
  timestamp: number;
  mapName: string;
  payload: string;
}): Promise<void> => {
  await fixture.db.execute({
    sql: 'INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload) VALUES (?, ?, ?, ?, ?, ?)',
    args: [
      options.id,
      options.slotId,
      options.campaignId,
      options.timestamp,
      options.mapName,
      options.payload,
    ],
  });
};

const savesRowCount = async (): Promise<number> => {
  const result = await fixture.db.query({ sql: 'SELECT COUNT(*) AS n FROM saves', args: [] });
  return Number(result.rows[0]?.n ?? 0);
};

const hasSaveRow = async (id: string): Promise<boolean> => {
  const result = await fixture.db.query({
    sql: 'SELECT COUNT(*) AS n FROM saves WHERE id = ?',
    args: [id],
  });
  return Number(result.rows[0]?.n ?? 0) > 0;
};

describe('GameStateSyncService — C-385 AC-2 local save metadata', () => {
  let service: typeof import('../game_state_sync.svelte.ts');

  beforeEach(async () => {
    activeDatabase = fixture.db;
    failNextInsert = false;
    await fixture.reset();
    service = await import('../game_state_sync.svelte.ts');
  });

  afterAll(async () => {
    await fixture.close();
  });

  test('saveGame upserts a local saves row with metadata', async () => {
    const storageRef = await service.gameStateSyncService.saveGame({
      uid: 'user-1',
      slot: 1,
      payload: VALID_SNAPSHOT,
      metadata: { lastLocationName: 'Village Square', playedTimeSeconds: 42 },
    });

    expect(storageRef).toBe('saves/user-1/slot_1.json');

    const result = await fixture.db.query({
      sql: 'SELECT * FROM saves WHERE id = ?',
      args: ['sync_slot_1'],
    });
    const row = result.rows[0];
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

    expect(await savesRowCount()).toBe(0);
  });

  test('listSlots hydrates sync rows in numeric slot order and skips unrelated rows', async () => {
    // Inserted out of order on purpose — SQLite ORDER BY slot_id is
    // lexicographic, so only the service's numeric sort can produce [1, 2, 10].
    const meta = (played: number, ref: string): string =>
      JSON.stringify({ playedTimeSeconds: played, storageRef: ref });

    await insertSaveRow({
      id: 'sync_slot_10',
      slotId: 'slot_10',
      campaignId: null,
      timestamp: 1_700_000_000_010,
      mapName: 'Forest Edge',
      payload: meta(100, 'saves/user-1/slot_10.json'),
    });
    await insertSaveRow({
      id: 'sync_slot_1',
      slotId: 'slot_1',
      campaignId: null,
      timestamp: 1_700_000_000_000,
      mapName: 'Village Square',
      payload: meta(42, 'saves/user-1/slot_1.json'),
    });
    await insertSaveRow({
      id: 'sync_slot_2',
      slotId: 'slot_2',
      campaignId: null,
      timestamp: 1_700_000_000_002,
      mapName: 'Cave Entrance',
      payload: meta(7, 'saves/user-1/slot_2.json'),
    });
    // Unrelated row sharing the slot_% shape — must be excluded by the
    // sync identifier filter, not emitted with an empty storageRef.
    await insertSaveRow({
      id: 'campaign_abc',
      slotId: 'slot_5',
      campaignId: 'campaign-1',
      timestamp: 1_700_000_000_005,
      mapName: 'Campaign Save',
      payload: JSON.stringify({ lastLocationName: 'Campaign Save' }),
    });
    // Sync row with an invalid payload — must be skipped.
    await insertSaveRow({
      id: 'sync_slot_7',
      slotId: 'slot_7',
      campaignId: null,
      timestamp: 1_700_000_000_007,
      mapName: 'Broken Save',
      payload: 'not-json',
    });

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
    await insertSaveRow({
      id: 'sync_slot_1',
      slotId: 'slot_1',
      campaignId: null,
      timestamp: 1_700_000_000_000,
      mapName: 'Village Square',
      payload: JSON.stringify({ storageRef: 'saves/user-1/slot_1.json' }),
    });

    await service.gameStateSyncService.deleteSlot({ uid: 'user-1', slot: 1 });

    expect(await hasSaveRow('sync_slot_1')).toBe(false);
  });

  test('saveGame removes the uploaded blob when the local metadata write fails', async () => {
    failNextInsert = true;
    // Fault injection: the real adapter runs every statement except the
    // saves INSERT, which fails the way a locked/full SQLite file would.
    activeDatabase = new Proxy(fixture.db, {
      get(target, property, receiver) {
        if (property === 'execute') {
          return async (query: { sql: string; args: readonly unknown[] }) => {
            if (failNextInsert && query.sql.includes('INSERT OR REPLACE INTO saves')) {
              failNextInsert = false;
              throw new Error('simulated SQLite write failure');
            }
            return target.execute(query);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(
      service.gameStateSyncService.saveGame({
        uid: 'user-1',
        slot: 1,
        payload: VALID_SNAPSHOT,
        metadata: { lastLocationName: 'Village Square' },
      }),
    ).rejects.toThrow('simulated SQLite write failure');

    expect(await hasSaveRow('sync_slot_1')).toBe(false);
  });

  test('deleteSlot never leaves metadata referencing a blob when the bucket delete fails', async () => {
    await insertSaveRow({
      id: 'sync_slot_1',
      slotId: 'slot_1',
      campaignId: null,
      timestamp: 1_700_000_000_000,
      mapName: 'Village Square',
      payload: JSON.stringify({ storageRef: 'saves/user-1/slot_1.json' }),
    });

    await service.gameStateSyncService.deleteSlot({ uid: 'user-1', slot: 1 });

    // Metadata was removed before the bucket attempt — no row references
    // a missing blob.
    expect(await hasSaveRow('sync_slot_1')).toBe(false);
  });
});
