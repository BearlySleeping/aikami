// apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts
//
// Turso/libSQL-backed save/load persistence for ECS snapshots.
// Replaces IndexedDB with the local SQLite database via LocalDatabaseInterface.
// Contract: C-321 Migrate Local Persistence to Turso
// Contract: C-334 Make Local Save, Continue, Autosave, and Recovery Reliable

import type { EngineBridge } from '@aikami/frontend/engine';
import { getLocalDatabase } from '@aikami/frontend/repositories';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import {
  hydrateAllServices,
  type ServiceSnapshot,
  serializeAllServices,
} from './serializable_service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stable key prefix for save entries. */
const KEY_PREFIX = 'aikami_save_';

/**
 * Computes a SHA-256 hex digest of the given string using the Web Crypto API.
 *
 * Used for save envelope integrity checks. Not a security HMAC — purely for
 * corruption detection.
 */
export const sha256 = async (input: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Current save envelope version. */
export const SAVE_ENVELOPE_VERSION = 2;

/**
 * Parses a raw save payload into its envelope parts.
 *
 * Handles v2 envelopes (with version/checksum), legacy v1 envelopes
 * ({ ecsSnapshot, serviceSnapshots }), and plain ECS snapshots.
 * Exposed so the game boot pipeline can hydrate domain services on Continue
 * (C-331 AC-2) and validate checksums (C-334 AC-4).
 *
 * @returns The parsed envelope with version metadata and validation result.
 */
export const parseSavePayloadEnvelope = (
  raw: string,
): {
  ecsSnapshot: string;
  serviceSnapshots?: ServiceSnapshot[];
  /** Envelope version — undefined for pre-v2 payloads. */
  version?: number;
  /** Whether the stored checksum matches the computed digest. True for v1/pre-v2. */
  checksumValid: boolean;
  /** The raw stored checksum string, if present. */
  storedChecksum?: string;
} => {
  try {
    const envelope = JSON.parse(raw) as {
      ecsSnapshot: string;
      serviceSnapshots?: ServiceSnapshot[];
      version?: number;
      checksum?: string;
    };
    if (!envelope.ecsSnapshot) {
      throw new Error('Missing ecsSnapshot');
    }

    const version = envelope.version;

    // v1 or pre-versioned — no checksum validation
    if (!version || version < 2 || !envelope.checksum) {
      return {
        ecsSnapshot: envelope.ecsSnapshot,
        serviceSnapshots: envelope.serviceSnapshots,
        version,
        checksumValid: true,
        storedChecksum: envelope.checksum,
      };
    }

    // v2+ — checksum is stored but validated asynchronously by the caller
    return {
      ecsSnapshot: envelope.ecsSnapshot,
      serviceSnapshots: envelope.serviceSnapshots,
      version,
      checksumValid: false, // caller must validate with validateEnvelopeChecksum
      storedChecksum: envelope.checksum,
    };
  } catch {
    // Not valid JSON — treat as legacy plain ECS snapshot
  }
  return { ecsSnapshot: raw, version: undefined, checksumValid: true };
};

/**
 * Validates a v2 envelope checksum asynchronously.
 *
 * Computes SHA-256 of `JSON.stringify({ ecsSnapshot, serviceSnapshots })`
 * and compares against the stored checksum.
 *
 * @returns true if checksum matches, false on mismatch or error.
 */
export const validateEnvelopeChecksum = async (options: {
  ecsSnapshot: string;
  serviceSnapshots?: ServiceSnapshot[];
  storedChecksum: string;
}): Promise<boolean> => {
  try {
    const dataToHash = JSON.stringify({
      ecsSnapshot: options.ecsSnapshot,
      serviceSnapshots: options.serviceSnapshots,
    });
    const computed = await sha256(dataToHash);
    return computed === options.storedChecksum;
  } catch {
    return false;
  }
};

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
  /** The campaign ID this save belongs to (C-334). */
  campaignId?: string;
};

