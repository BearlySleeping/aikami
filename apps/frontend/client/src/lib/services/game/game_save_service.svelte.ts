// apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts

import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// GameSaveService — IndexedDB save/load persistence for ECS snapshots
//
// Contract C-132: Wires the engine's ECS snapshot system to browser IndexedDB
// for persistent save/load across Tauri desktop application sessions.
// ---------------------------------------------------------------------------

/** IndexedDB database name for game saves. */
const DB_NAME = 'aikami_saves';

/** IndexedDB database version. */
const DB_VERSION = 1;

/** Object store name for save data. */
const STORE_NAME = 'saves';

/** Stable key prefix for save entries in IndexedDB. */
const KEY_PREFIX = 'aikami_save_';

/** Metadata for a single save slot displayed in the UI. */
export type SaveSlotInfo = {
  /** Unique slot identifier (e.g., 'auto-save', 'manual-1'). */
  id: string;
  /** Unix timestamp (ms) when the save was created. */
  timestamp: number;
  /** Display name of the map/location where the save was made. */
  mapName: string;
};

/** Internal IndexedDB document shape. Not part of the public interface. */
export type SaveDocument = {
  id: string;
  slotId: string;
  timestamp: number;
  mapName: string;
  payload: string;
};

/** Options for constructing a {@link GameSaveService}. */
export type GameSaveServiceOptions = BaseFrontendClassOptions & {
  /**
   * The engine bridge used to create and restore ECS snapshots.
   *
   * Optional — required only for {@link GameSaveServiceInterface.saveGame}
   * and {@link GameSaveServiceInterface.loadGame}. Can be omitted when the
   * service is used only for reading save metadata/payloads (e.g., from
   * the main menu).
   */
  bridge?: EngineBridge;
};

export type GameSaveServiceInterface = BaseFrontendClassInterface & {
  /** Available save slots discovered in IndexedDB. */
  readonly availableSaves: SaveSlotInfo[];

  /** Whether a save operation is currently in progress. */
  readonly isSaving: boolean;

  /** Whether a load operation is currently in progress. */
  readonly isLoading: boolean;

  /**
   * Scans IndexedDB for stored snapshots and populates {@link availableSaves}.
   *
   * Call this on app startup so the UI can show existing saves.
   */
  fetchAvailableSaves(): Promise<void>;

  /**
   * Creates an ECS snapshot and persists it to IndexedDB.
   *
   * @param slotId - A named slot identifier (default: 'auto-save').
   */
  saveGame(slotId?: string): Promise<void>;

  /**
   * Retrieves a saved snapshot from IndexedDB and restores the ECS world.
   *
   * @param slotId - The slot identifier to load from.
   */
  loadGame(slotId: string): Promise<void>;

  /**
   * Deletes a saved snapshot from IndexedDB.
   *
   * @param slotId - The slot identifier to delete.
   */
  deleteSave(slotId: string): Promise<void>;

  /**
   * Retrieves the raw snapshot payload from IndexedDB without restoring it.
   *
   * Used by the main menu to set a pending load before the game engine
   * is initialized. The payload is passed to GameWorld.initialize() as
   * initialPayload.
   *
   * @param slotId - The slot identifier to read.
   * @returns The raw ECS snapshot JSON string.
   * @throws If the save is not found.
   */
  getSavePayload(slotId: string): Promise<string>;
};

/**
 * Persists ECS world snapshots to browser IndexedDB.
 *
 * Instantiate via {@link GameSaveService.create}, never with `new`.
 *
 * The service holds a reference to the engine bridge for snapshotting,
 * but does NOT import any game-engine internals directly.
 */
