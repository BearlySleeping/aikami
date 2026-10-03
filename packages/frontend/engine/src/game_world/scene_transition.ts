// packages/frontend/engine/src/game_world/scene_transition.ts
//
// Scene-transition orchestration, lifted out of the GameWorld facade.
//
// The runner owns the *sequence* of a map load — supersession generation,
// surface reset, scene preparation, rendering, worker round-trip, and the
// running/input/emit lifecycle — while every side-effecting collaborator is
// injected. It deliberately holds no PixiJS or DOM references, so the whole
// transition can be driven in a unit test with a fake session and a fake
// renderer. GameWorld supplies the real implementations and is otherwise a
// thin adapter.
//
// Supersession rule: a map switch bumps a generation counter; the runner
// re-checks it after every await. A superseded load never installs scene
// state, never resumes the engine, and never surfaces an error — the newer
// transition owns engine state.
//
// Recovery rule: a failed switch is NOT made good by flipping `running` back
// to true. Once the previous surface is torn down, "running" describes an
// empty world the player can still drive. The runner instead replays the last
// committed scene — surface, grids, worker payload — so the renderer and the
// worker agree again before input is handed back. When there is nothing to go
// back to (first boot) or the replay itself fails, the engine stays paused
// with input locked and an actionable error, which is a visible failure rather
// than a playable empty scene.

import type { PropContactShadow } from '@aikami/schemas';
import type { PackConfig } from '@aikami/types';
import {
  type AssetTagResolver,
  buildCollisionGrid,
  buildTerrainGridForMap,
  extractCollisionGrid,
  extractSpawnPointEntities,
  extractSpawnPoints,
  extractTransitionZones,
  type SpawnPoint,
  type SpawnPointEntity,
  type TilemapData,
  type TransitionZone,
} from '../assets/map_loader.ts';
import { loadMapCanonical } from '../assets/scene/scene_loader.ts';
import type { InteractableStateMap } from '../components/interactable_state.ts';
import { buildActorPathGrid } from '../systems/actor_footprint.ts';
import type { CollisionGrid } from '../systems/collision_system.ts';
import type { TerrainGrid } from '../systems/terrain_grid.ts';

/** Options accepted by {@link SceneTransitionRunner.load} (GameWorld.loadMap). */
export type LoadMapOptions = {
  mapUrl: string;
  targetX: number;
  targetY: number;
  defeatedEnemies?: string[];
  collectedPickups?: string[];
  interactableStates?: InteractableStateMap;
  targetSpawnHash?: number;
  defaultSpawnHash?: number;
  disableClamping?: boolean;
  /**
   * Resolved content-pack tile/prop definitions (C-376 AC-2). Posted to the
   * worker once per map load so the spawner can read prop walkability from
   * the manifest instead of the legacy propWalkability side channel.
   * `undefined` degrades gracefully — all props stay solid and the collision
   * grid falls back to the explicit collision layer.
   */
  packConfig?: PackConfig;
};

/**
 * Per-frame presentation metadata for a prop (C-378 AC-7, C-496/C-529).
 *
 * `anchorX`/`anchorY` are normalized ground/contact origin (0.5, 1 = bottom
 * centre). `renderWidth`/`renderHeight` are the authored logical world size in
 * pixels — deliberately separate from the texture's packed frame size so a
 * large preparation canvas never dictates the world footprint. `shadow` is the
 * renderer-owned contact shadow descriptor. All three are optional; absent
 * values keep the legacy behaviour (native texture size, bottom-centre anchor,
 * no shadow).
 */
export type PropFrameAnchor = {
  anchorX: number;
  anchorY: number;
  renderWidth?: number;
  renderHeight?: number;
  shadow?: PropContactShadow;
  /** C-545: light source exempt from the day/night ambient tint. */
  emissive?: boolean;
};

/**
 * A fully derived scene, ready to install and render. Produced by
 * {@link prepareScene}; contains no display objects so it is safe to hold,
 * assert on, and pass across test boundaries.
 */
