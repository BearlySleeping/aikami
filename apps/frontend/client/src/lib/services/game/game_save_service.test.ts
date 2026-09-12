// apps/frontend/client/src/lib/services/game/game_save_service.test.ts
// $state, $derived are polyfilled by test_setup.ts
//
// Contract: C-334 Make Local Save, Continue, Autosave, and Recovery Reliable
// Tests AC-1 (v2 envelope), AC-2 (manual save with metadata), AC-4 (corruption detection)

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { EngineBridge } from '@aikami/frontend/engine';
import { createRealLocalDatabase } from '../__tests__/local_database_fixture.ts';

// Real in-memory libSQL database with the production migrations applied, so
// the save envelope is exercised against actual SQLite semantics.

const fixture = await createRealLocalDatabase();

mock.module('@aikami/frontend/storage', () => ({
  getLocalDatabase: mock(async () => fixture.db),
}));

import type { NarrativeEventServiceInterface } from './narrative_event_service.svelte.ts';
import type { ServiceSnapshot } from './serializable_service';

// ---------------------------------------------------------------------------
// Mock EngineBridge
// ---------------------------------------------------------------------------

let mockSnapshotCalls = 0;
let mockRestoreCalls = 0;
let _mockLastRestorePayload: string | undefined;

const resetMockBridge = (): void => {
  mockSnapshotCalls = 0;
  mockRestoreCalls = 0;
  _mockLastRestorePayload = undefined;
};

const MOCK_SNAPSHOT_PAYLOAD = JSON.stringify({
  version: '1.0.0',
  timestamp: Date.now(),
  entities: [1],
  components: {},
});

/** Valid map-routing block for v3 saves (C-378: required). */
const MAP_FIXTURE = { packId: 'emberwatch', mapId: 'village', playerX: 160, playerY: 192 };