class GameSaveService
  extends BaseFrontendClass<GameSaveServiceOptions>
  implements GameSaveServiceInterface
{
  availableSaves = $state<SaveSlotInfo[]>([]);
  isSaving = $state<boolean>(false);
  isLoading = $state<boolean>(false);

  private readonly _bridge: EngineBridge | undefined;

  constructor(options: GameSaveServiceOptions) {
    super(options);
    this._bridge = options.bridge;
  }

  /** @inheritdoc */
  async fetchAvailableSaves(): Promise<void> {
    const db = await this._openDatabase();
    try {
      const entries = await this._getAllDocuments(db);
      this.availableSaves = entries.map((doc) => ({
        id: doc.slotId,
        timestamp: doc.timestamp,
        mapName: doc.mapName,
      }));
    } finally {
      db.close();
    }
  }

  /** @inheritdoc */
  async saveGame(slotId: string = 'auto-save'): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;

    try {
      const payload = await this._getBridge().createSnapshot();

      const doc: SaveDocument = {
        id: `${KEY_PREFIX}${slotId}`,
        slotId,
        timestamp: Date.now(),
        mapName: 'World', // TODO: read from game state when scene system is wired
        payload,
      };

      const db = await this._openDatabase();
      try {
        await this._putDocument(db, doc);
      } finally {
        db.close();
      }

      // Refresh the saves list
      await this.fetchAvailableSaves();
    } finally {
      this.isSaving = false;
    }
  }

  /** @inheritdoc */
  async loadGame(slotId: string): Promise<void> {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;

    try {
      const db = await this._openDatabase();
      let doc: SaveDocument | undefined;

      try {
        doc = await this._getDocument(db, `${KEY_PREFIX}${slotId}`);
      } finally {
        db.close();
      }

      if (!doc) {
        throw new Error(`Save not found: ${slotId}`);
      }

      await this._getBridge().restoreSnapshot(doc.payload);
    } finally {
      this.isLoading = false;
    }
  }

  /** @inheritdoc */
  async deleteSave(slotId: string): Promise<void> {
    const db = await this._openDatabase();
    try {
      await this._deleteDocument(db, `${KEY_PREFIX}${slotId}`);
    } finally {
      db.close();
    }

    await this.fetchAvailableSaves();
  }

  /** @inheritdoc */
  async getSavePayload(slotId: string): Promise<string> {
    const db = await this._openDatabase();
    try {
      const doc = await this._getDocument(db, `${KEY_PREFIX}${slotId}`);
      if (!doc) {
        throw new Error(`Save not found: ${slotId}`);
      }
      return doc.payload;
    } finally {
      db.close();
    }
  }

  // -----------------------------------------------------------------------
  // Private: IndexedDB helpers
  // -----------------------------------------------------------------------

  /**
   * Returns the engine bridge, throwing if it was not provided.
   */
  private _getBridge(): EngineBridge {
    if (!this._bridge) {
      throw new Error('GameSaveService: engine bridge is required for save/load operations');
    }
    return this._bridge;
  }

  /**
   * Opens the IndexedDB database and ensures the object store exists.
   *
   * Promisified wrapper around the native IndexedDB API.
   */
  private _openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (): void => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (): void => {
        resolve(request.result);
      };

      request.onerror = (): void => {
        logger.error('GameSaveService: failed to open IndexedDB', request.error);
        reject(request.error ?? new Error('IndexedDB open failed'));
      };
    });
  }

  /**
   * Retrieves all save documents from the object store.
   */
  private _getAllDocuments(db: IDBDatabase): Promise<SaveDocument[]> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = (): void => {
        resolve(request.result as SaveDocument[]);
      };

      request.onerror = (): void => {
        reject(request.error ?? new Error('IndexedDB getAll failed'));
      };
    });
  }

  /**
   * Retrieves a single save document by its key.
   */
  private _getDocument(db: IDBDatabase, id: string): Promise<SaveDocument | undefined> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = (): void => {
        resolve(request.result as SaveDocument | undefined);
      };

      request.onerror = (): void => {
        reject(request.error ?? new Error('IndexedDB get failed'));
      };
    });
  }

  /**
   * Upserts a save document into the object store.
   */
  private _putDocument(db: IDBDatabase, doc: SaveDocument): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(doc);

      request.onsuccess = (): void => {
        resolve();
      };

      request.onerror = (): void => {
        reject(request.error ?? new Error('IndexedDB put failed'));
      };
    });
  }

  /**
   * Deletes a save document from the object store.
   */
  private _deleteDocument(db: IDBDatabase, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = (): void => {
        resolve();
      };

      request.onerror = (): void => {
        reject(request.error ?? new Error('IndexedDB delete failed'));
      };
    });
  }
}

export { GameSaveService };

/**
 * Shared service instance for reading save metadata without an engine bridge.
 *
 * Used by the main menu view model to check for existing saves.
 * For save/load operations that require the engine, create a separate
 * instance with the bridge injected.
 */
export const gameSaveService: GameSaveServiceInterface = GameSaveService.create({
  className: 'GameSaveService',
});
