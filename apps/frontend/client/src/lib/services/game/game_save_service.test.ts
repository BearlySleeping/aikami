// apps/frontend/client/src/lib/services/game/game_save_service.test.ts
// $state, $derived, and @aikami/frontend/services mock are provided by test_preload.ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { EngineBridge } from '@aikami/frontend/engine';

// ---------------------------------------------------------------------------
// Mock IndexedDB — lightweight in-memory implementation
// ---------------------------------------------------------------------------

// Re-use IDBDatabase mock across tests — recreated in beforeEach
let mockDB: {
  _stores: Map<string, Map<string, unknown>>;
  createObjectStore: (name: string) => void;
  transaction: (name: string) => { objectStore: (name: string) => MockIDBObjectStore };
  close: () => void;
};

const resetMockDB = (): void => {
  mockDB = {
    _stores: new Map(),
    createObjectStore(name: string): void {
      if (!this._stores.has(name)) {
        this._stores.set(name, new Map());
      }
    },
    transaction(name: string) {
      const store = this._stores.get(name);
      if (!store) {
        throw new Error(`Object store not found: ${name}`);
      }
      return { objectStore: () => new MockIDBObjectStore(store) };
    },
    close(): void {},
  };
  mockDB.createObjectStore('saves');
};

class MockIDBRequest {
  result: unknown = undefined;
  error: Error | null = null;
  source: MockIDBObjectStore | null = null;
  private _onsuccess: (() => void) | null = null;
  private _onerror: (() => void) | null = null;

  get onsuccess(): (() => void) | null {
    return this._onsuccess;
  }

  set onsuccess(handler: (() => void) | null) {
    this._onsuccess = handler;
    setTimeout(() => {
      if (handler) {
        handler();
      }
    }, 0);
  }

  get onerror(): (() => void) | null {
    return this._onerror;
  }

  set onerror(handler: (() => void) | null) {
    this._onerror = handler;
  }

  triggerSuccess(): void {
    if (this._onsuccess) {
      this._onsuccess();
    }
  }
}

class MockIDBObjectStore {
  constructor(private readonly _store: Map<string, unknown>) {}

  get(key: string): MockIDBRequest {
    const req = new MockIDBRequest();
    req.source = this;
    setTimeout(() => {
      req.result = this._store.get(key);
      req.triggerSuccess();
    }, 0);
    return req;
  }

  getAll(): MockIDBRequest {
    const req = new MockIDBRequest();
    req.source = this;
    setTimeout(() => {
      req.result = [...this._store.values()];
      req.triggerSuccess();
    }, 0);
    return req;
  }

  put(doc: unknown): MockIDBRequest {
    const req = new MockIDBRequest();
    req.source = this;
    setTimeout(() => {
      const typed = doc as { id: string };
      this._store.set(typed.id, doc);
      req.result = typed.id;
      req.triggerSuccess();
    }, 0);
    return req;
  }

  delete(key: string): MockIDBRequest {
    const req = new MockIDBRequest();
    req.source = this;
    setTimeout(() => {
      this._store.delete(key);
      req.triggerSuccess();
    }, 0);
    return req;
  }
}

// ---------------------------------------------------------------------------
// Mock EngineBridge
// ---------------------------------------------------------------------------

let mockSnapshotCalls = 0;
let mockRestoreCalls = 0;
let mockLastRestorePayload: string | undefined;