export type PreparedScene = {
  packConfig?: PackConfig;
  tilemap: TilemapData;
  collisionGrid: CollisionGrid | undefined;
  terrainGrid: TerrainGrid;
  /** Footprint-aware copy of {@link terrainGrid} for click resolution. */
  activePathGrid: TerrainGrid;
  spawnPoints: SpawnPoint[];
  transitionZones: TransitionZone[];
  spawnPointEntities: SpawnPointEntity[];
  propFrameMeta: Map<string, PropFrameAnchor>;
  mapId: string;
  mapPixelWidth: number;
  mapPixelHeight: number;
};

/** Injected canonical loader (defaults to the real scene pipeline). */
export type SceneLoader = typeof loadMapCanonical;

/** Options for {@link prepareScene}. */
export type PrepareSceneOptions = {
  mapUrl: string;
  packConfig?: PackConfig;
  resolveTag?: AssetTagResolver;
  releaseUrl?: (url: string) => void;
  /** Override the canonical loader (tests). Defaults to `loadMapCanonical`. */
  loadMap?: SceneLoader;
};

/**
 * Raised when the pre-teardown checkpoint could not be captured. It stops the
 * switch BEFORE anything destructive happens, so the live world is untouched
 * and the failure path is a plain resume.
 */
export class SceneCheckpointUnavailableError extends Error {
  constructor() {
    super('Could not capture the world state before switching maps');
    this.name = 'SceneCheckpointUnavailableError';
  }
}

/** Sink for transition diagnostics. */
export type SceneTransitionLog = {
  debug: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
  error: (message: string, detail?: unknown) => void;
};

/**
 * The last scene that completed the whole transition, kept so a failed switch
 * can be undone instead of leaving the engine running on nothing.
 *
 * Note what this is NOT: it holds no runtime state. Replaying `options` only
 * re-seeds the world from the OLD load's spawn/target, which would reset a
 * player who had since moved, taken damage and changed equipment. The state
 * comes from the per-load checkpoint instead — see
 * {@link SceneTransitionDeps.captureCheckpoint} — so this record stays exactly
 * as large as the scene it restores.
 */
export type CommittedScene = {
  scene: PreparedScene;
  options: LoadMapOptions;
};

/**
 * Builds the per-frame presentation metadata from the pack's prop definitions.
 *
 * A frame can be declared by several props (e.g. one oak frame placed many
 * times). The first declaration that names a field wins, so differing
 * declarations cannot make the rendered size depend on object iteration order.
 */
const buildPropFrameMeta = (packConfig: PackConfig | undefined): Map<string, PropFrameAnchor> => {
  const meta = new Map<string, PropFrameAnchor>();
  for (const propDef of Object.values(packConfig?.props ?? {})) {
    const anchor = propDef.anchor ?? { x: 0.5, y: 1.0 };
    const existing = meta.get(propDef.frame);
    const renderWidth = existing?.renderWidth ?? propDef.renderSize?.width;
    const renderHeight = existing?.renderHeight ?? propDef.renderSize?.height;
    const shadow = existing?.shadow ?? propDef.shadow;
    // C-545: a frame is emissive if ANY prop that declares it is a light
    // source (OR across declarations), so a shared frame can never be tinted
    // for one placement and not another.
    const emissive = existing?.emissive ?? propDef.emissive ?? false;
    meta.set(propDef.frame, {
      anchorX: anchor.x,
      anchorY: anchor.y,
      ...(renderWidth === undefined ? {} : { renderWidth }),
      ...(renderHeight === undefined ? {} : { renderHeight }),
      ...(shadow === undefined ? {} : { shadow }),
      ...(emissive ? { emissive: true } : {}),
    });
  }
  return meta;
};

/**
 * Loads and derives one scene from a map URL through the canonical pipeline.
 *
 * Pure with respect to engine state: it returns a descriptor rather than
 * mutating the facade. The canonical loader is injectable so the derivation
 * (collision, terrain, path grid, spawns, prop anchors, map id) can be tested
 * without a network or a content pack.
 */