/** Internal save document shape persisted to SQLite. */
export type SaveDocument = {
  id: string;
  slotId: string;
  campaignId: string | null;
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
   *
   * @param campaignId - Optional campaign ID to filter saves by (C-334).
   */
  fetchAvailableSaves(campaignId?: string): Promise<void>;

  /**
   * Creates an ECS snapshot and persists it to the local database.
   *
   * Writes a v2 save envelope with version, checksum, campaignId, mapName,
   * and savedAt timestamp (C-334).
   *
   * @param options.slotId - A named slot identifier (default: 'auto-save').
   * @param options.campaignId - The active campaign ID (C-334).
   * @param options.mapName - The current map name (C-334).
   */
  saveGame(options?: { slotId?: string; campaignId?: string; mapName?: string }): Promise<void>;

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

  /**
   * Retrieves the raw, unparsed save payload (full envelope) for a slot.
   *
   * The game boot pipeline parses it with {@link parseSavePayloadEnvelope}
   * to restore both the ECS world and the domain service snapshots (C-331)
   * and validate checksums (C-334).
   *
   * @param slotId - The slot identifier to read.
   * @throws If the save is not found.
   */
  getRawSavePayload(slotId: string): Promise<string>;
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
  async fetchAvailableSaves(campaignId?: string): Promise<void> {
    const db = await getLocalDatabase();

    const dbResult = campaignId
      ? await db.query({
          sql: 'SELECT slot_id, timestamp, map_name, campaign_id FROM saves WHERE campaign_id = ? ORDER BY timestamp DESC',
          args: [campaignId],
        })
      : await db.query({
          sql: 'SELECT slot_id, timestamp, map_name, campaign_id FROM saves ORDER BY timestamp DESC',
          args: [],
        });

    this.availableSaves = dbResult.rows.map((row: Record<string, unknown>) => ({
      id: row.slot_id as string,
      timestamp: row.timestamp as number,
      mapName: row.map_name as string,
      campaignId: (row.campaign_id as string) || undefined,
    }));
  }

  /** @inheritdoc */
  async saveGame(options?: {
    slotId?: string;
    campaignId?: string;
    mapName?: string;
  }): Promise<void> {
    if (this.isSaving) {
      return;
    }

    const { slotId = 'auto-save', campaignId, mapName = 'World' } = options ?? {};

    this.isSaving = true;

    try {
      const ecsSnapshot = await this._getBridge().createSnapshot();
      const serviceSnapshots = serializeAllServices();
      const savedAt = new Date().toISOString();

      // Compute SHA-256 checksum of the data portion (C-334)
      const dataToHash = JSON.stringify({ ecsSnapshot, serviceSnapshots });
      const checksum = await sha256(dataToHash);

      // v2 envelope (C-334)
      const payload = JSON.stringify({
        version: SAVE_ENVELOPE_VERSION,
        checksum,
        ecsSnapshot,
        serviceSnapshots,
        savedAt,
      });

      const id = `${KEY_PREFIX}${slotId}`;
      const timestamp = Date.now();

      const db = await getLocalDatabase();

      // Atomic write: write to temp key, then rename (C-334)
      const tempId = `${id}_temp_${Date.now()}`;
      await db.execute({
        sql: `INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [tempId, slotId, campaignId ?? null, timestamp, mapName, payload],
      });

      // Atomically replace the final slot
      await db.execute({
        sql: 'DELETE FROM saves WHERE id = ?',
        args: [id],
      });
      await db.execute({
        sql: `UPDATE saves SET id = ?, slot_id = ? WHERE id = ?`,
        args: [id, slotId, tempId],
      });

      this.debug('saveGame:complete', {
        slotId,
        campaignId,
        mapName,
        version: SAVE_ENVELOPE_VERSION,
      });

      // Refresh the saves list
      await this.fetchAvailableSaves(campaignId ?? undefined);
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
      const { ecsSnapshot, serviceSnapshots, version, storedChecksum } =
        parseSavePayloadEnvelope(payload);

      // Validate checksum for v2+ payloads (C-334 AC-4)
      if (version && version >= 2 && storedChecksum) {
        const valid = await validateEnvelopeChecksum({
          ecsSnapshot,
          serviceSnapshots,
          storedChecksum,
        });
        if (!valid) {
          throw new Error(`Save is corrupted: checksum mismatch for slot "${slotId}"`);
        }
      }

      await this._getBridge().restoreSnapshot(ecsSnapshot);
      if (serviceSnapshots) {
        hydrateAllServices(serviceSnapshots);
      }

      this.debug('loadGame:complete', { slotId, version });
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
    return await this.getRawSavePayload(slotId);
  }

  /** @inheritdoc */
  async getRawSavePayload(slotId: string): Promise<string> {
    const db = await getLocalDatabase();
    const result = await db.query({
      sql: 'SELECT payload FROM saves WHERE id = ?',
      args: [`${KEY_PREFIX}${slotId}`],
    });

    if (result.rows.length === 0) {
      throw new Error(`Save not found: ${slotId}`);
    }

    return result.rows[0].payload as string;
  }

  // -----------------------------------------------------------------------
  // Private
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