const createMockBridge = (): EngineBridge => ({
  send: mock(() => {}),
  on: mock(() => (): void => {}),
  emit: mock(() => {}),
  isReady: mock(() => true),
  executeCommand: mock(() => {}),
  triggerMacro: mock(() => {}),

  async createSnapshot(): Promise<string> {
    mockSnapshotCalls++;
    return MOCK_SNAPSHOT_PAYLOAD;
  },

  async restoreSnapshot(snapshot: string): Promise<void> {
    mockRestoreCalls++;
    _mockLastRestorePayload = snapshot;
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getService = async (bridge?: EngineBridge) => {
  const { GameSaveService } = await import('./game_save_service.svelte');
  return GameSaveService.create({
    className: 'TestSaveService',
    bridge,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GameSaveService (C-334)', () => {
  let bridge: EngineBridge;
  let hydrateAllServices: (snapshots: ServiceSnapshot[]) => void;
  let narrativeEventService: NarrativeEventServiceInterface;

  beforeEach(async () => {
    bridge = createMockBridge();
    resetMockBridge();
    await fixture.reset();
    ({ hydrateAllServices } = await import('./serializable_service'));
    ({ narrativeEventService } = await import('./narrative_event_service.svelte.ts'));
  });

  afterEach(() => {
    // No cleanup needed — the real database is reset on each test
  });

  afterAll(async () => {
    await fixture.close();
  });

  // ── Initialization ─────────────────────────────────────────────────

  test('should initialize with empty saves list', async () => {
    const service = await getService(bridge);

    expect(service.availableSaves).toEqual([]);
    expect(service.isSaving).toBe(false);
    expect(service.isLoading).toBe(false);
  });

  test('fetchAvailableSaves should return empty when database is empty', async () => {
    const service = await getService(bridge);

    await service.fetchAvailableSaves();
    expect(service.availableSaves).toEqual([]);
  });

  // ── AC-1/AC-2: saveGame writes v3 envelope ─────────────────────────

  test('saveGame should write v3 envelope with version, checksum, and metadata', async () => {
    const service = await getService(bridge);

    await service.saveGame({
      slotId: 'manual-1',
      campaignId: 'camp-c1',
      mapName: 'Forest',
      map: { packId: 'emberwatch', mapId: 'village', playerX: 160, playerY: 192 },
    });

    expect(mockSnapshotCalls).toBe(1);
    expect(service.isSaving).toBe(false);
    expect(service.availableSaves.length).toBe(1);
    expect(service.availableSaves[0].id).toBe('manual-1');
    expect(service.availableSaves[0].mapName).toBe('Forest');
    expect(service.availableSaves[0].campaignId).toBe('camp-c1');
  });

  test('saveGame should default slotId to auto-save', async () => {
    const service = await getService(bridge);

    await service.saveGame({ map: MAP_FIXTURE });

    expect(mockSnapshotCalls).toBe(1);
    const saves = service.availableSaves;
    expect(saves.length).toBe(1);
    expect(saves[0].id).toBe('auto-save');
  });

  test('saveGame should default mapName to World', async () => {
    const service = await getService(bridge);

    await service.saveGame({ slotId: 'test', map: MAP_FIXTURE });

    expect(service.availableSaves[0].mapName).toBe('World');
  });

  test('saveGame serializes concurrent saves so each write completes', async () => {
    // Gate the first snapshot so we prove the second save does not start until
    // the first settles (real serialization), not merely that both finish.
    let releaseFirstSnapshot: (() => void) | undefined;
    const firstSnapshotGate = new Promise<void>((resolve) => {
      releaseFirstSnapshot = resolve;
    });
    let snapshotCalls = 0;
    const gatedBridge: EngineBridge = {
      ...createMockBridge(),
      async createSnapshot(): Promise<string> {
        snapshotCalls++;
        if (snapshotCalls === 1) {
          await firstSnapshotGate;
        }
        return MOCK_SNAPSHOT_PAYLOAD;
      },
    };
    const service = await getService(gatedBridge);

    // Fire two overlapping saves; the second must wait for the first.
    const first = service.saveGame({ slotId: 'concurrent-a', map: MAP_FIXTURE });
    const second = service.saveGame({ slotId: 'concurrent-b', map: MAP_FIXTURE });

    // Let the queue start the first save; the second must still be waiting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshotCalls).toBe(1);

    // Release the first save — only now may the second snapshot start.
    if (!releaseFirstSnapshot) {
      throw new Error('first snapshot gate was never created');
    }
    releaseFirstSnapshot();

    await Promise.all([first, second]);
    await service.fetchAvailableSaves();
    expect(snapshotCalls).toBe(2);
    expect(service.isSaving).toBe(false);
    expect(service.availableSaves.map((save) => save.id).sort()).toEqual([
      'concurrent-a',
      'concurrent-b',
    ]);
  });

  // ── C-378: never write a save without map routing ──────────────────

  test('saveGame without a map block is skipped and leaves prior saves intact', async () => {
    const service = await getService(bridge);

    // A valid save exists first.
    await service.saveGame({ slotId: 'auto-save', map: MAP_FIXTURE });
    expect(service.availableSaves.length).toBe(1);

    const callsBefore = mockSnapshotCalls;

    // A map-less save (the old world-scope fallback path) must NOT write.
    // Cast: `map` is type-required, but the runtime guard defends against
    // JS callers / `as any` escapes (C-378).
    await service.saveGame({
      slotId: 'auto-save',
      map: undefined as unknown as typeof MAP_FIXTURE,
    });

    expect(mockSnapshotCalls).toBe(callsBefore); // no snapshot requested
    // Re-read from the DATABASE (not the cached array): the skipped save
    // must leave the previously written save untouched on disk.
    await service.fetchAvailableSaves();
    const saves = service.availableSaves;
    expect(saves.length).toBe(1); // prior save untouched
    expect(saves[0].id).toBe('auto-save');
  });

  // ── AC-3: loadGame restores from save ──────────────────────────────

  test('loadGame should restore from a v3 save with checksum validation', async () => {
    const service = await getService(bridge);

    // Save first (creates v3 envelope with checksum)
    await service.saveGame({
      slotId: 'test-slot',
      campaignId: 'camp-1',
      mapName: 'TestMap',
      map: { packId: 'emberwatch', mapId: 'inn', playerX: 256, playerY: 344 },
    });

    // Reset bridge counters
    resetMockBridge();

    // Load
    await service.loadGame('test-slot');

    expect(mockRestoreCalls).toBe(1);
    expect(service.isLoading).toBe(false);
  });

  test('loadGame should still accept a v2 payload (no map block)', async () => {
    const { getLocalDatabase } = await import('@aikami/frontend/storage');
    const db = await getLocalDatabase();
    // Build a valid v2 envelope: checksum over { ecsSnapshot, serviceSnapshots } only
    const v2Data = JSON.stringify({ ecsSnapshot: MOCK_SNAPSHOT_PAYLOAD, serviceSnapshots: [] });
    const { sha256 } = await import('./game_save_envelope');
    const checksum = await sha256(v2Data);
    const v2Payload = JSON.stringify({
      version: 2,
      checksum,
      ecsSnapshot: MOCK_SNAPSHOT_PAYLOAD,
      serviceSnapshots: [],
      savedAt: new Date().toISOString(),
    });
    await db.execute({
      sql: 'INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['aikami_save_v2legacy', 'v2legacy', 'camp-1', Date.now(), 'OldMap', v2Payload],
    });

    const service = await getService(bridge);

    await service.loadGame('v2legacy');
    expect(mockRestoreCalls).toBe(1);
  });

  test('loadGame should throw when save is not found', async () => {
    const service = await getService(bridge);

    await expect(service.loadGame('nonexistent')).rejects.toThrow('Save not found');
  });

  // ── AC-4: Corruption detection ─────────────────────────────────────

  test('loadGame should detect corrupted v3 payload (checksum mismatch)', async () => {
    // Pre-populate with a tampered v3 payload (correct version, wrong checksum)
    const { getLocalDatabase } = await import('@aikami/frontend/storage');
    const db = await getLocalDatabase();
    const tamperedPayload = JSON.stringify({
      version: 3,
      checksum: '0000000000000000000000000000000000000000000000000000000000000000',
      ecsSnapshot: MOCK_SNAPSHOT_PAYLOAD,
      serviceSnapshots: [],
      map: { packId: 'emberwatch', mapId: 'village', playerX: 1, playerY: 2 },
      savedAt: new Date().toISOString(),
    });
    await db.execute({
      sql: 'INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['aikami_save_corrupt', 'corrupt', 'camp-1', Date.now(), 'Void', tamperedPayload],
    });

    const service = await getService(bridge);

    await expect(service.loadGame('corrupt')).rejects.toThrow('Save is corrupted');
  });

  test('loadGame should accept v1 payload (no checksum validation)', async () => {
    // Pre-populate with a v1-style payload (no version field)
    const { getLocalDatabase } = await import('@aikami/frontend/storage');
    const db = await getLocalDatabase();
    const v1Payload = JSON.stringify({
      ecsSnapshot: MOCK_SNAPSHOT_PAYLOAD,
      serviceSnapshots: [],
    });
    await db.execute({
      sql: 'INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['aikami_save_v1', 'v1', 'camp-1', Date.now(), 'OldMap', v1Payload],
    });

    const service = await getService(bridge);

    // Should load without throwing
    await service.loadGame('v1');
    expect(mockRestoreCalls).toBe(1);
  });

  test('loadGame should accept plain ECS snapshot', async () => {
    const { getLocalDatabase } = await import('@aikami/frontend/storage');
    const db = await getLocalDatabase();
    await db.execute({
      sql: 'INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['aikami_save_plain', 'plain', null, Date.now(), 'Plain', MOCK_SNAPSHOT_PAYLOAD],
    });

    const service = await getService(bridge);

    await service.loadGame('plain');
    expect(mockRestoreCalls).toBe(1);
  });

  // ── Delete ─────────────────────────────────────────────────────────

  test('deleteSave should remove from database and refresh saves', async () => {
    const service = await getService(bridge);

    await service.saveGame({ slotId: 'to-delete', map: MAP_FIXTURE });
    expect(service.availableSaves.length).toBe(1);

    await service.deleteSave('to-delete');

    expect(service.availableSaves.length).toBe(0);
  });

  // ── getSavePayload / getRawSavePayload ─────────────────────────────

  test('getSavePayload should return raw payload from database', async () => {
    const service = await getService(bridge);
    await service.saveGame({ slotId: 'test', campaignId: 'c1', mapName: 'Map', map: MAP_FIXTURE });

    const payload = await service.getSavePayload('test');
    expect(typeof payload).toBe('string');

    // Should be valid JSON with v4 envelope
    const parsed = JSON.parse(payload);
    expect(parsed.version).toBe(4);
    expect(typeof parsed.checksum).toBe('string');
    expect(parsed.checksum.length).toBe(64); // SHA-256 hex
  });

  test('getSavePayload should throw when save is not found', async () => {
    const service = await getService(bridge);

    await expect(service.getSavePayload('nonexistent')).rejects.toThrow('Save not found');
  });

  // ── AC-3 (C-381): v4 saves pin pack version + world seed ───────────

  test('v4 saves persist packVersion and worldSeed through the checksum', async () => {
    const service = await getService(bridge);

    await service.saveGame({
      slotId: 'v4-pin',
      campaignId: 'camp-v4',
      mapName: 'Emberwatch Village',
      map: { packId: 'emberwatch', mapId: 'village', playerX: 320, playerY: 576 },
      packVersion: '4.2.0',
      worldSeed: '1700000000',
    });

    const payload = await service.getSavePayload('v4-pin');
    const parsed = JSON.parse(payload) as {
      version: number;
      map: { packVersion?: string; worldSeed?: string };
    };
    expect(parsed.version).toBe(4);
    expect(parsed.map.packVersion).toBe('4.2.0');
    expect(parsed.map.worldSeed).toBe('1700000000');

    // The pinned revision round-trips through checksum validation on load.
    resetMockBridge();
    await service.loadGame('v4-pin');
    expect(mockRestoreCalls).toBe(1);
  });

  test('v4 checksum rejects a mutated packVersion before restoring', async () => {
    const service = await getService(bridge);

    await service.saveGame({
      slotId: 'v4-pack-version-tamper',
      campaignId: 'camp-v4',
      mapName: 'Emberwatch Village',
      map: { packId: 'emberwatch', mapId: 'village', playerX: 320, playerY: 576 },
      packVersion: '4.2.0',
      worldSeed: '1700000000',
    });

    const payload = await service.getSavePayload('v4-pack-version-tamper');
    const parsed = JSON.parse(payload) as {
      checksum: string;
      map: { packVersion?: string; worldSeed?: string };
    };
    const tamperedPayload = {
      ...parsed,
      map: { ...parsed.map, packVersion: '4.2.1' },
    };
    expect(tamperedPayload.checksum).toBe(parsed.checksum);
    await fixture.db.execute({
      sql: 'UPDATE saves SET payload = ? WHERE id = ?',
      args: [JSON.stringify(tamperedPayload), 'aikami_save_v4-pack-version-tamper'],
    });

    resetMockBridge();
    await expect(service.loadGame('v4-pack-version-tamper')).rejects.toThrow('Save is corrupted');
    expect(mockRestoreCalls).toBe(0);
  });

  test('v4 checksum rejects a mutated worldSeed before restoring', async () => {
    const service = await getService(bridge);

    await service.saveGame({
      slotId: 'v4-world-seed-tamper',
      campaignId: 'camp-v4',
      mapName: 'Emberwatch Village',
      map: { packId: 'emberwatch', mapId: 'village', playerX: 320, playerY: 576 },
      packVersion: '4.2.0',
      worldSeed: '1700000000',
    });

    const payload = await service.getSavePayload('v4-world-seed-tamper');
    const parsed = JSON.parse(payload) as {
      checksum: string;
      map: { packVersion?: string; worldSeed?: string };
    };
    const tamperedPayload = {
      ...parsed,
      map: { ...parsed.map, worldSeed: '1700000001' },
    };
    expect(tamperedPayload.checksum).toBe(parsed.checksum);
    await fixture.db.execute({
      sql: 'UPDATE saves SET payload = ? WHERE id = ?',
      args: [JSON.stringify(tamperedPayload), 'aikami_save_v4-world-seed-tamper'],
    });

    resetMockBridge();
    await expect(service.loadGame('v4-world-seed-tamper')).rejects.toThrow('Save is corrupted');
    expect(mockRestoreCalls).toBe(0);
  });

  // ── Read-only (no bridge) ──────────────────────────────────────────

  test('should work without a bridge for read-only operations', async () => {
    // Pre-populate with a save
    const { getLocalDatabase } = await import('@aikami/frontend/storage');
    const db = await getLocalDatabase();
    const payload = JSON.stringify({
      version: 2,
      checksum: 'abcd1234',
      ecsSnapshot: '{}',
      serviceSnapshots: [],
      savedAt: new Date().toISOString(),
    });
    await db.execute({
      sql: 'INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload) VALUES (?, ?, ?, ?, ?, ?)',
      args: ['aikami_save_readonly', 'readonly', 'camp-1', Date.now(), 'Map', payload],
    });

    const service = await getService(undefined); // no bridge

    await service.fetchAvailableSaves();
    expect(service.availableSaves.length).toBe(1);

    const rawPayload = await service.getSavePayload('readonly');
    expect(typeof rawPayload).toBe('string');

    // saveGame should throw without bridge
    await expect(service.saveGame({ slotId: 'test', map: MAP_FIXTURE })).rejects.toThrow(
      'engine bridge is required',
    );
  });

  // ── fetchAvailableSaves with campaign filter (C-334) ───────────────

  test('fetchAvailableSaves should filter by campaignId', async () => {
    const service = await getService(bridge);

    await service.saveGame({
      slotId: 'manual-1',
      campaignId: 'camp-a',
      mapName: 'A',
      map: MAP_FIXTURE,
    });
    await service.saveGame({
      slotId: 'manual-2',
      campaignId: 'camp-b',
      mapName: 'B',
      map: MAP_FIXTURE,
    });

    // Fetch all
    await service.fetchAvailableSaves();
    expect(service.availableSaves.length).toBe(2);

    // Fetch filtered
    await service.fetchAvailableSaves('camp-a');
    expect(service.availableSaves.length).toBe(1);
    expect(service.availableSaves[0].campaignId).toBe('camp-a');

    // Fetch non-existent campaign
    await service.fetchAvailableSaves('camp-nonexistent');
    expect(service.availableSaves.length).toBe(0);
  });

  // ── AC-4 (C-491): older saves load with an empty narrative event record ──

  test('AC-4 (C-491): an older save without a narrativeEvents snapshot resets the record', async () => {
    narrativeEventService.reset();
    narrativeEventService.record({
      campaignId: 'camp-1',
      kind: 'QuestResolved',
      informationKind: 'world_fact',
      summary: 'A quest was resolved.',
      actorId: 'npcA',
    });
    expect(narrativeEventService.events).toHaveLength(1);

    // A save written before this contract has no `narrativeEvents` snapshot.
    hydrateAllServices([]);

    expect(narrativeEventService.events).toHaveLength(0);
    expect(narrativeEventService.serialize().nextSequence).toBe(1);
  });

  // ── sha256 utility ─────────────────────────────────────────────────

  test('sha256 should produce correct hash', async () => {
    const { sha256 } = await import('./game_save_envelope');
    const hash = await sha256('hello world');

    // Well-known SHA-256 of 'hello world' as hex
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(hash.length).toBe(64);
  });

  // ── parseSavePayloadEnvelope v3 ────────────────────────────────────

  test('parseSavePayloadEnvelope should surface map block for v3 payload', async () => {
    const { parseSavePayloadEnvelope } = await import('./game_save_envelope');

    const raw = JSON.stringify({
      version: 3,
      checksum: 'abc123',
      ecsSnapshot: '{"entities":[]}',
      serviceSnapshots: [{ serviceKey: 'test', data: {} }],
      map: { packId: 'emberwatch', mapId: 'merchant_shop', playerX: 256, playerY: 344 },
      savedAt: '2024-01-01T00:00:00.000Z',
    });

    const result = parseSavePayloadEnvelope(raw);
    expect(result.ecsSnapshot).toBe('{"entities":[]}');
    expect(result.version).toBe(3);
    expect(result.storedChecksum).toBe('abc123');
    expect(result.checksumValid).toBe(false); // caller must validate async
    expect(result.serviceSnapshots).toHaveLength(1);
    expect(result.map).toEqual({
      packId: 'emberwatch',
      mapId: 'merchant_shop',
      playerX: 256,
      playerY: 344,
    });
  });

  test('parseSavePayloadEnvelope surfaces a v3 envelope WITHOUT map (C-378 corrupt-save shape)', async () => {
    const { parseSavePayloadEnvelope } = await import('./game_save_envelope');

    // The corrupt-save shape: v3 version + checksum but NO map block (the
    // old world-scope fallback wrote exactly this). The boot must NOT
    // legacy-restore it — it routes to a fresh spawn instead (C-378).
    const raw = JSON.stringify({
      version: 3,
      checksum: 'abc123',
      ecsSnapshot: '{"entities":[2,1,3]}',
      serviceSnapshots: [{ serviceKey: 'test', data: {} }],
      savedAt: '2024-01-01T00:00:00.000Z',
    });

    const result = parseSavePayloadEnvelope(raw);
    expect(result.version).toBe(3);
    expect(result.ecsSnapshot).toBe('{"entities":[2,1,3]}');
    expect(result.map).toBeUndefined();
  });

  test('parseSavePayloadEnvelope should handle v2 payload', async () => {
    const { parseSavePayloadEnvelope } = await import('./game_save_envelope');

    const raw = JSON.stringify({
      version: 2,
      checksum: 'abc123',
      ecsSnapshot: '{"entities":[]}',
      serviceSnapshots: [{ serviceKey: 'test', data: {} }],
      savedAt: '2024-01-01T00:00:00.000Z',
    });

    const result = parseSavePayloadEnvelope(raw);
    expect(result.ecsSnapshot).toBe('{"entities":[]}');
    expect(result.version).toBe(2);
    expect(result.storedChecksum).toBe('abc123');
    expect(result.checksumValid).toBe(false); // caller must validate async
    expect(result.serviceSnapshots).toHaveLength(1);
  });

  test('validateEnvelopeChecksum should be version-aware (v3 includes map, v2 does not)', async () => {
    const { sha256, validateEnvelopeChecksum } = await import('./game_save_envelope');
    const ecsSnapshot = '{"entities":[1]}';
    const serviceSnapshots = [];
    const map = { packId: 'emberwatch', mapId: 'village', playerX: 10, playerY: 20 };

    // v3 digest includes the map block
    const v3Data = JSON.stringify({ ecsSnapshot, serviceSnapshots, map });
    const v3Checksum = await sha256(v3Data);
    const v3Valid = await validateEnvelopeChecksum({
      ecsSnapshot,
      serviceSnapshots,
      map,
      storedChecksum: v3Checksum,
      version: 3,
    });
    expect(v3Valid).toBe(true);

    // The same checksum must NOT validate for v2 (different digest shape)
    const v2Valid = await validateEnvelopeChecksum({
      ecsSnapshot,
      serviceSnapshots,
      storedChecksum: v3Checksum,
      version: 2,
    });
    expect(v2Valid).toBe(false);

    // v2 digest without the map block validates against its own checksum
    const v2Data = JSON.stringify({ ecsSnapshot, serviceSnapshots });
    const v2Checksum = await sha256(v2Data);
    const v2ValidOk = await validateEnvelopeChecksum({
      ecsSnapshot,
      serviceSnapshots,
      storedChecksum: v2Checksum,
      version: 2,
    });
    expect(v2ValidOk).toBe(true);
  });

  test('parseSavePayloadEnvelope should handle v1 payload', async () => {
    const { parseSavePayloadEnvelope } = await import('./game_save_envelope');

    const raw = JSON.stringify({
      ecsSnapshot: '{"entities":[]}',
      serviceSnapshots: [],
    });

    const result = parseSavePayloadEnvelope(raw);
    expect(result.ecsSnapshot).toBe('{"entities":[]}');
    expect(result.version).toBeUndefined();
    expect(result.checksumValid).toBe(true); // v1 always valid
  });

  test('parseSavePayloadEnvelope should handle plain snapshot', async () => {
    const { parseSavePayloadEnvelope } = await import('./game_save_envelope');

    const result = parseSavePayloadEnvelope('plain ecs data');
    expect(result.ecsSnapshot).toBe('plain ecs data');
    expect(result.version).toBeUndefined();
    expect(result.checksumValid).toBe(true);
    expect(result.serviceSnapshots).toBeUndefined();
  });
});