export const prepareScene = async (options: PrepareSceneOptions): Promise<PreparedScene> => {
  const { mapUrl, packConfig, resolveTag, releaseUrl } = options;
  const loadMap = options.loadMap ?? loadMapCanonical;

  // C-378 AC-1 / C-505 AC-1: the base terrain is the pack's lowest-precedence
  // fill; packless dev maps fall back to the legacy parse.
  const baseTerrain = packConfig?.terrains?.length
    ? [...packConfig.terrains].sort((a, b) => a.precedence - b.precedence)[0]?.name
    : undefined;

  const { tilemap } = await loadMap({
    url: mapUrl,
    resolveTag,
    releaseUrl,
    assetLock: 'pack:emberwatch',
    baseTerrain,
    terrains: packConfig?.terrains,
  });

  // C-376 AC-1 / C-378 AC-4: derive solidity from the manifest when a pack
  // config exists; otherwise fall back to the explicit collision layer.
  // Decor/overhead layers never contribute solidity, and an empty ground-band
  // list falls back to "all non-collision layers" rather than opening every
  // cell.
  const groundBandLayers = tilemap.terrain
    ? undefined // terrain-channel path ignores solidityLayers (AC-2)
    : tilemap.layers
        .filter((l) => (l.band ?? 'ground') === 'ground' && l.name !== 'collision')
        .map((l) => l.name);
  const solidityLayers =
    groundBandLayers && groundBandLayers.length > 0 ? groundBandLayers : undefined;
  const collisionGridData = packConfig
    ? buildCollisionGrid(tilemap, packConfig, { solidityLayers })
    : extractCollisionGrid(tilemap);
  const collisionGrid: CollisionGrid | undefined = collisionGridData
    ? {
        width: tilemap.width,
        height: tilemap.height,
        tileSize: tilemap.tilewidth,
        grid: collisionGridData,
      }
    : undefined;

  // C-379 AC-4: the authoritative TerrainGrid. Cost + blocksSight come from
  // the pack terrain defs when a terrain channel exists; legacy maps fall
  // back to the boolean grid with cost 0/16.
  const terrainGrid = buildTerrainGridForMap({
    tilemap,
    packConfig,
    collisionGrid,
  });

  // Stable map id for the worker (zone entity derivation — C-194 fix): same
  // filename → same id, regardless of pixel dimensions.
  const mapId = (mapUrl.split('/').pop() ?? mapUrl).replace(/\.json$/i, '');

  const propFrameMeta = buildPropFrameMeta(packConfig);

  return {
    packConfig,
    tilemap,
    collisionGrid,
    terrainGrid,
    activePathGrid: { ...terrainGrid, cost: buildActorPathGrid(terrainGrid) },
    spawnPoints: extractSpawnPoints(tilemap),
    transitionZones: extractTransitionZones(tilemap),
    spawnPointEntities: extractSpawnPointEntities(tilemap),
    propFrameMeta,
    mapId,
    mapPixelWidth: tilemap.width * tilemap.tilewidth,
    mapPixelHeight: tilemap.height * tilemap.tileheight,
  };
};

/**
 * Every side-effecting collaborator the runner needs. Grouped by concern so
 * the runner never sees a GameWorld or a mutable engine context.
 */
export type SceneTransitionDeps = {
  /** Load + derive a scene (real: {@link prepareScene}). */
  prepare: (options: PrepareSceneOptions) => Promise<PreparedScene>;
  /**
   * Render the scene graph and overlays. Must re-check `isCurrent()` after
   * any await and return `false` (releasing anything it built) when
   * superseded, `true` otherwise.
   */
  render: (scene: PreparedScene, isCurrent: () => boolean) => Promise<boolean>;
  /** Round-trip the scene to the simulation worker and await completion. */
  postLoadMap: (scene: PreparedScene, options: LoadMapOptions) => Promise<void>;
  /** Destroy the previous scene's display objects, bands, and active grids. */
  resetSurface: () => void;
  /** Install the prepared scene's active grids / anchors / interior flag. */
  installScene: (scene: PreparedScene) => void;
  /** Reset cross-scene interpolation history at a discontinuity. */
  onDiscontinuity: () => void;
  /**
   * Captures the AUTHORITATIVE runtime state (a full ECS snapshot) so a failed
   * destructive replacement can put it back.
   *
   * Called once per switch, after the replacement has parsed and immediately
   * BEFORE the previous surface is destroyed — the last moment the old world
   * still exists. Returns `undefined` when there is nothing to preserve (first
   * boot) or when the capture fails; the runner then refuses to tear down at
   * all rather than losing state it could not save.
   */
  captureCheckpoint: () => Promise<string | undefined>;
  /**
   * Rehydrates the world from a checkpoint after the previous surface has been
   * restored.
   *
   * Deliberately does NOT supersede the in-flight transition: this runs inside
   * the recovery itself, so invalidating the generation would abandon the
   * recovery halfway and hand a half-restored world to the player.
   */
  restoreCheckpoint: (payload: string) => Promise<void>;
  setRunning: (running: boolean) => void;
  setInputLocked: (locked: boolean) => void;
  emitMapLoaded: () => void;
  emitMapEntered: (mapUrl: string) => void;
  emitError: (message: string) => void;
  log: SceneTransitionLog;
};

