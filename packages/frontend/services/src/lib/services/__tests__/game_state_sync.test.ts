// packages/frontend/services/src/lib/services/__tests__/game_state_sync.test.ts
//
// Unit tests for GameStateSyncService after the C-385 AC-2 rehoming:
// slot metadata lives in the local `saves` table (never Data Connect),
// while the ECS blob stays in Firebase Storage. Verifies save → list →
// load → delete against a fake local database and a mocked Storage
// service.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { resolve } from 'node:path';
import type { LocalDatabaseInterface } from '@aikami/frontend/storage';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Absolute path of the frontend-storage package entry — used alongside the
 * bare specifier because Bun resolves tsconfig path aliases before checking
 * mock.module for bare specifiers. */
const STORAGE_INDEX_PATH = resolve(__dirname, '../../../../storage/src/index.ts');

/** In-memory fake of the local `saves` table for the service under test. */
class FakeLocalDatabase implements LocalDatabaseInterface {
  /** Row storage keyed by the `id` primary key. */
  rows = new Map<string, Record<string, unknown>>();

  async query(options: { sql: string; args: readonly unknown[] }): Promise<{
    rows: readonly Record<string, unknown>[];
  }> {
    const { sql, args } = options;
    if (sql.includes('SELECT slot_id, timestamp, map_name, payload FROM saves')) {
      const pattern = String(args[0] ?? '');
      const matches = [...this.rows.values()].filter((row) =>
        String(row.slot_id).startsWith(pattern.replace('%', '')),
      );
      return { rows: matches };
    }
    return { rows: [] };
  }

  async execute(options: { sql: string; args: readonly unknown[] }): Promise<void> {
    const { sql, args } = options;
    if (sql.includes('INSERT OR REPLACE INTO saves')) {
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

const storageUploadMock = mock(async (_path: string, _data: string) => ({}));
const storageDownloadMock = mock(async (_path: string) => '{"version":"1.0.0"}');
const storageDeleteMock = mock(async (_path: string) => {});

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
    storageUploadMock.mockClear();
    storageDownloadMock.mockClear();
    storageDeleteMock.mockClear();

    mock.module('@aikami/frontend/storage', () => ({
      getLocalDatabase: mock(async () => db as unknown as LocalDatabaseInterface),
    }));
    mock.module(STORAGE_INDEX_PATH, () => ({
      getLocalDatabase: mock(async () => db as unknown as LocalDatabaseInterface),
    }));
    mock.module('../../firebase/firebase_storage.ts', () => ({
      firebaseStorageService: {
        uploadString: storageUploadMock,
        downloadString: storageDownloadMock,
        deleteObject: storageDeleteMock,
      },
    }));

    service = await import('../game_state_sync.svelte.ts');
  });

  test('saveGame uploads the blob and upserts a local saves row with metadata', async () => {
    const storageRef = await service.gameStateSyncService.saveGame({
      uid: 'user-1',
      slot: 1,
      payload: VALID_SNAPSHOT,
      metadata: { lastLocationName: 'Village Square', playedTimeSeconds: 42 },
    });

    expect(storageRef).toBe('saves/user-1/slot_1.json');
    expect(storageUploadMock).toHaveBeenCalledWith('saves/user-1/slot_1.json', VALID_SNAPSHOT);

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

  test('saveGame rejects an invalid payload without uploading or writing a row', async () => {
    await expect(
      service.gameStateSyncService.saveGame({
        uid: 'user-1',
        slot: 1,
        payload: 'not-json',
      }),
    ).rejects.toThrow('saveGame:');

    expect(storageUploadMock).not.toHaveBeenCalled();
    expect(db.rows.size).toBe(0);
  });

  test('listSlots hydrates entries from the local saves table', async () => {
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

    const slots = await service.gameStateSyncService.listSlots({ uid: 'user-1' });

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      slotNumber: 1,
      lastLocationName: 'Village Square',
      playedTimeSeconds: 42,
      storageRef: 'saves/user-1/slot_1.json',
      updatedAt: new Date(1_700_000_000_000).toISOString(),
    });
  });

  test('loadGame reads the ECS blob from Firebase Storage', async () => {
    const payload = await service.gameStateSyncService.loadGame({ uid: 'user-1', slot: 1 });

    expect(storageDownloadMock).toHaveBeenCalledWith('saves/user-1/slot_1.json');
    expect(payload).toBe('{"version":"1.0.0"}');
  });

  test('deleteSlot removes the storage blob and the local row', async () => {
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

    expect(storageDeleteMock).toHaveBeenCalledWith('saves/user-1/slot_1.json');
    expect(db.rows.has('sync_slot_1')).toBe(false);
  });
});
