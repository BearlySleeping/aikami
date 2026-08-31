// apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts
//
// Turso/libSQL-backed save/load persistence for ECS snapshots.
// Replaces IndexedDB with the local SQLite database via LocalDatabaseInterface.
// Contract: C-321 Migrate Local Persistence to Turso
// Contract: C-334 Make Local Save, Continue, Autosave, and Recovery Reliable

import type { EngineBridge } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { getLocalDatabase } from '@aikami/frontend/storage';
import type { SaveSlotInfo } from '$types';
import type { SaveMapBlock } from './game_save_envelope.ts';
import {
  parseSavePayloadEnvelope,
  sha256,
  validateEnvelopeChecksum,
} from './game_save_envelope.ts';
import { hydrateAllServices, serializeAllServices } from './serializable_service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stable key prefix for save entries. */
const KEY_PREFIX = 'aikami_save_';

/** Current save envelope version. */
const SAVE_ENVELOPE_VERSION = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
   * Writes a v3 save envelope with version, checksum, map block (packId,
   * mapId, playerX, playerY), campaignId, mapName, and savedAt timestamp.
   * v2 payloads remain loadable — they fall back to the starting map.
   *
   * 🔴 C-378: `map` is REQUIRED. A v3 save without map routing cannot be
   * restored (the boot has no tilemap/collision/portals to rebuild), and
   * writing one forces the world-scope snapshot fallback that corrupts the
   * profile. Callers that cannot produce a map block must SKIP the save
   * (the runtime guard does this) rather than write a broken envelope.
   *
   * @param options.slotId - A named slot identifier (default: 'auto-save').
   * @param options.campaignId - The active campaign ID (C-334).
   * @param options.mapName - The current map display name (C-334).
   * @param options.map - Map-routing block persisted in the envelope (v3+).
   */
  saveGame(options: {
    slotId?: string;
    campaignId?: string;
    mapName?: string;
    map: SaveMapBlock;
    /** Pack version to pin in the save (C-381 AC-3). */
    packVersion?: string;
    /** World seed for reproducible generation (C-381 AC-9). */
    worldSeed?: string;
  }): Promise<void>;

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
  async saveGame(options: {
    slotId?: string;
    campaignId?: string;
    mapName?: string;
    map: SaveMapBlock;
    packVersion?: string;
    worldSeed?: string;
  }): Promise<void> {
    if (this.isSaving) {
      return;
    }

    const {
      slotId = 'auto-save',
      campaignId,
      mapName = 'World',
      map,
      packVersion,
      worldSeed,
    } = options;

    this.isSaving = true;

    try {
      // C-378: never write a world-scope v3 save. Without map routing the
      // boot cannot rebuild the tilemap/collision/portals, and restoring a
      // full-world snapshot renders wall entities as sprites in a broken,
      // unplayable world (and the next auto-save re-writes the same corrupt
      // state forever). A missing map block only happens during an
      // early-boot autosave race or after a corrupt restore — skip the
      // write so the previous good save stays loadable; the auto-save
      // scheduler retries on the next tick.
      if (!map) {
        this.warn('saveGame:skipped-no-map-block', {
          slotId,
          hint: 'Map routing unavailable (engine not on a map yet or position unknown) — save skipped to avoid a world-scope snapshot that cannot be restored.',
        });
        return;
      }

      // Player-scoped snapshot — the map block in the envelope reconstructs
      // the world on load (map-authoritative restore, v3).
      const ecsSnapshot = await this._getBridge().createSnapshot('player');
      const serviceSnapshots = serializeAllServices();
      const savedAt = new Date().toISOString();

      // v4 envelope (C-381, pack version pinning + world seed)
      // Build the enriched map FIRST so the checksum covers the same shape
      // that gets persisted — including packVersion and worldSeed.
      const mapWithVersion = {
        ...map,
        ...(packVersion ? { packVersion } : {}),
        ...(worldSeed ? { worldSeed } : {}),
      };

      // Compute SHA-256 checksum of the data portion (C-334).
      // v3+ digests include the map block (with v4 fields when present) so
      // tampering with map routing is detected; v2 payloads hash the two
      // original fields only.
      const dataToHash = JSON.stringify({ ecsSnapshot, serviceSnapshots, map: mapWithVersion });
      const checksum = await sha256(dataToHash);
      const payload = JSON.stringify({
        version: SAVE_ENVELOPE_VERSION,
        checksum,
        ecsSnapshot,
        serviceSnapshots,
        map: mapWithVersion,
        savedAt,
      });

      const id = `${KEY_PREFIX}${slotId}`;
      const timestamp = Date.now();

      const db = await getLocalDatabase();

      // Atomic write (C-334): write to a temp key, then rename — all inside
      // ONE SQLite transaction so a crash mid-sequence can never destroy the
      // existing save (previously three sequential execute() calls could
      // leave the slot deleted between the DELETE and the UPDATE).
      const tempId = `${id}_temp_${Date.now()}`;
      await db.transaction([
        {
          sql: `INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [tempId, slotId, campaignId ?? null, timestamp, mapName, payload],
        },
        {
          sql: 'DELETE FROM saves WHERE id = ?',
          args: [id],
        },
        {
          sql: `UPDATE saves SET id = ?, slot_id = ? WHERE id = ?`,
          args: [id, slotId, tempId],
        },
      ]);

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
      const { ecsSnapshot, serviceSnapshots, version, storedChecksum, map } =
        parseSavePayloadEnvelope(payload);

      // Validate checksum for v2+ payloads (C-334 AC-4). Version-aware:
      // v3 hashes include the map block, v2 hashes do not.
      if (version && version >= 2 && storedChecksum) {
        const valid = await validateEnvelopeChecksum({
          ecsSnapshot,
          serviceSnapshots,
          map,
          storedChecksum,
          version,
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