/**
 * Owns the map-transition lifecycle and its supersession generation.
 *
 * Construct once per GameWorld; call {@link load} for each map. Use
 * {@link invalidateInFlight} for restores that must supersede a pending load.
 */
export class SceneTransitionRunner {
  private readonly _deps: SceneTransitionDeps;
  private _generation = 0;
  private _disposed = false;
  /** Last fully committed scene, or `undefined` before the first success. */
  private _committed: CommittedScene | undefined;

  constructor(deps: SceneTransitionDeps) {
    this._deps = deps;
  }

  /** Current supersession generation (test/diagnostic visibility). */
  get generation(): number {
    return this._generation;
  }

  /** True once {@link dispose} has run. */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Advances the generation so any in-flight load becomes stale. Called by
   * full-world / player restores, which are scene discontinuities of their
   * own.
   */
  invalidateInFlight(): void {
    this._generation++;
  }

  /**
   * Permanently retires the runner. Supersedes every in-flight load AND
   * forbids the failure path from resuming or unlocking: after the facade has
   * torn the engine down, a late transition must not hand a dead world back
   * to the player (or to a worker that has already been terminated).
   */
  dispose(): void {
    this._disposed = true;
    this._generation++;
    this._committed = undefined;
  }

  /**
   * Runs one map transition. Resolves when the scene is live, or returns
   * silently when superseded by a newer transition. Only the newest
   * transition may resume the engine or surface an error.
   */
  async load(options: LoadMapOptions): Promise<void> {
    if (this._disposed) {
      this._deps.log.debug('loadMap:ignored-disposed', { mapUrl: options.mapUrl });
      return;
    }

    const { mapUrl } = options;
    this._deps.log.debug('loadMap', {
      mapUrl,
      targetX: options.targetX,
      targetY: options.targetY,
      disableClamping: options.disableClamping,
    });

    const generation = ++this._generation;
    this._deps.onDiscontinuity();

    // The runtime state captured immediately before THIS load tore the world
    // down. It belongs to the load, not to the last commit: a switch taken
    // minutes after the last successful map load still has to come back to
    // where the player is NOW, not where they were then.
    let checkpoint: string | undefined;

    try {
      const scene = await this._prepareAndCheckpoint({
        options,
        generation,
        capture: (into) => {
          checkpoint = into;
        },
      });
      if (scene === undefined) {
        return; // superseded, or abandoned before anything was destroyed
      }

      // Past this point the previous world is unrecoverable without the
      // checkpoint, so every failure goes through the replay path. A `false`
      // result means the transition was superseded mid-flight: touch nothing.
      const installed = await this._installReplacement({ scene, options, generation });
      if (!installed || this._isStale(generation)) {
        return;
      }

      this._committed = { scene, options };
      this._deps.setRunning(true);
      this._deps.setInputLocked(false);
      this._deps.emitMapLoaded();
      this._deps.emitMapEntered(mapUrl);
      this._deps.log.debug('loadMap:complete');
    } catch (error) {
      await this._handleFailure({ generation, options, checkpoint, error });
    }
  }

