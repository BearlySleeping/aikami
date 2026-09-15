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
} from '@aikami/frontend/services/base';
import { getLocalDatabase } from '@aikami/frontend/storage';
import type { SaveSlotInfo } from '$types';
import type { SaveMapBlock, SaveWorldBlock } from './game_save_envelope.ts';
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
const SAVE_ENVELOPE_VERSION = 5;

/**
 * How long the save path waits for the engine's world-object block (C-531).
 *
 * A missing reply must never hang a save; the envelope simply omits the block.
 */
const WORLD_OBJECTS_REPLY_TIMEOUT_MS = 500;

type WorldObjectsRequestResult =
  | { kind: 'ready'; world: SaveWorldBlock | undefined }
  | { kind: 'timeout' };

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
   * Attaches (or replaces) the engine bridge used for snapshot save/load.
   * Called by the overlay once the game runtime bridge is available.
   */
  configureBridge(bridge: EngineBridge): void;

  /**
   * Detaches the engine bridge. Called on game dispose so a stale bridge
   * from a previous session is never reused.
   */
  clearBridge(): void;

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

  /**
   * Copies an existing persisted save to a new slot without touching the
   * engine bridge. The source envelope and checksum are validated first, so
   * a corrupt save can never be forked into a playable-looking slot.
   *
   * @param options.sourceSlotId - Existing slot to copy from.
   * @param options.targetSlotId - New slot to write to.
   * @param options.campaignId - Campaign to stamp on the copied row.
   * @param options.mapName - Display name override; defaults to the source row's.
   * @throws If the source is missing or fails checksum validation.
   */
  copySave(options: {
    sourceSlotId: string;
    targetSlotId: string;
    campaignId?: string;
    mapName?: string;
  }): Promise<void>;
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

  private _bridge: EngineBridge | undefined;

  /**
   * Bumped whenever the bridge changes identity (configure/clear). A save
   * enqueued under one bridge must not run against a later bridge.
   */
  private _bridgeEpoch = 0;

  /** Monotonic counter for world-object correlation ids (C-531). */
  private _worldObjectRequestCounter = 0;

  /** Serializes writes so overlapping save requests each complete. */
  private _saveQueue: Promise<void> = Promise.resolve();

  constructor(options: GameSaveServiceOptions) {
    super(options);
    this._bridge = options.bridge;
  }

  /** @inheritdoc */
  configureBridge(bridge: EngineBridge): void {
    this._bridge = bridge;
    this._bridgeEpoch++;
  }

  /** @inheritdoc */
  clearBridge(): void {
    this._bridge = undefined;
    // Invalidate queued saves so teardown can never leak a stale slot,
    // campaign, or snapshot into a later session's bridge.
    this._bridgeEpoch++;
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
    // Serialize writes: each request waits for the previous to settle, then
    // performs its own write. This makes the operation awaitable — a session
    // checkpoint gets an explicit outcome instead of a silent drop when an
    // auto-save is already in flight.
    const run = this._saveQueue.then(() => this._performSave(options, this._bridgeEpoch));
    this._saveQueue = run.catch(() => {});
    return run;
  }

  private async _performSave(
    options: {
      slotId?: string;
      campaignId?: string;
      mapName?: string;
      map: SaveMapBlock;
      packVersion?: string;
      worldSeed?: string;
    },
    epoch: number,
  ): Promise<void> {
    // The bridge was replaced or cleared while this save was queued — drop it
    // rather than run it against a different session's bridge.
    if (epoch !== this._bridgeEpoch) {
      this.warn('saveGame:skipped-bridge-invalidated', { slotId: options.slotId });
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
      // C-531 AC-7: the world-object block. Authored battlefield objects are
      // content, not ECS entities, so they are NOT inside `ecsSnapshot` — the
      // engine is asked for the block that outlived the encounter. `undefined`
      // (no authored objects, or the engine has none) omits the key entirely,
      // which keeps the digest stable for a world with no objects.
      const worldResult = await this._requestWorldObjects();
      if (worldResult.kind === 'timeout') {
        this.warn('saveGame:skipped-world-objects-timeout', {
          slotId,
          hint: 'World-object capture timed out — save skipped to preserve the existing slot.',
        });
        return;
      }
      const world = worldResult.world;

      const dataToHash = JSON.stringify({
        ecsSnapshot,
        serviceSnapshots,
        map: mapWithVersion,
        world,
      });
      const checksum = await sha256(dataToHash);
      const payload = JSON.stringify({
        version: SAVE_ENVELOPE_VERSION,
        checksum,
        ecsSnapshot,
        serviceSnapshots,
        map: mapWithVersion,
        ...(world === undefined ? {} : { world }),
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
      const { ecsSnapshot, serviceSnapshots, version, storedChecksum, map, world } =
        parseSavePayloadEnvelope(payload);

      // Validate checksum for v2+ payloads (C-334 AC-4). Version-aware:
      // v5 hashes include the world block, v3/v4 the map block, v2 neither.
      if (version && version >= 2 && storedChecksum) {
        const valid = await validateEnvelopeChecksum({
          ecsSnapshot,
          serviceSnapshots,
          map,
          world,
          storedChecksum,
          version,
        });
        if (!valid) {
          throw new Error(`Save is corrupted: checksum mismatch for slot "${slotId}"`);
        }
      }

      await this._getBridge().restoreSnapshot(ecsSnapshot);
      // C-531 AC-7: seed the engine's persisted world-object block so the next
      // encounter in this world starts with the saved object state. A pre-531
      // save carries no block, which clears it rather than inventing state.
      this._getBridge().send({ type: 'WORLD_OBJECTS_RESTORED', worldObjects: world ?? null });
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

  /** @inheritdoc */
  async copySave(options: {
    sourceSlotId: string;
    targetSlotId: string;
    campaignId?: string;
    mapName?: string;
  }): Promise<void> {
    const { sourceSlotId, targetSlotId, campaignId, mapName } = options;

    if (sourceSlotId === targetSlotId) {
      throw new Error('copySave: source and target slots must differ');
    }

    const db = await getLocalDatabase();
    const source = await db.query({
      sql: 'SELECT payload, map_name FROM saves WHERE id = ?',
      args: [`${KEY_PREFIX}${sourceSlotId}`],
    });
    if (source.rows.length === 0) {
      throw new Error(`Save not found: ${sourceSlotId}`);
    }

    const payload = source.rows[0].payload as string;
    const { ecsSnapshot, serviceSnapshots, version, storedChecksum, map, world } =
      parseSavePayloadEnvelope(payload);

    // Validate the source before copying — a forked slot must be restorable.
    // Any versioned (v2+) envelope must carry a checksum; a missing one is
    // treated as corruption, not as an unvalidated legacy save.
    if (version && version >= 2) {
      if (!storedChecksum) {
        throw new Error(
          `Save is corrupted: version ${version} envelope is missing a checksum for slot "${sourceSlotId}"`,
        );
      }
      const valid = await validateEnvelopeChecksum({
        ecsSnapshot,
        serviceSnapshots,
        map,
        world,
        storedChecksum,
        version,
      });
      if (!valid) {
        throw new Error(`Save is corrupted: checksum mismatch for slot "${sourceSlotId}"`);
      }
    }

    const resolvedMapName = mapName ?? ((source.rows[0].map_name as string | undefined) || '');
    await db.execute({
      sql: `INSERT OR REPLACE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        `${KEY_PREFIX}${targetSlotId}`,
        targetSlotId,
        campaignId ?? null,
        Date.now(),
        resolvedMapName,
        payload,
      ],
    });

    this.debug('copySave:complete', { sourceSlotId, targetSlotId });
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

  /**
   * Asks the engine for the world-object block that outlives the encounter
   * (C-531 AC-7).
   *
   * A null response is a valid empty world. A timeout is distinct so the caller
   * can preserve the existing save rather than overwrite it with incomplete
   * state. The round trip is bounded and single-shot.
   */
  private async _requestWorldObjects(): Promise<WorldObjectsRequestResult> {
    const bridge = this._bridge;
    // An unready bridge has no world, hence no world objects — asking would
    // only stall the save for the full reply timeout.
    if (bridge === undefined || !bridge.isReady()) {
      return { kind: 'ready', world: undefined };
    }
    const requestId = `world-objects:${Date.now()}:${++this._worldObjectRequestCounter}`;
    return new Promise<WorldObjectsRequestResult>((resolve) => {
      let settled = false;
      const finish = (value: WorldObjectsRequestResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      const timer = setTimeout(() => finish({ kind: 'timeout' }), WORLD_OBJECTS_REPLY_TIMEOUT_MS);
      const unsubscribe = bridge.on('WORLD_OBJECTS_READY', (event) => {
        if (event.requestId !== requestId) {
          return;
        }
        finish({ kind: 'ready', world: event.worldObjects ?? undefined });
      });
      bridge.send({ type: 'WORLD_OBJECTS_REQUESTED', requestId });
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
