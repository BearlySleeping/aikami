// apps/frontend/client/src/lib/services/game/game_save_service.test.ts
// $state, $derived, and @aikami/frontend/services mock are provided by test_preload.ts
//
// Contract: C-334 Make Local Save, Continue, Autosave, and Recovery Reliable
// Tests AC-1 (v2 envelope), AC-2 (manual save with metadata), AC-4 (corruption detection)

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { EngineBridge } from '@aikami/frontend/engine';

// test_preload.ts provides a fake getLocalDatabase() — the in-memory tables
// are reset on every module reload. We import the reset helper directly.

import { resetLocalDatabase } from '@aikami/frontend/storage';

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
  return new GameSaveService({
    className: 'TestSaveService',
    bridge,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GameSaveService (C-334)', () => {
  let bridge: EngineBridge;

  beforeEach(() => {
    bridge = createMockBridge();
    resetMockBridge();
    resetLocalDatabase();
  });

  afterEach(() => {
    // No cleanup needed — fake DB is reset on each test
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

    await service.saveGame();

    expect(mockSnapshotCalls).toBe(1);
    const saves = service.availableSaves;
    expect(saves.length).toBe(1);
    expect(saves[0].id).toBe('auto-save');
  });

  test('saveGame should default mapName to World', async () => {
    const service = await getService(bridge);

    await service.saveGame({ slotId: 'test' });

    expect(service.availableSaves[0].mapName).toBe('World');
  });

  test('saveGame should not allow concurrent saves', async () => {
    const service = await getService(bridge);

    // Manually set isSaving to simulate concurrent call
    const rawService = service as unknown as { isSaving: boolean };
    rawService.isSaving = true;

    await service.saveGame({ slotId: 'test' });
    expect(mockSnapshotCalls).toBe(0);
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
    const { sha256 } = await import('./game_save_service.svelte');
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

    await service.saveGame({ slotId: 'to-delete' });
    expect(service.availableSaves.length).toBe(1);

    await service.deleteSave('to-delete');

    expect(service.availableSaves.length).toBe(0);
  });

  // ── getSavePayload / getRawSavePayload ─────────────────────────────

  test('getSavePayload should return raw payload from database', async () => {
    const service = await getService(bridge);
    await service.saveGame({ slotId: 'test', campaignId: 'c1', mapName: 'Map' });

    const payload = await service.getSavePayload('test');
    expect(typeof payload).toBe('string');

    // Should be valid JSON with v3 envelope
    const parsed = JSON.parse(payload);
    expect(parsed.version).toBe(3);
    expect(typeof parsed.checksum).toBe('string');
    expect(parsed.checksum.length).toBe(64); // SHA-256 hex
  });

  test('getSavePayload should throw when save is not found', async () => {
    const service = await getService(bridge);

    await expect(service.getSavePayload('nonexistent')).rejects.toThrow('Save not found');
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
    await expect(service.saveGame({ slotId: 'test' })).rejects.toThrow('engine bridge is required');
  });

  // ── fetchAvailableSaves with campaign filter (C-334) ───────────────

  test('fetchAvailableSaves should filter by campaignId', async () => {
    const service = await getService(bridge);

    await service.saveGame({ slotId: 'manual-1', campaignId: 'camp-a', mapName: 'A' });
    await service.saveGame({ slotId: 'manual-2', campaignId: 'camp-b', mapName: 'B' });

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

  // ── sha256 utility ─────────────────────────────────────────────────

  test('sha256 should produce correct hash', async () => {
    const { sha256 } = await import('./game_save_service.svelte');
    const hash = await sha256('hello world');

    // Well-known SHA-256 of 'hello world' as hex
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(hash.length).toBe(64);
  });

  // ── parseSavePayloadEnvelope v3 ────────────────────────────────────

  test('parseSavePayloadEnvelope should surface map block for v3 payload', async () => {
    const { parseSavePayloadEnvelope } = await import('./game_save_service.svelte');

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

  test('parseSavePayloadEnvelope should handle v2 payload', async () => {
    const { parseSavePayloadEnvelope } = await import('./game_save_service.svelte');

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
    const { validateEnvelopeChecksum } = await import('./game_save_service.svelte');
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
    const { parseSavePayloadEnvelope } = await import('./game_save_service.svelte');

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
    const { parseSavePayloadEnvelope } = await import('./game_save_service.svelte');

    const result = parseSavePayloadEnvelope('plain ecs data');
    expect(result.ecsSnapshot).toBe('plain ecs data');
    expect(result.version).toBeUndefined();
    expect(result.checksumValid).toBe(true);
    expect(result.serviceSnapshots).toBeUndefined();
  });
});