const resetMockBridge = (): void => {
  mockSnapshotCalls = 0;
  mockRestoreCalls = 0;
  mockLastRestorePayload = undefined;
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
    mockLastRestorePayload = snapshot;
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GameSaveService', () => {
  let bridge: EngineBridge;
  let originalIndexedDB: IDBFactory | undefined;

  beforeEach(() => {
    bridge = createMockBridge();
    resetMockDB();
    resetMockBridge();

    originalIndexedDB = globalThis.indexedDB;

    globalThis.indexedDB = {
      open: mock((_name: string, _version?: number) => {
        mockDB.createObjectStore('saves');
        const req = new MockIDBRequest();
        setTimeout(() => {
          req.result = mockDB;
          req.triggerSuccess();
        }, 0);
        return req as unknown as IDBOpenDBRequest;
      }),
    } as unknown as IDBFactory;
  });

  afterEach(() => {
    if (originalIndexedDB) {
      globalThis.indexedDB = originalIndexedDB;
    }
  });

  test('should initialize with empty saves list', async () => {
    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'TestSaveService',
      bridge,
    });

    expect(service.availableSaves).toEqual([]);
    expect(service.isSaving).toBe(false);
    expect(service.isLoading).toBe(false);
  });

  test('fetchAvailableSaves should return empty when IndexedDB is empty', async () => {
    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'TestSaveService',
      bridge,
    });

    await service.fetchAvailableSaves();
    expect(service.availableSaves).toEqual([]);
  });

  test('saveGame should ask the bridge for a snapshot and write to IndexedDB', async () => {
    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'TestSaveService',
      bridge,
    });

    await service.saveGame('manual-1');

    expect(mockSnapshotCalls).toBe(1);
    expect(service.isSaving).toBe(false);

    const store = mockDB._stores.get('saves');
    if (!store) {
      throw new Error('saves store not found');
    }
    const savedDoc = store.get('aikami_save_manual-1') as Record<string, unknown> | undefined;
    expect(savedDoc).toBeDefined();
    expect(savedDoc?.slotId).toBe('manual-1');
    expect(typeof savedDoc?.timestamp).toBe('number');
    // payload is a JSON string with nested JSON — check for version in escaped form
    const parsedPayload = JSON.parse(savedDoc?.payload as string) as Record<string, unknown>;
    expect(parsedPayload.ecsSnapshot).toContain('"version":"1.0.0"');
  });

  test('saveGame should default to auto-save when no slotId given', async () => {
    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'TestSaveService',
      bridge,
    });

    await service.saveGame();

    expect(mockSnapshotCalls).toBe(1);
    const store = mockDB._stores.get('saves');
    if (!store) {
      throw new Error('saves store not found');
    }
    expect(store.has('aikami_save_auto-save')).toBe(true);
  });

  test('saveGame should refresh availableSaves after saving', async () => {
    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'TestSaveService',
      bridge,
    });

    await service.saveGame('manual-1');

    expect(service.availableSaves.length).toBe(1);
    expect(service.availableSaves[0].id).toBe('manual-1');
    expect(service.availableSaves[0].mapName).toBe('World');
  });

  test('loadGame should read from IndexedDB and pass data to bridge', async () => {
    // Pre-populate IndexedDB with a save
    const store = mockDB._stores.get('saves');
    if (!store) {
      throw new Error('saves store not found');
    }
    store.set('aikami_save_test-slot', {
      id: 'aikami_save_test-slot',
      slotId: 'test-slot',
      timestamp: 1700000000000,
      mapName: 'TestMap',
      payload: '{"version":"1.0.0","timestamp":0,"entities":[1],"components":{}}',
    });

    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'TestSaveService',
      bridge,
    });

    await service.loadGame('test-slot');

    expect(mockRestoreCalls).toBe(1);
    expect(mockLastRestorePayload).toContain('"version":"1.0.0"');
    expect(service.isLoading).toBe(false);
  });

  test('loadGame should throw when save is not found', async () => {
    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'TestSaveService',
      bridge,
    });

    await expect(service.loadGame('nonexistent')).rejects.toThrow('Save not found');
  });

  test('deleteSave should remove from IndexedDB and refresh saves', async () => {
    const store = mockDB._stores.get('saves');
    if (!store) {
      throw new Error('saves store not found');
    }
    store.set('aikami_save_to-delete', {
      id: 'aikami_save_to-delete',
      slotId: 'to-delete',
      timestamp: 0,
      mapName: 'Map',
      payload: '{}',
    });

    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'TestSaveService',
      bridge,
    });

    await service.deleteSave('to-delete');

    expect(store.has('aikami_save_to-delete')).toBe(false);
    expect(service.availableSaves.length).toBe(0);
  });

  test('getSavePayload should return raw payload from IndexedDB', async () => {
    const store = mockDB._stores.get('saves');
    if (!store) {
      throw new Error('saves store not found');
    }
    store.set('aikami_save_test', {
      id: 'aikami_save_test',
      slotId: 'test',
      timestamp: 0,
      mapName: 'Map',
      payload: '{"version":"1.0.0"}',
    });

    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'TestSaveService',
      bridge,
    });

    const payload = await service.getSavePayload('test');
    expect(payload).toBe('{"version":"1.0.0"}');
  });

  test('saveGame should not allow concurrent saves', async () => {
    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'TestSaveService',
      bridge,
    });

    // Manually set isSaving to simulate concurrent call
    const rawService = service as unknown as { isSaving: boolean };
    rawService.isSaving = true;

    await service.saveGame();
    expect(mockSnapshotCalls).toBe(0);
  });

  test('should work without a bridge for read-only operations', async () => {
    const store = mockDB._stores.get('saves');
    if (!store) {
      throw new Error('saves store not found');
    }
    store.set('aikami_save_test', {
      id: 'aikami_save_test',
      slotId: 'test',
      timestamp: 0,
      mapName: 'Map',
      payload: '{"version":"1.0.0"}',
    });

    const { GameSaveService } = await import('./game_save_service.svelte');
    const service = new GameSaveService({
      className: 'ReadOnlySave',
    });

    await service.fetchAvailableSaves();
    expect(service.availableSaves.length).toBe(1);

    const payload = await service.getSavePayload('test');
    expect(payload).toBe('{"version":"1.0.0"}');

    // saveGame should throw without bridge
    await expect(service.saveGame()).rejects.toThrow('engine bridge is required');
  });
});