  /**
   * The non-destructive half of a switch: pause, parse, and capture the state
   * that must survive a teardown.
   *
   * Returns `undefined` when the load was superseded, or when the checkpoint
   * could not be captured and the switch was therefore abandoned BEFORE
   * destroying anything — losing unsaved progress to a failed backup is
   * strictly worse than not switching maps at all.
   */
  private async _prepareAndCheckpoint(options: {
    options: LoadMapOptions;
    generation: number;
    capture: (checkpoint: string) => void;
  }): Promise<PreparedScene | undefined> {
    const { mapUrl, packConfig } = options.options;

    this._deps.setRunning(false);
    this._deps.setInputLocked(true);

    const scene = await this._deps.prepare({ mapUrl, packConfig });
    if (this._isStale(options.generation)) {
      this._deps.log.debug('loadMap:superseded-after-parse', { mapUrl });
      return undefined;
    }

    const checkpoint = await this._deps.captureCheckpoint();
    if (this._isStale(options.generation)) {
      this._deps.log.debug('loadMap:superseded-after-checkpoint', { mapUrl });
      return undefined;
    }
    if (checkpoint === undefined) {
      throw new SceneCheckpointUnavailableError();
    }

    options.capture(checkpoint);
    return scene;
  }

  /**
   * The destructive half: tear the old surface down, install the replacement,
   * render it, and round-trip to the worker.
   *
   * Returns `false` when the transition was superseded mid-flight — the caller
   * must then touch no engine state at all.
   */
  private async _installReplacement(options: {
    scene: PreparedScene;
    options: LoadMapOptions;
    generation: number;
  }): Promise<boolean> {
    const { scene, generation } = options;

    this._deps.resetSurface();
    this._deps.installScene(scene);

    const rendered = await this._deps.render(scene, () => generation === this._generation);
    if (!rendered || this._isStale(generation)) {
      this._deps.log.debug('loadMap:superseded-after-render');
      return false;
    }

    await this._deps.postLoadMap(scene, options.options);
    if (this._isStale(generation)) {
      this._deps.log.debug('loadMap:superseded-after-worker');
      return false;
    }

    return true;
  }

