// apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts
//
// Turso/libSQL-backed save/load persistence for ECS snapshots.
// Replaces IndexedDB with the local SQLite database via LocalDatabaseInterface.
// Contract: C-321 Migrate Local Persistence to Turso

import type { EngineBridge } from '@aikami/frontend/engine';
import { getLocalDatabase } from '@aikami/frontend/repositories';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { hydrateAllServices, serializeAllServices } from './serializable_service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stable key prefix for save entries. */
const KEY_PREFIX = 'aikami_save_';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata for a single save slot displayed in the UI. */
export type SaveSlotInfo = {
  /** Unique slot identifier (e.g., 'auto-save', 'manual-1'). */
  id: string;
  /** Unix timestamp (ms) when the save was created. */
  timestamp: number;
  /** Display name of the map/location where the save was made. */
  mapName: string;
};

/** Internal save document shape persisted to SQLite. */
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
  /** Available save slots discovered in the local database. */
  readonly availableSaves: SaveSlotInfo[];

  /** Whether a save operation is currently in progress. */
  readonly isSaving: boolean;

  /** Whether a load operation is currently in progress. */
  readonly isLoading: boolean;

  /**
   * Scans the local database for stored snapshots and populates {@link availableSaves}.
   *
   * Call this on app startup so the UI can show existing saves.
   */
  fetchAvailableSaves(): Promise<void>;

  /**
   * Creates an ECS snapshot and persists it to the local database.
   *
   * @param slotId - A named slot identifier (default: 'auto-save').
   */
  saveGame(slotId?: string): Promise<void>;

  /**
   * Retrieves a saved snapshot from the local database and restores the ECS world.
   *
   * @param slotId - The slot identifier to load from.
   */
  loadGame(slotId: string): Promise<void>;

  /**
   * Deletes a saved snapshot from the local database.
   *
   * @param slotId - The slot identifier to delete.
   */
  deleteSave(slotId: string): Promise<void>;

  /**
   * Retrieves the raw snapshot payload from the local database without restoring it.
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

// ---------------------------------------------------------------------------
// GameSaveService
// ---------------------------------------------------------------------------

/**
 * Persists ECS world snapshots to the local Turso/libSQL database.
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
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT slot_id, timestamp, map_name FROM saves ORDER BY timestamp DESC',
      args: [],
    });

    this.availableSaves = result.rows.map((row) => ({
      id: row.slot_id as string,
      timestamp: row.timestamp as number,
      mapName: row.map_name as string,
    }));
  }

  /** @inheritdoc */
  async saveGame(slotId: string = 'auto-save'): Promise<void> {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;

    try {
      const ecsSnapshot = await this._getBridge().createSnapshot();
      const serviceSnapshots = serializeAllServices();
      const payload = JSON.stringify({ ecsSnapshot, serviceSnapshots });

      const id = `${KEY_PREFIX}${slotId}`;
      const timestamp = Date.now();

      const db = await getLocalDatabase();
      await db.execute({
        sql: `INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, slotId, null, timestamp, 'World', payload],
      });

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
      const db = await getLocalDatabase();
      const result = await db.query({
        sql: 'SELECT payload FROM saves WHERE id = ?',
        args: [`${KEY_PREFIX}${slotId}`],
      });

      if (result.rows.length === 0) {
        throw new Error(`Save not found: ${slotId}`);
      }

      const payload = result.rows[0].payload as string;
      const { ecsSnapshot, serviceSnapshots } = this._parsePayload(payload);
      await this._getBridge().restoreSnapshot(ecsSnapshot);
      if (serviceSnapshots) {
        hydrateAllServices(serviceSnapshots);
      }
    } finally {
      this.isLoading = false;
    }
  }

  /** @inheritdoc */
  async deleteSave(slotId: string): Promise<void> {
    const db = await getLocalDatabase();
    await db.execute({
      sql: 'DELETE FROM saves WHERE id = ?',
      args: [`${KEY_PREFIX}${slotId}`],
    });

    await this.fetchAvailableSaves();
  }

  /** @inheritdoc */
  async getSavePayload(slotId: string): Promise<string> {
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT payload FROM saves WHERE id = ?',
      args: [`${KEY_PREFIX}${slotId}`],
    });

    if (result.rows.length === 0) {
      throw new Error(`Save not found: ${slotId}`);
    }

    const payload = result.rows[0].payload as string;
    const { ecsSnapshot } = this._parsePayload(payload);
    return ecsSnapshot;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Parses a save payload — handles both legacy plain ECS snapshots
   * and the new JSON envelope with service snapshots.
   */
  private _parsePayload(raw: string): {
    ecsSnapshot: string;
    serviceSnapshots?: import('./serializable_service').ServiceSnapshot[];
  } {
    try {
      const envelope = JSON.parse(raw) as {
        ecsSnapshot: string;
        serviceSnapshots?: import('./serializable_service').ServiceSnapshot[];
      };
      if (envelope.ecsSnapshot) {
        return envelope;
      }
    } catch {
      // Not valid JSON — treat as legacy plain ECS snapshot
    }
    return { ecsSnapshot: raw };
  }

  /**
   * Returns the engine bridge, throwing if it was not provided.
   */
  private _getBridge(): EngineBridge {
    if (!this._bridge) {
      throw new Error('GameSaveService: engine bridge is required for save/load operations');
    }
    return this._bridge;
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
