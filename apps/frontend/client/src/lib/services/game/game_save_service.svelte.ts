// apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts
//
// Turso/libSQL-backed save/load persistence for ECS snapshots.
// Replaces IndexedDB with the local SQLite database via LocalDatabaseInterface.
// Contract: C-321 Migrate Local Persistence to Turso
// Contract: C-334 Make Local Save, Continue, Autosave, and Recovery Reliable

import type { EngineBridge } from '@aikami/frontend/engine';
import type { CombatSessionCheckpoint } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import { getLocalDatabase } from '@aikami/frontend/storage';
import type { SaveSlotInfo } from '$types';
import { preflightCombatCheckpoint } from './game_save_combat_preflight.ts';
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
const SAVE_ENVELOPE_VERSION = 6;

/**
 * How long the save path waits for the engine's world-object block (C-531).
 *
 * A missing reply must never hang a save; the envelope simply omits the block.
 */
const WORLD_OBJECTS_REPLY_TIMEOUT_MS = 500;

type CombatCheckpointRequestResult =
  | { kind: 'ready'; checkpoint: CombatSessionCheckpoint | null; sessionRevision: number }
  | { kind: 'timeout' };

/**
 * How many times the save read barrier may retry before giving up (review F-B).
 *
 * Each attempt captures the ECS snapshot between two readings of the engine's
 * accepted-command boundary; agreement proves the parts belong to one boundary.
 * A fight that keeps advancing faster than the save can be captured is a real
 * refusal, not something to paper over.
 */