  /**
   * Routes one failure to the semantics its stage allows: a superseded load
   * says nothing at all, a pre-teardown failure retains or holds, and a
   * destructive failure replays the scene and rehydrates the checkpoint.
   */
  private async _handleFailure(context: {
    generation: number;
    options: LoadMapOptions;
    checkpoint: string | undefined;
    error: unknown;
  }): Promise<void> {
    const { generation, checkpoint, error } = context;
    const mapUrl = context.options.mapUrl;

    if (this._isStale(generation)) {
      this._deps.log.debug('loadMap:superseded-error', { mapUrl, generation });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    // `checkpoint` is set exactly when the teardown happened.
    const destructive = checkpoint !== undefined;
    this._deps.log.error('loadMap:failed', { mapUrl, error: message, destructive });

    if (destructive) {
      await this._recoverFromFailure({ generation, mapUrl, error: message, checkpoint });
    } else {
      this._retainPreviousWorld({ generation, mapUrl, error: message });
    }
    throw error;
  }

  /**
   * Failure BEFORE any teardown: the previous world is still whole and
   * consistent on screen AND in the worker, so retaining and resuming it IS
   * the recovery — re-loading it would only re-seed spawns and discard
   * progress. First boot has no previous world to retain, so it holds.
   */
  private _retainPreviousWorld(context: {
    generation: number;
    mapUrl: string;
    error: string;
  }): void {
    if (!this._committed) {
      this._deps.log.warn('loadMap:first-boot-failed', { mapUrl: context.mapUrl });
      if (!this._isStale(context.generation)) {
        this._holdLocked({ mapUrl: context.mapUrl, error: context.error });
      }
      return;
    }

    this._deps.log.warn('loadMap:retained-previous-scene', {
      mapUrl: context.mapUrl,
      error: context.error,
    });
    if (this._isStale(context.generation)) {
      return;
    }
    this._deps.setRunning(true);
    this._deps.setInputLocked(false);
    this._deps.emitError(`Map load failed: ${context.error}`);
  }

  /** Whether `generation` has been superseded or the runner retired. */
  private _isStale(generation: number): boolean {
    return generation !== this._generation || this._disposed;
  }

  /**
   * Restores a playable, PROGRESS-PRESERVING world after a destructive failure.
   *
   * The old surface alone is not recovery — replaying its load options would
   * re-seed the world from the previous entry point and discard everything the
   * player did since. So recovery is two ordered halves:
   *
   * 1. put the previous SCENE back (surface, grids, worker load payload), then
   * 2. rehydrate the CHECKPOINT captured just before teardown, which carries
   *    the authoritative runtime state (player position/health/equipment and
   *    NPC state).
   *
   * Input is unlocked only after both halves succeed. With no committed scene,
   * no checkpoint, or a failed half, the engine holds paused with input LOCKED
   * and an actionable message — never "running" on a world that does not hold
   * the player's actual progress.
   *
   * The replay's `LOAD_MAP` and the restore's `LOAD_GAME` are correlated
   * requests issued in that order, so the worker applies them in order: the
   * rehydrated checkpoint lands last and wins over any load effect still in
   * flight from the failed switch.
   */
  private async _recoverFromFailure(options: {
    generation: number;
    mapUrl: string;
    error: string;
    /** Runtime state captured immediately before this load's teardown. */
    checkpoint: string;
  }): Promise<void> {
    // A newer transition, or a disposal, already owns engine state.
    if (this._isStale(options.generation)) {
      this._deps.log.debug('loadMap:recovery-abandoned', { mapUrl: options.mapUrl });
      return;
    }

    const committed = this._committed;

    if (!committed) {
      // First boot, or a switch that never captured one: nothing here holds
      // the player's progress, so resuming would hand back a plausible-looking
      // world that silently threw their run away.
      this._deps.log.warn('loadMap:no-checkpoint-to-restore', { mapUrl: options.mapUrl });
      this._holdLocked(options);
      return;
    }

    try {
      // Half 1 — the previous scene, on screen and in the worker.
      this._deps.resetSurface();
      this._deps.installScene(committed.scene);

      const rendered = await this._deps.render(committed.scene, () =>
        this._isCurrentForRecovery(options.generation),
      );
      if (!rendered || this._isStale(options.generation)) {
        this._deps.log.debug('loadMap:recovery-superseded', { mapUrl: options.mapUrl });
        return;
      }

      await this._deps.postLoadMap(committed.scene, committed.options);
      if (this._isStale(options.generation)) {
        return;
      }

      // Half 2 — the authoritative runtime state, over the top of that load.
      await this._deps.restoreCheckpoint(options.checkpoint);
      if (this._isStale(options.generation)) {
        this._deps.log.debug('loadMap:recovery-superseded-after-restore', {
          mapUrl: options.mapUrl,
        });
        return;
      }

      this._deps.setRunning(true);
      this._deps.setInputLocked(false);
      this._deps.log.warn('loadMap:recovered-previous-scene', {
        mapUrl: committed.options.mapUrl,
        restoredCheckpoint: true,
      });
      this._deps.emitError(`Map load failed: ${options.error}`);
    } catch (recoveryError) {
      const detail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);

      // A recovery that failed AFTER being superseded must not lock input or
      // emit an error on behalf of whoever owns engine state now.
      if (this._isStale(options.generation)) {
        this._deps.log.debug('loadMap:recovery-failed-after-supersession', {
          mapUrl: options.mapUrl,
          error: detail,
        });
        return;
      }

      this._deps.log.error('loadMap:recovery-failed', {
        mapUrl: options.mapUrl,
        error: detail,
      });
      this._holdLocked({ ...options, error: `${options.error} (recovery failed: ${detail})` });
    }
  }

  /**
   * Freezes the engine in its last known state with input locked and reports
   * an actionable message. Deliberate, visible failure — not a soft-lock.
   */
  private _holdLocked(options: { mapUrl: string; error: string }): void {
    this._deps.setRunning(false);
    this._deps.setInputLocked(true);
    this._deps.emitError(
      `Map load failed: ${options.error}. The engine is paused — reload the game to continue.`,
    );
  }

  /** Recovery is abandoned the moment anything else owns engine state. */
  private _isCurrentForRecovery(generation: number): boolean {
    return !this._disposed && generation === this._generation;
  }
}