const SAVE_READ_BARRIER_ATTEMPTS = 4;

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

      // ── One coherent save boundary (review F-B) ─────────────────────────
      //
      // The ECS snapshot, the live combat checkpoint and the world-object block
      // used to be read separately, so combat could advance between them and the
      // save could mix revisions. Now the engine captures every combat-related
      // durable fact ATOMICALLY in one worker turn, the ECS snapshot is taken
      // between two readings of the engine's accepted-command boundary, and the
      // save is only written when the boundary did not move. A save that cannot
      // be captured coherently is skipped rather than written wrong.
      const captured = await this._captureCoherentSnapshot();
      if (captured.kind === 'timeout') {
        this.warn('saveGame:skipped-combat-checkpoint-timeout', {
          slotId,
          hint: 'Combat checkpoint capture timed out — save skipped to preserve the existing slot.',
        });
        return;
      }
      if (captured.kind === 'unstable') {
        this.warn('saveGame:skipped-unstable-boundary', {
          slotId,
          attempts: SAVE_READ_BARRIER_ATTEMPTS,
          hint: 'Combat advanced during every capture attempt — save skipped rather than mixing command boundaries.',
        });
        return;
      }
      const { ecsSnapshot, combat, world } = captured;
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
      // C-532 / review F7: the LIVE v2 combat checkpoint, captured atomically
      // with the world-object block by the engine in one worker turn.
      const dataToHash = JSON.stringify({
        ecsSnapshot,
        serviceSnapshots,
        map: mapWithVersion,
        world,
        combat,
      });
      const checksum = await sha256(dataToHash);
      const payload = JSON.stringify({
        version: SAVE_ENVELOPE_VERSION,
        checksum,
        ecsSnapshot,
        serviceSnapshots,
        map: mapWithVersion,
        ...(world === undefined ? {} : { world }),
        ...(combat === undefined ? {} : { combat }),
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
      const parsed = parseSavePayloadEnvelope(payload);
      const { ecsSnapshot, serviceSnapshots, version, storedChecksum, map, world, combat } = parsed;

      // ── Preflight (review F-B/F7): parse → validate → compatibility →
      // migrate → plan, ALL before anything in the running game is mutated. ──
      //
      // Previously the world was restored first and an unsupported rules
      // version, corrupt checkpoint, invalid run identity or migration failure
      // was discovered afterwards — leaving the live game partially changed.

      // 1. Integrity. Version-aware: v6 hashes include the combat checkpoint,
      //    v5 the world block, v3/v4 the map block, v2 neither.
      if (version && version >= 2) {
        if (!storedChecksum) {
          throw new Error(
            `Save is corrupted: version ${version} envelope is missing a checksum for slot "${slotId}"`,
          );
        }
        const valid = await validateEnvelopeChecksum({
          ecsSnapshot,
          serviceSnapshots,
          map,
          world,
          combat,
          storedChecksum,
          version,
        });
        if (!valid) {
          throw new Error(`Save is corrupted: checksum mismatch for slot "${slotId}"`);
        }
      }

      // 2. The nested combat checkpoint: real schema validation plus the
      //    canonical migration, so a corrupt or unsupported fight is refused
      //    while the world is still untouched.
      const preflight = preflightCombatCheckpoint({ checkpoint: combat });
      if (!preflight.ok) {
        this.warn('loadGame:combat-checkpoint-refused', {
          slotId,
          reason: preflight.reason,
          detail: preflight.detail,
        });
        throw new Error(
          `Save cannot be restored (${preflight.reason}): ${preflight.detail}. The original save was preserved.`,
        );
      }
      const plan = preflight.plan;

      // 3. Apply. Only now is the runtime touched, and every step is fed from
      //    the validated plan rather than from the raw envelope.
      await this._getBridge().restoreSnapshot(ecsSnapshot);
      // C-531 AC-7: seed the engine's persisted world-object block so the next
      // encounter in this world starts with the saved object state. A pre-531
      // save carries no block, which clears it rather than inventing state.
      this._getBridge().send({ type: 'WORLD_OBJECTS_RESTORED', worldObjects: world ?? null });
      // C-532 / review F7/F-B: install the validated LIVE combat checkpoint —
      // state, accepted-command journal, initial retry checkpoint and the
      // accepted-command boundary — or clear any live state when the save was
      // taken between encounters.
      if (plan === null) {
        this._getBridge().send({ type: 'COMBAT_CHECKPOINT_RESTORED', state: null });
      } else {
        this._getBridge().send({
          type: 'COMBAT_CHECKPOINT_RESTORED',
          state: plan.state,
          journal: plan.checkpoint.journal ?? null,
          initialCheckpoint: plan.checkpoint.initialCheckpoint ?? null,
          sessionRevision: plan.checkpoint.sessionRevision,
        });
      }
      if (serviceSnapshots) {
        hydrateAllServices(serviceSnapshots);
      }

      this.debug('loadGame:complete', {
        slotId,
        version,
        migratedFrom: plan?.migratedFrom ?? null,
      });
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
    const { ecsSnapshot, serviceSnapshots, version, storedChecksum, map, world, combat } =
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
        combat,
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
   * Asks the engine for the live v2 combat checkpoint (C-532, review F7).
   *
   * `checkpoint: null` means no encounter is running; a timeout is distinct so
   * the caller can preserve the existing save instead of writing a fight-less
   * snapshot over an in-progress one.
   */
  private async _requestCombatCheckpoint(): Promise<CombatCheckpointRequestResult> {
    const bridge = this._bridge;
    if (bridge === undefined || !bridge.isReady()) {
      return { kind: 'ready', checkpoint: null, sessionRevision: 0 };
    }
    const requestId = `combat-checkpoint:${Date.now()}:${++this._worldObjectRequestCounter}`;
    return new Promise<CombatCheckpointRequestResult>((resolve) => {
      let settled = false;
      const finish = (value: CombatCheckpointRequestResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      const timer = setTimeout(() => finish({ kind: 'timeout' }), WORLD_OBJECTS_REPLY_TIMEOUT_MS);
      const unsubscribe = bridge.on('COMBAT_SESSION_CHECKPOINT_READY', (event) => {
        if (event.requestId !== requestId) {
          return;
        }
        finish({
          kind: 'ready',
          checkpoint: event.checkpoint,
          sessionRevision: event.sessionRevision,
        });
      });
      bridge.send({ type: 'COMBAT_SESSION_CHECKPOINT_REQUESTED', requestId });
    });
  }

  /**
   * Re-reads only the engine's accepted-command boundary id (review F-B).
   *
   * The second half of the save read barrier. A missing reply is a timeout, so
   * a stalled worker can never be mistaken for a stable boundary.
   */
  private async _requestSessionRevision(): Promise<number | null> {
    const bridge = this._bridge;
    if (bridge === undefined || !bridge.isReady()) {
      return 0;
    }
    const requestId = `combat-session-revision:${Date.now()}:${++this._worldObjectRequestCounter}`;
    return new Promise<number | null>((resolve) => {
      let settled = false;
      const finish = (value: number | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), WORLD_OBJECTS_REPLY_TIMEOUT_MS);
      const unsubscribe = bridge.on('COMBAT_SESSION_REVISION_READY', (event) => {
        if (event.requestId !== requestId) {
          return;
        }
        finish(event.sessionRevision);
      });
      bridge.send({ type: 'COMBAT_SESSION_REVISION_REQUESTED', requestId });
    });
  }

  /**
   * Captures the ECS snapshot and the combat checkpoint at ONE accepted-command
   * boundary (review F-B).
   *
   * The engine's `sessionRevision` advances on every accepted combat transition.
   * The ECS snapshot is taken between two readings of it; only agreement proves
   * that the snapshot and the checkpoint describe the same boundary. On
   * disagreement the whole capture is retried, and a capture that never settles
   * is a refusal — never a save that silently mixes boundaries.
   */
  private async _captureCoherentSnapshot(): Promise<
    | {
        kind: 'ready';
        ecsSnapshot: string;
        combat: CombatSessionCheckpoint | undefined;
        world: SaveWorldBlock | undefined;
      }
    | { kind: 'timeout' }
    | { kind: 'unstable' }
  > {
    const bridge = this._getBridge();
    for (let attempt = 0; attempt < SAVE_READ_BARRIER_ATTEMPTS; attempt++) {
      const before = await this._requestCombatCheckpoint();
      if (before.kind === 'timeout') {
        return { kind: 'timeout' };
      }
      const ecsSnapshot = await bridge.createSnapshot('player');
      const after = await this._requestSessionRevision();
      if (after === null) {
        return { kind: 'timeout' };
      }
      if (after !== before.sessionRevision) {
        continue;
      }
      const checkpoint = before.checkpoint;
      const combat: CombatSessionCheckpoint | undefined =
        checkpoint === null
          ? undefined
          : { ...checkpoint, sessionRevision: before.sessionRevision };
      // C-531 AC-7: the world-object block rides the same atomic capture, so it
      // belongs to the same boundary as the combat checkpoint. The engine
      // returns the whole persisted block (bundle + committed state), so the
      // definition bundle is the one the encounter pinned — never today's pack.
      const world: SaveWorldBlock | undefined =
        checkpoint === null || checkpoint.worldObjects === null
          ? undefined
          : checkpoint.worldObjects;
      return { kind: 'ready', ecsSnapshot, combat, world };
    }
    return { kind: 'unstable' };
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
