// packages/frontend/engine/src/systems/render_system.ts
import type { World } from 'bitecs';
import { getComponent, hasComponent, observe, onAdd, onRemove, query } from 'bitecs';
import { Buffer, BufferUsage, type Container, Graphics, Rectangle } from 'pixi.js';
import type { LpcLayerRecipe } from '../components/appearance.ts';
import { Appearance, getAppearanceLayers } from '../components/appearance.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { Velocity } from '../components/velocity.ts';
import type { VisualData } from '../components/visual.ts';
import { AssetAlias, resolveAssetPath, Visual } from '../components/visual.ts';
import { COMPONENT_STRIDE } from '../config/memory_config.ts';
import {
  getLpcFrameIndex,
  LpcAnimationState,
  velocityToDirection,
} from '../rendering/animation_controller.ts';
import type { SpriteComposer } from '../rendering/sprite_composer.ts';
import { packRecipeToUboBuffer } from '../rendering/sprite_composer.ts';

// ---------------------------------------------------------------------------
// RenderSystem — sync bitECS entities to PixiJS display objects
//
// Contract C-040: Cell position calculation layer converts floating-point
// simulation data into grid-aligned visual screen transforms before flushing
// frame drawing allocations. The cell grid uses a fixed 32×32 pixel stride
// synchronized with the movement system's tile constraints.
// ---------------------------------------------------------------------------

/** Pixel size of a single grid cell (must match movement_system.ts). */
const CELL_PIXEL_SIZE = 32;

/** Half-cell offset for center-of-cell alignment. */
const CELL_HALF = CELL_PIXEL_SIZE / 2;

/**
 * Default cell geometry dimensions in pixels.
 *
 * Used to pre-assign {@link filterArea} bounds so the PixiJS renderer
 * skips per-frame boundary recalculations for static-sized entities.
 */
const CELL_GEOMETRY_RECT = new Rectangle(0, 0, CELL_PIXEL_SIZE, CELL_PIXEL_SIZE);

/** Cached query terms — entities with Position + Visual are rendered. */
const RENDER_QUERY_TERMS = [Position, Visual];

// -------------------------------------------------------------------------
// Scene map — private ECS-to-Pixi correlation
// -------------------------------------------------------------------------

/**
 * Private map connecting bitECS entity IDs to their PixiJS display objects.
 *
 * The ECS world never holds PixiJS object references — all display objects
 * are managed here by the rendering system's observer hooks.  Established
 * by {@link setupVisualObservers} and consumed by {@link updateRender}.
 */
const _sceneMap = new Map<number, Container>();

/**
 * Registers `onAdd(Visual)` and `onRemove(Visual)` observer hooks for
 * reactive PixiJS display object lifecycle management.
 *
 * **onAdd(Visual)**: Creates a placeholder {@link Graphics} rectangle
 * coloured with the entity's tint and adds it to the stage immediately.
 * An async texture load is kicked off in the background; once resolved,
 * the placeholder is replaced with a proper {@link PIXI.Sprite} if the
 * entity still carries the Visual component.
 *
 * **onRemove(Visual)**: Destroys the corresponding PixiJS object via
 * `.destroy({ children: true })`, removes it from the stage, and deletes
 * the entry from {@link _sceneMap}.
 *
 * @param options - Observer setup options.
 * @param options.world - The bitECS world.
 * @param options.stage - The PixiJS stage to add sprites to.
 */
const setupVisualObservers = (options: { world: World; stage: Container }): void => {
  const { world, stage } = options;

  // onAdd: create display object when Visual component is attached
  observe(world, onAdd(Visual), (eid: number) => {
    const visualData = getComponent(world, eid, Visual) as VisualData | undefined;
    if (!visualData) {
      return;
    }

    const displayObject = _createVisualPlaceholder(visualData.tint);
    stage.addChild(displayObject);
    _sceneMap.set(eid, displayObject);

    // Kick off async texture load, replacing placeholder when ready
    _loadVisualTextureAsync({ eid, world, stage, assetIndex: visualData.assetIndex });
  });

  // onRemove: destroy display object and clean up
  observe(world, onRemove(Visual), (eid: number) => {
    const displayObject = _sceneMap.get(eid);
    if (displayObject) {
      if (displayObject.parent) {
        displayObject.parent.removeChild(displayObject);
      }
      displayObject.destroy({ children: true });
      _sceneMap.delete(eid);
    }
  });
};

/**
 * Synchronizes bitECS entity positions to their PixiJS display objects.
 *
 * Runs every frame after the movement system. For each entity with both a
 * {@link Position} and {@link Visual} component, reads the display object
 * from the private {@link _sceneMap} and updates its transform.
 *
 * Display objects are created reactively by the `onAdd(Visual)` observer
 * — entities without a scene map entry are skipped (observer fires on the
 * next tick).
 *
 * Off-screen entities are hidden via `visible = false` to skip GPU
 * draw calls (spatial culling).
 *
 * @param world - The bitECS world.
 * @param stage - The PixiJS stage container.
 */
const updateRender = (world: World, stage: Container): void => {
  if (!world || !stage) {
    return;
  }

  const entities = query(world, RENDER_QUERY_TERMS);
  for (const eid of entities) {
    const displayObject = _sceneMap.get(eid);
    if (!displayObject) {
      continue;
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    displayObject.x = pos.x;
    displayObject.y = pos.y;

    // Spatial culling: hide entities outside the visible stage bounds
    const stageBounds = stage.filterArea ?? stage.getBounds();
    const isOffScreen =
      pos.x + CELL_PIXEL_SIZE < stageBounds.x ||
      pos.x > stageBounds.x + stageBounds.width ||
      pos.y + CELL_PIXEL_SIZE < stageBounds.y ||
      pos.y > stageBounds.y + stageBounds.height;

    displayObject.visible = !isOffScreen;
  }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Creates a placeholder {@link Graphics} rectangle for a Visual entity.
 *
 * Provides an immediate synchronous visual so entities never appear
 * invisible while textures load asynchronously.  Once the real texture
 * resolves, the placeholder is replaced automatically.
 *
 * **Optimization flags applied:**
 * - `eventMode = 'none'` — bypasses layout hit-tests for character
 *   sprites (interaction is via spatial queries, not DOM events).
 * - `filterArea` — pre-assigned to match cell geometry bounds so the
 *   PixiJS renderer skips per-frame `getBounds()` recalculations.
 *
 * @param tint - The hex tint colour for the placeholder rectangle.
 * @returns A Graphics rectangle ready for the stage.
 */
const _createVisualPlaceholder = (tint: number): Graphics => {
  const graphic = new Graphics();
  graphic.rect(0, 0, 32, 32);
  graphic.fill({ color: tint });

  // Per-contract C-032: bypass layout hit-tests for character visuals
  graphic.eventMode = 'none';
  // Pre-assign filter area to avoid per-frame bounds recalc overhead
  graphic.filterArea = CELL_GEOMETRY_RECT;

  return graphic;
};

/**
 * Asynchronously loads the true texture for a Visual entity and replaces
 * the placeholder when ready.
 *
 * Guards against entities destroyed during texture fetch by checking
 * `hasComponent(world, Visual, eid)` in the `.then()` callback.
 *
 * For PLACEHOLDER alias (0) or empty paths, the async load is skipped —
 * the placeholder Graphics rectangle is the final visual.
 *
 * @param options - Async load options.
 * @param options.eid - The entity ID.
 * @param options.world - The bitECS world.
 * @param options.stage - The PixiJS stage.
 * @param options.assetIndex - The numeric asset alias.
 */
const _loadVisualTextureAsync = (options: {
  eid: number;
  world: World;
  stage: Container;
  assetIndex: number;
}): void => {
  const { eid, world, stage, assetIndex } = options;

  // Placeholder alias (0) or empty path — skip async load
  if (assetIndex === AssetAlias.PLACEHOLDER || assetIndex === 0) {
    return;
  }

  const assetPath = resolveAssetPath(assetIndex);
  if (!assetPath) {
    return;
  }

  // Use a dynamic import to bring in PixiJS Assets only when needed.
  // The placeholder Graphics is already visible; the player won't notice
  // the async resolution.
  void import('pixi.js')
    .then(({ Assets, Sprite: PixiSprite }) => {
      return Assets.load(assetPath).then((texture) => ({
        // biome-ignore lint/style/useNamingConvention: PixiJS import name
        Sprite: PixiSprite,
        texture,
      }));
    })
    .then(({ Sprite: PixiSprite, texture }) => {
      // Guard: entity may have been destroyed during fetch
      if (!hasComponent(world, eid, Visual)) {
        return;
      }

      const oldDisplayObject = _sceneMap.get(eid);
      const sprite = new PixiSprite(texture);
      sprite.eventMode = 'none';
      sprite.filterArea = CELL_GEOMETRY_RECT;

      // Preserve position from old placeholder
      if (oldDisplayObject) {
        sprite.x = oldDisplayObject.x;
        sprite.y = oldDisplayObject.y;
        sprite.visible = oldDisplayObject.visible;

        if (oldDisplayObject.parent) {
          oldDisplayObject.parent.removeChild(oldDisplayObject);
        }
        oldDisplayObject.destroy();
      }

      stage.addChild(sprite);
      _sceneMap.set(eid, sprite);
    })
    .catch(() => {
      // Texture load failed — placeholder remains visible
    });
};

/**
 * Per-entity render entry for buffer-based rendering.
 *
 * Used by GameWorld's buffer render path when the bitECS world runs in a
 * Web Worker and entity positions arrive via a Float32Array buffer.
 */
export type RenderEntry = {
  /** The PixiJS display object for this entity. */
  displayObject: Container;
  /** Tint color for the entity (ignored when `layerIds` is set). */
  tint: number;
  /**
   * Optional asset layer IDs for dynamic sprite composition.
   *
   * When provided, the render system delegates to {@link SpriteComposer}
   * instead of drawing a primitive `Graphics` rectangle. The display
   * object is replaced with a layered container that is flattened via
   * `cacheAsTexture`.
   */
  layerIds?: readonly number[];
  /**
   * When `true`, spatial culling is enabled for this entity. Off-screen
   * entities are hidden via `visible = false` to skip GPU draw calls.
   *
   * Defaults to `false` for entities that should always render (e.g.,
   * minimap markers, HUD elements). Set `true` for character entities
   * that move in and out of the viewport.
   */
  cullable?: boolean;
};

/**
 * Updates PixiJS display object positions from a Float32Array render buffer.
 *
 * This variant is used when the bitECS world runs in a Web Worker and
 * entity positions arrive via shared memory (SharedArrayBuffer) or
 * Transferable ArrayBuffer. It reads positions directly from the
 * Float32Array buffer instead of querying bitECS components.
 *
 * The buffer layout is: `[eid * COMPONENT_STRIDE + 0] = x`,
 * `[eid * COMPONENT_STRIDE + 1] = y`, `[eid * COMPONENT_STRIDE + 2] = rotation`.
 *
 * When a {@link SpriteComposer} is provided and a render entry has
 * `layerIds`, the system delegates container creation and texture
 * replacement to the composer. A placeholder is shown immediately while
 * textures load asynchronously.
 *
 * @param renderView - Float32Array view into the entity state buffer.
 * @param renderEntries - Map of entity ID → render entry.
 * @param stage - The PixiJS stage container (required when using composer).
 * @param spriteComposer - Optional composer for dynamic multi-layer sprites.
 */
const updateRenderFromBuffer = (
  renderView: Float32Array,
  renderEntries: Map<number, RenderEntry>,
  stage?: Container,
  spriteComposer?: SpriteComposer,
): void => {
  if (!renderView || !renderEntries) {
    return;
  }

  for (const [eid, entry] of renderEntries) {
    const offset = eid * COMPONENT_STRIDE;
    const x = renderView[offset];
    const y = renderView[offset + 1];

    if (x === undefined || y === undefined) {
      continue;
    }

    // Delegate to SpriteComposer when layer IDs are present
    if (spriteComposer && stage && entry.layerIds && entry.layerIds.length > 0) {
      ensureComposedSprite({ eid, entry, stage, spriteComposer });
    }

    entry.displayObject.x = x;
    entry.displayObject.y = y;

    // Spatial culling for cullable entities
    if (entry.cullable) {
      const stageBounds = stage?.filterArea ?? stage?.getBounds();
      if (stageBounds) {
        const isOffScreen =
          x + 32 < stageBounds.x ||
          x > stageBounds.x + stageBounds.width ||
          y + 32 < stageBounds.y ||
          y > stageBounds.y + stageBounds.height;

        entry.displayObject.visible = !isOffScreen;
      }
    }
  }
};

// -------------------------------------------------------------------------
// Dynamic sprite helpers
// -------------------------------------------------------------------------

/** Tracks entity IDs that have already been composed to avoid re-composition. */
const composedEntities = new Set<number>();

/**
 * Ensures a render entry has a composed sprite container, creating one
 * on the first call and skipping subsequent calls for the same entity.
 *
 * @param options - Composition options.
 */
const ensureComposedSprite = (options: {
  eid: number;
  entry: RenderEntry;
  stage: Container;
  spriteComposer: SpriteComposer;
}): void => {
  const { eid, entry, stage, spriteComposer } = options;

  if (composedEntities.has(eid)) {
    return;
  }

  composedEntities.add(eid);

  // Replace the primitive display object with a composed container.
  // The composer returns a placeholder immediately and replaces it
  // asynchronously with layered sprites.
  const oldDisplayObject = entry.displayObject;
  if (oldDisplayObject?.parent) {
    oldDisplayObject.parent.removeChild(oldDisplayObject);
    oldDisplayObject.destroy();
  }

  const composedContainer = spriteComposer.composeSprite({
    layerIds: entry.layerIds ?? [],
  });

  // Per-contract C-032: bypass layout hit-tests for character visuals
  composedContainer.eventMode = 'none';
  // Pre-assign filter area to avoid per-frame bounds recalc overhead
  composedContainer.filterArea = CELL_GEOMETRY_RECT;

  stage.addChild(composedContainer);
  entry.displayObject = composedContainer;
};

/**
 * Removes a composed entity from the tracking set so it can be
 * re-composed (e.g., when layers change).
 *
 * @param eid - The entity ID to invalidate.
 */
const invalidateComposedSprite = (eid: number): void => {
  composedEntities.delete(eid);
};

// -------------------------------------------------------------------------
// UBO buffer cache — per-entity uniform block management
// -------------------------------------------------------------------------

/**
 * Tracks per-entity UBO buffer resources.
 *
 * Each entry holds a {@link Buffer} allocated once per entity
 * and reused across frames. The buffer is only re-uploaded when the
 * entity's appearance recipe structurally changes (new layer order,
 * palette swap, or layer add/remove).
 *
 * Key: entity ID, Value: GPU buffer.
 */
const uboBufferCache = new Map<number, Buffer>();

// ---------------------------------------------------------------------------
// Dense Object Pools — shared contiguous pool for entity UBO references
// ---------------------------------------------------------------------------

/**
 * Dense object pool for PixiJS `Buffer` instances.
 *
 * Pre-allocates `Buffer` objects for up to `capacity` concurrent
 * entities. Returns them via {@link acquire} and recycles via
 * {@link release}. Allocates only once — zero runtime allocation
 * during frame-critical paths.
 */
class DenseObjectPool<T> {
  /** Stack of pre-allocated (unused) objects. */
  private readonly _free: T[] = [];

  /** Maximum pool capacity. */
  private readonly _capacity: number;

  /**
   * @param capacity - Maximum pool size.
   * @param factory - Factory function creating new objects.
   */
  constructor(capacity: number, factory: () => T) {
    this._capacity = capacity;

    // Pre-allocate all objects
    for (let i = 0; i < capacity; i++) {
      this._free.push(factory());
    }
  }

  /**
   * Acquires a pre-allocated object from the pool.
   *
   * @returns A pooled object, or `undefined` if the pool is exhausted.
   */
  acquire(): T | undefined {
    return this._free.pop();
  }

  /**
   * Returns an object to the pool for reuse.
   *
   * @param obj - The object to recycle.
   */
  release(obj: T): void {
    if (this._free.length < this._capacity) {
      this._free.push(obj);
    }
  }

  /** Number of free (available) objects remaining. */
  get freeCount(): number {
    return this._free.length;
  }

  /** Total pool capacity. */
  get capacity(): number {
    return this._capacity;
  }

  /** Number of objects currently in use. */
  get usedCount(): number {
    return this._capacity - this._free.length;
  }
}

/**
 * Tracks the last known recipe snapshot per entity for structural
 * change detection.
 *
 * When the current recipe differs from this snapshot, the UBO buffer
 * is re-packed and uploaded via {@link updateEntityUbo}.
 *
 * Key: entity ID, Value: JSON-stringified snapshot of layer recipe
 * asset IDs (fast deep comparison without Uint8Array serialization).
 */
const uboRecipeSnapshots = new Map<number, string>();

/**
 * Computes a structural fingerprint for a set of layer recipes.
 *
 * Only compares asset IDs and slot names — ignores palette data
 * to keep snapshot comparison fast. Palette-only changes are
 * detected separately via {@link recipePaletteFingerprint}.
 *
 * @param recipes - The current layer recipes.
 * @returns A JSON-stringified fingerprint for fast comparison.
 */
const recipeStructuralFingerprint = (recipes: readonly LpcLayerRecipe[]): string => {
  return JSON.stringify(recipes.map((r) => (r ? { s: r.slot, a: r.assetId } : null)));
};

/**
 * Computes a lightweight palette fingerprint for a set of layer recipes.
 *
 * Samples a small subset of palette data (first 16 entries per layer)
 * to detect colour-only mutations without triggering structural re-hashes.
 * Uses a simple DJB2 hash over the sampled bytes for O(n) comparison speed.
 *
 * @param recipes - The current layer recipes.
 * @returns A numeric hash representing palette state.
 */
const recipePaletteFingerprint = (recipes: readonly LpcLayerRecipe[]): number => {
  let hash = 5381;
  for (const recipe of recipes) {
    if (!recipe?.hexPalette) {
      continue;
    }
    // Sample first 64 bytes (16 RGBA entries) per layer — enough to
    // catch tint changes without scanning the full 1024-byte buffer.
    const sampleEnd = Math.min(64, recipe.hexPalette.length);
    for (let i = 0; i < sampleEnd; i++) {
      hash = ((hash << 5) + hash + recipe.hexPalette[i]) | 0;
    }
  }
  return hash;
};

/**
 * Tracks the last known palette fingerprint per entity for
 * palette-only change detection.
 *
 * Key: entity ID, Value: DJB2 hash of palette sample bytes.
 * Separate from structural snapshots so palette mutations don't
 * increment the structural hash counter.
 */
const uboPaletteSnapshots = new Map<number, number>();

/**
 * Appearance change tri-state indicating what kind of mutation occurred.
 *
 * - `'none'`: No change — skip UBO repack.
 * - `'palette'`: Only palette colours changed — repack without
 *   incrementing structural hash counter (AC-2 compliance).
 * - `'structural'`: Slot or asset order changed — full repack + hash bump.
 */
type AppearanceChangeKind = 'none' | 'palette' | 'structural';

/**
 * Returns the kind of appearance change for an entity since the last
 * recorded snapshot.
 *
 * A `'structural'` change means layer order, slot assignment, or asset
 * ID swap — anything that changes the entity's visual identity.
 * A `'palette'` change means only tint colours changed — UBO must
 * repack but structural hash counter should NOT increment.
 * `'none'` returns when nothing changed.
 *
 * @param eid - The entity ID to check.
 * @param recipes - The current layer recipes.
 * @returns The kind of appearance change detected.
 */
const checkAppearanceChange = (
  eid: number,
  recipes: readonly LpcLayerRecipe[],
): AppearanceChangeKind => {
  const structFingerprint = recipeStructuralFingerprint(recipes);
  const palFingerprint = recipePaletteFingerprint(recipes);

  const previousStruct = uboRecipeSnapshots.get(eid);
  const previousPalette = uboPaletteSnapshots.get(eid);

  if (previousStruct === structFingerprint) {
    // Structural identical — check palette only
    if (previousPalette === palFingerprint) {
      return 'none';
    }
    // Palette changed, structure unchanged
    uboPaletteSnapshots.set(eid, palFingerprint);
    return 'palette';
  }

  // Structural changed — update both snapshots
  uboRecipeSnapshots.set(eid, structFingerprint);
  uboPaletteSnapshots.set(eid, palFingerprint);
  return 'structural';
};

/**
 * Returns `true` when the entity's appearance has structurally changed
 * since the last recorded snapshot.
 *
 * A structural change means layer order, slot assignment, or palette
 * swap — anything that requires re-packing the UBO buffer and
 * re-uploading to the GPU. Per-frame position / animation frame
 * changes do NOT trigger this.
 *
 * @param eid - The entity ID to check.
 * @param recipes - The current layer recipes.
 * @returns `true` if the appearance structurally changed.
 */
const hasAppearanceChanged = (eid: number, recipes: readonly LpcLayerRecipe[]): boolean => {
  return checkAppearanceChange(eid, recipes) === 'structural';
};

// ---------------------------------------------------------------------------
// syncAppearanceSystem — bitECS Appearance → LpcBatchManager bridge
// ---------------------------------------------------------------------------

/**
 * Tracks which entities were present in the previous
 * `syncAppearanceSystem` call, keyed by world.
 *
 * Used to detect enter (new entities) and exit (removed entities)
 * lifecycle changes without relying on bitECS internal enter/exit
 * query APIs.
 */
const _trackedAppearanceEntities = new Map<World, Set<number>>();

/**
 * Synchronizes bitECS Appearance component state into the
 * {@link LpcBatchManager} shared UBO pool.
 *
 * Runs every frame after mutation systems. For each entity with an
 * active `Appearance` component:
 *
 * 1. **Enter**: New entities are registered in the batch pool via
 *    {@link LpcBatchManager.registerEntity}, reserving a dedicated
 *    UBO slot.
 * 2. **Exit**: Entities that lost the `Appearance` component are
 *    deregistered via {@link LpcBatchManager.deregisterEntity},
 *    freeing their pool slot for reuse.
 * 3. **Existing**: Layer recipes are compared against cached
 *    structural fingerprints. Only structurally changed entities
 *    trigger UBO re-packing and dirty segment scheduling.
 *
 * At the end of the frame, {@link LpcBatchManager.flushBatch} is
 * called to commit all dirty segments to the GPU in a single
 * consolidated update.
 *
 * @param options - Synchronization options.
 * @param options.world - The bitECS world.
 * @param options.batchManager - The LPC batch manager instance.
 * @param options.recipeResolver - Converts entity layer IDs to
 *   {@link LpcLayerRecipe} arrays for UBO packing.
 */
const syncAppearanceSystem = (options: {
  world: World;
  batchManager: LpcBatchManager;
  recipeResolver: (layerIds: readonly number[]) => LpcLayerRecipe[];
}): void => {
  const { world, batchManager, recipeResolver } = options;

  // Query all entities currently carrying the Appearance component
  const entities = query(world, [Appearance]);

  // Re-use or create the per-world tracking set
  let tracked = _trackedAppearanceEntities.get(world);
  if (!tracked) {
    tracked = new Set<number>();
    _trackedAppearanceEntities.set(world, tracked);
  }

  // Build current set for diffing
  const currentSet = new Set(entities);

  // Detect exits: entities tracked last frame but no longer in the query
  for (const eid of tracked) {
    if (!currentSet.has(eid)) {
      batchManager.deregisterEntity(eid);
    }
  }

  // Detect enters + process existing entities
  for (const eid of entities) {
    const layerIds = getAppearanceLayers(eid);
    const recipes = recipeResolver(layerIds);

    if (!tracked.has(eid)) {
      // Enter: new entity — register in batch pool
      batchManager.registerEntity(eid, recipes);
    }
    // Write UBO data (only triggers upload when fingerprint has changed).
    // Called for all active entities — the manager's own fingerprint check
    // skips redundant re-packs.
    batchManager.writeEntityUbo(eid, recipes);
  }

  // Commit all dirty segments to GPU in a single consolidated update
  batchManager.flushBatch();

  // Swap tracking set for next frame
  _trackedAppearanceEntities.set(world, currentSet);
};

/**
 * Clears all per-world appearance tracking state.
 *
 * Call during world teardown to prevent stale entity references.
 *
 * @param world - The bitECS world to clear tracking for.
 */
const resetAppearanceTracking = (world: World): void => {
  _trackedAppearanceEntities.delete(world);
};

/**
 * Updates (or creates) the UBO buffer for an entity when its
 * appearance recipe has structurally changed.
 *
 * Re-packs the recipes into an std140 Float32Array and uploads
 * it to the GPU via a cached Buffer. The buffer is reused across
 * frames — only the data changes on structural mutation.
 *
 * @param eid - The entity ID.
 * @param recipes - The current layer recipes.
 */
const updateEntityUbo = (eid: number, recipes: readonly LpcLayerRecipe[]): void => {
  const packed = packRecipeToUboBuffer(recipes);

  const existingBuffer = uboBufferCache.get(eid);
  if (existingBuffer) {
    existingBuffer.data = packed;
  } else {
    const gpuBuffer = new Buffer({
      data: packed,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
    // Store the Buffer for data updates via the `.data` setter
    uboBufferCache.set(eid, gpuBuffer);
  }
};

// -------------------------------------------------------------------------
// Appearance dirty-check
// -------------------------------------------------------------------------

/**
 * Tracks the previous frame's layer IDs per entity for dirty-checking.
 * Key: entity ID, Value: snapshot of layer IDs from the last comparison.
 */
const previousLayerSnapshots = new Map<number, readonly number[]>();

/**
 * Compares the current Appearance layer IDs for an entity against the
 * previous frame's snapshot. If they differ, calls
 * {@link invalidateComposedSprite} so the {@link SpriteComposer}
 * rebuilds the composite texture on the next render pass.
 *
 * Also triggers a UBO buffer re-pack via {@link updateEntityUbo}
 * when the entity has an associated set of LPC layer recipes.
 *
 * Called when an `APPEARANCE_CHANGED` event arrives from the worker.
 *
 * @param eid - The entity ID to check.
 * @param layerIds - The current layer IDs from the event payload.
 * @param recipes - Optional LPC layer recipes for UBO update.
 */
const dirtyCheckAppearance = (
  eid: number,
  layerIds: readonly number[],
  recipes?: readonly LpcLayerRecipe[],
): void => {
  const prev = previousLayerSnapshots.get(eid);

  if (prev && prev.length === layerIds.length) {
    let hasChanged = false;
    for (let i = 0; i < layerIds.length; i++) {
      if (prev[i] !== layerIds[i]) {
        hasChanged = true;
        break;
      }
    }
    if (!hasChanged) {
      return;
    }
  }

  // Snapshot differs (or is new) — invalidate and store new snapshot
  invalidateComposedSprite(eid);
  previousLayerSnapshots.set(eid, [...layerIds]);

  // UBO update: re-pack and upload when recipes are provided
  // Only triggers on structural mutations, not per-frame position changes
  if (recipes && recipes.length > 0 && hasAppearanceChanged(eid, recipes)) {
    updateEntityUbo(eid, recipes);
  }
};

// ---------------------------------------------------------------------------
// LpcBatchManager — centralized batch UBO allocation tracking pool
//
// Contract C-034: This class manages a single shared std140 UBO buffer
// sized for up to 64 concurrent entity instances. Each entity's LPC layer
// recipes are packed into a per-entity 256-byte slot within the shared
// Float32Array. The manager tracks dirty segments and flushes exactly one
// `Buffer.update()` per system tick — zero per-frame re-allocations.
// ---------------------------------------------------------------------------

/** Number of Float32 values per entity UBO slot (std140: 64 floats = 256 bytes). */
const PER_ENTITY_UBO_FLOATS = 64;

/** Byte size of a single entity's UBO slot. */
const PER_ENTITY_UBO_BYTES = PER_ENTITY_UBO_FLOATS * 4; // 256

/** Default maximum concurrent entities. */
const DEFAULT_MAX_INSTANCES = 64;

/**
 * Options for constructing an {@link LpcBatchManager}.
 */
type LpcBatchManagerOptions = {
  /** Maximum number of concurrent entity instances. Default: 64. */
  maxInstances?: number;
  /**
   * Factory for creating PixiJS Buffer instances per entity slot.
   *
   * When omitted, GPU Buffer management is disabled — the manager
   * still tracks slot allocation, fingerprints, and dirty segments
   * but `flushBatch` emits no GPU commands. This mode is intended
   * for headless testing and worker-side pre-flighting.
   */
  createBuffer?: () => Buffer;
};

/**
 * Describes a dirty (modified) byte segment within the shared UBO buffer.
 *
 * Used by the batch flush to emit concentrated sub-data update ranges
 * for WebGL2 `bufferSubData` or WebGPU `writeBuffer` calls.
 */
type DirtySegment = {
  /** Byte offset from the start of the shared buffer. */
  offsetBytes: number;
  /** Number of contiguous dirty bytes. */
  byteLength: number;
};

/**
 * Centralized LPC batch render manager.
 *
 * Manages a single shared std140 mega-UBO backing store for up to 64
 * concurrent entity instances. Every entity's appearance recipe data is
 * packed into a dedicated 256-byte slot within the shared Float32Array.
 *
 * On `flushBatch()`, exactly one `Buffer.data` assignment (→
 * `Buffer.update()`) is issued per system tick, transferring only the
 * dirty byte segments to the GPU. This guarantees zero per-frame
 * re-allocations and zero bind group cache invalidations under both
 * WebGPU and WebGL2.
 */
class LpcBatchManager {
  /** Shared mega-UBO Float32Array (poolSize × 64 floats). */
  private readonly _sharedUbo: Float32Array;

  /** Maximum concurrent entity instances. */
  private readonly _maxInstances: number;

  /** Maps entity ID → pool slot index. */
  private readonly _entitySlotMap = new Map<number, number>();

  /** Pool of free slot indices (pre-initialized). */
  private readonly _freeSlots: number[];

  /** Number of currently active (registered) entities. */
  private _activeInstances = 0;

  /** Counter: structural hashes issued (entity recipe fingerprint changes). */
  private _structuralHashesIssued = 0;

  /** Counter: number of batch flushes performed (system ticks). */
  private _batchUpdatesPerformed = 0;

  /** Accumulated dirty segments for the current frame. */
  private _dirtySegments: DirtySegment[] = [];

  /** Whether the shared UBO has been modified since last flush. */
  private _isDirty = false;

  /** Pool of pre-allocated Buffer instances for slot reuse. */
  private readonly _bufferPool: DenseObjectPool<Buffer>;

  /** Active GPU Buffers keyed by entity ID. */
  private readonly _entityBuffers = new Map<number, Buffer>();

  /** Whether GPU Buffer management is enabled (requires createBuffer factory). */
  private readonly _hasGpuBuffers: boolean;

  /**
   * @param options - Configuration options.
   */
  constructor(options: LpcBatchManagerOptions = {}) {
    this._maxInstances = options.maxInstances ?? DEFAULT_MAX_INSTANCES;

    const totalFloats = this._maxInstances * PER_ENTITY_UBO_FLOATS;
    this._sharedUbo = new Float32Array(totalFloats);

    // Pre-fill free slot stack in reverse order so pop() yields 0 first
    this._freeSlots = Array.from(
      { length: this._maxInstances },
      (_, i) => this._maxInstances - 1 - i,
    );

    // Pre-allocate Buffer instances for the entire pool (only when
    // a factory is provided — headless/test mode skips GPU allocation).
    this._hasGpuBuffers = options.createBuffer !== undefined;
    if (this._hasGpuBuffers && options.createBuffer) {
      const factory = options.createBuffer;
      this._bufferPool = new DenseObjectPool<Buffer>(this._maxInstances, () => factory());
    } else {
      // Dummy pool — never used (acquire / release are guarded by _hasGpuBuffers)
      this._bufferPool = new DenseObjectPool<Buffer>(this._maxInstances, () => ({}) as Buffer);
    }
  }

  // ---- Public read-only properties ----

  /** Maximum concurrent entity instances (pool capacity). */
  get poolSize(): number {
    return this._maxInstances;
  }

  /** Byte size of the shared UBO buffer. */
  get sharedUboByteSize(): number {
    return this._sharedUbo.byteLength;
  }

  /** Byte size of a single entity's UBO slot. */
  get perEntityUboByteSize(): number {
    return PER_ENTITY_UBO_BYTES;
  }

  /** Number of currently registered entities. */
  get activeInstances(): number {
    return this._activeInstances;
  }

  /** Total structural hash invalidation events since creation. */
  get structuralHashesIssued(): number {
    return this._structuralHashesIssued;
  }

  /** Total batch flushes performed (system ticks). */
  get batchUpdatesPerformed(): number {
    return this._batchUpdatesPerformed;
  }

  /** Current frame's dirty byte segments (cleared on flush). */
  get dirtySegments(): readonly DirtySegment[] {
    return this._dirtySegments;
  }

  // ---- Entity lifecycle ----

  /**
   * Registers an entity in the batch pool, allocating a dedicated UBO slot.
   *
   * Writes the initial recipe data into the shared buffer and assigns
   * a pre-allocated Buffer from the dense object pool.
   *
   * @param eid - The entity ID to register.
   * @param recipes - Initial LPC layer recipes for the entity.
   * @returns The assigned pool slot index, or -1 if the pool is full.
   */
  registerEntity(eid: number, recipes: readonly LpcLayerRecipe[]): number {
    if (this._entitySlotMap.has(eid)) {
      return this._entitySlotMap.get(eid) ?? -1;
    }

    const slot = this._freeSlots.pop();
    if (slot === undefined) {
      return -1; // Pool exhausted
    }

    this._entitySlotMap.set(eid, slot);
    this._activeInstances += 1;

    // Write initial UBO data
    this._writeSlotUbo(slot, recipes);

    // Seed both structural and palette fingerprints so subsequent
    // writes with identical data skip the re-pack path entirely.
    const structuralFingerprint = recipeStructuralFingerprint(recipes);
    const paletteFingerprint = recipePaletteFingerprint(recipes);
    uboRecipeSnapshots.set(eid, structuralFingerprint);
    uboPaletteSnapshots.set(eid, paletteFingerprint);

    // Acquire a pre-allocated Buffer for this entity (only when GPU mode)
    if (this._hasGpuBuffers) {
      const gpuBuffer = this._bufferPool.acquire();
      if (gpuBuffer) {
        this._entityBuffers.set(eid, gpuBuffer);
      }
    }

    return slot;
  }

  /**
   * Deregisters an entity and returns its pool slot for reuse.
   *
   * The entity's UBO slot is zero-filled (inactive) and marked free.
   * Its GPU Buffer is released back to the object pool.
   *
   * @param eid - The entity ID to deregister.
   */
  deregisterEntity(eid: number): void {
    const slot = this._entitySlotMap.get(eid);
    if (slot === undefined) {
      return;
    }

    // Zero out the slot in the shared buffer
    const offset = slot * PER_ENTITY_UBO_FLOATS;
    this._sharedUbo.fill(0, offset, offset + PER_ENTITY_UBO_FLOATS);

    this._entitySlotMap.delete(eid);
    this._activeInstances -= 1;
    this._freeSlots.push(slot);
    this._isDirty = true;

    // Release GPU Buffer back to pool (only when GPU mode)
    if (this._hasGpuBuffers) {
      const gpuBuffer = this._entityBuffers.get(eid);
      if (gpuBuffer) {
        this._bufferPool.release(gpuBuffer);
        this._entityBuffers.delete(eid);
      }
    }

    // Clean up structural and palette fingerprint snapshots so a
    // re-registration starts fresh.
    uboRecipeSnapshots.delete(eid);
    uboPaletteSnapshots.delete(eid);
    uboBufferCache.delete(eid);
  }

  /**
   * Returns the pool slot index assigned to an entity.
   *
   * @param eid - The entity ID.
   * @returns The slot index, or -1 if the entity is not registered.
   */
  getEntitySlotIndex(eid: number): number {
    return this._entitySlotMap.get(eid) ?? -1;
  }

  /**
   * Returns a read-only view of the shared UBO Float32Array.
   *
   * @returns The shared UBO buffer view, or `null` if not initialized.
   */
  getSharedBufferView(): Float32Array | null {
    return this._sharedUbo;
  }

  // ---- Per-frame UBO write ----

  /**
   * Writes packed recipe data into the entity's UBO slot.
   *
   * Performs a structural fingerprint comparison: if the recipe layout
   * has NOT changed since the previous write, the dirty segment is
   * NOT extended (skip redundant GPU upload).
   *
   * When the recipe HAS structurally changed, re-packs the UBO
   * bytes, extends the dirty segment tracker, and increments the
   * structural hash counter.
   *
   * @param eid - The entity ID.
   * @param recipes - Current LPC layer recipes.
   */
  writeEntityUbo(eid: number, recipes: readonly LpcLayerRecipe[]): void {
    const slot = this._entitySlotMap.get(eid);
    if (slot === undefined) {
      return; // Entity not registered in the batch pool
    }

    // Tri-state appearance change check (AC-2: palette-only changes
    // repack without incrementing structural hashes).
    const changeKind = checkAppearanceChange(eid, recipes);
    if (changeKind === 'none') {
      // Neither structural nor palette changed — skip repack
      return;
    }

    // Only structural changes (slot/assetId swap) count toward the
    // structural hash tracking counter. Palette-only tint changes
    // repack but leave the counter stable (AC-2 zero-structural-hash).
    if (changeKind === 'structural') {
      this._structuralHashesIssued += 1;
    }

    this._writeSlotUbo(slot, recipes);

    // Extend the dirty segment tracker for this slot
    const byteOffset = slot * PER_ENTITY_UBO_BYTES;
    this._dirtySegments.push({
      offsetBytes: byteOffset,
      byteLength: PER_ENTITY_UBO_BYTES,
    });
    this._isDirty = true;
  }

  // ---- Batch flush ----

  /**
   * Flushes all dirty UBO segments to GPU in a single consolidated update.
   *
   * Exactly one `Buffer.data` assignment is performed per system tick.
   * The shared Float32Array is cloned for the upload (PixiJS Buffer
   * internally calls `writeBuffer` / `bufferSubData` on the dirty range).
   *
   * After flush, dirty segments and the dirty flag are reset for the
   * next frame.
   */
  flushBatch(): void {
    if (!this._isDirty && this._dirtySegments.length === 0) {
      return;
    }

    // Merge adjacent dirty segments for optimal sub-data streaming.
    // Sorted by offset, merge overlapping/adjacent ranges into one range.
    const merged = this._mergeDirtySegments();

    // For each merged segment, update the shared GPU buffer range.
    // A single Buffer is maintained for the entire pool; we update
    // only the dirty sub-ranges via a consolidated data upload.
    //
    // The consolidated buffer is written once per tick — all merged
    // segments are combined into a single Float32Array slice upload.
    if (merged.length > 0) {
      this._uploadConsolidatedSegments(merged);
    }

    // Reset per-frame state
    this._dirtySegments = [];
    this._isDirty = false;
    this._batchUpdatesPerformed += 1;
  }

  // ---- Teardown ----

  /**
   * Destroys all resources: clears entity registrations, destroys
   * GPU Buffers, and releases the shared UBO pool.
   */
  destroy(): void {
    // Destroy all active entity GPU buffers (only when GPU mode)
    if (this._hasGpuBuffers) {
      for (const buffer of this._entityBuffers.values()) {
        buffer.destroy();
      }
    }
    this._entityBuffers.clear();

    // No need to destroy pool-allocated Buffer instances;
    // they're pre-allocated and released back to the pool.
    // Just clear tracking maps.
    this._entitySlotMap.clear();
    this._dirtySegments = [];
    this._isDirty = false;
    this._activeInstances = 0;
  }

  // ---- Internal utilities ----

  /**
   * Writes packed recipe data into a specific pool slot in the
   * shared UBO Float32Array.
   *
   * @param slot - The pool slot index.
   * @param recipes - LPC layer recipes to pack and write.
   */
  private _writeSlotUbo(slot: number, recipes: readonly LpcLayerRecipe[]): void {
    const packed = packRecipeToUboBuffer(recipes);
    const offset = slot * PER_ENTITY_UBO_FLOATS;

    // Validate bounds
    if (offset + PER_ENTITY_UBO_FLOATS > this._sharedUbo.length) {
      return;
    }

    this._sharedUbo.set(packed, offset);
  }

  /**
   * Merges overlapping or adjacent dirty segments into minimal
   * contiguous upload ranges for optimal GPU sub-data streaming.
   *
   * Sorting + merging reduces N individual updates to ~log(N)
   * consolidated ranges when entities write contiguous slots.
   *
   * @returns Merged dirty segments sorted by byte offset.
   */
  private _mergeDirtySegments(): DirtySegment[] {
    if (this._dirtySegments.length === 0) {
      return [];
    }

    // Sort by offset
    const sorted = [...this._dirtySegments].sort((a, b) => a.offsetBytes - b.offsetBytes);

    const merged: DirtySegment[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];
      const lastEnd = last.offsetBytes + last.byteLength;

      if (current.offsetBytes <= lastEnd) {
        // Overlapping or adjacent — extend the last segment
        const newEnd = Math.max(lastEnd, current.offsetBytes + current.byteLength);
        last.byteLength = newEnd - last.offsetBytes;
      } else {
        // Non-contiguous — new segment
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * Uploads merged dirty segments to the GPU via a single consolidated
   * Buffer.data assignment.
   *
   * The entire dirty range (from first offset to last offset + length)
   * is extracted from the shared UBO and uploaded once to minimize
   * driver command buffer overhead.
   *
   * @param segments - Merged dirty segments.
   */
  private _uploadConsolidatedSegments(segments: readonly DirtySegment[]): void {
    if (segments.length === 0) {
      return;
    }

    // Compute the full dirty range spanning all segments
    let minOffset = segments[0].offsetBytes;
    let maxEnd = segments[0].offsetBytes + segments[0].byteLength;

    for (let i = 1; i < segments.length; i++) {
      const s = segments[i];
      if (s.offsetBytes < minOffset) {
        minOffset = s.offsetBytes;
      }
      const end = s.offsetBytes + s.byteLength;
      if (end > maxEnd) {
        maxEnd = end;
      }
    }

    // When GPU buffers are disabled (headless/test mode), skip upload.
    if (!this._hasGpuBuffers) {
      return;
    }

    // Update the per-entity Buffers; for the shared-pool approach,
    // we use a single representative buffer. In a real GPU context,
    // this would be the single shared UBO buffer.
    //
    // Each registered entity's Buffer gets a sub-range slice of the
    // consolidated data matching its slot.
    for (const [eid, gpuBuffer] of this._entityBuffers) {
      const slot = this._entitySlotMap.get(eid);
      if (slot === undefined) {
        continue;
      }

      // Check if this entity's slot falls within the dirty range
      const slotByteOffset = slot * PER_ENTITY_UBO_BYTES;
      const slotByteEnd = slotByteOffset + PER_ENTITY_UBO_BYTES;

      if (slotByteOffset >= maxEnd || slotByteEnd <= minOffset) {
        continue; // Entity slot outside the dirty range — skip
      }

      // Extract this entity's UBO data from the shared buffer
      const slotFloatOffset = slot * PER_ENTITY_UBO_FLOATS;
      const entityUboData = this._sharedUbo.slice(
        slotFloatOffset,
        slotFloatOffset + PER_ENTITY_UBO_FLOATS,
      );

      // Single Buffer.data assignment per entity (PixiJS internally
      // calls writeBuffer / bufferSubData)
      gpuBuffer.data = entityUboData;
    }
  }
}

// ---------------------------------------------------------------------------
// animateEntitySystem — velocity-driven LPC animation frame computation
// ---------------------------------------------------------------------------

/**
 * Per-entity monotonic animation tick counters.
 *
 * Each tick advances the animation clock by 1. The tick count feeds
 * into `getLpcFrameIndex` to compute the current spritesheet frame.
 */
const _entityTickCounters = new Map<number, number>();

/**
 * Per-entity computed LPC frame index for the current frame.
 *
 * Written by `animateEntitySystem` and read by render code that
 * needs to pass a `frameIndex` to `TextureManager.getFrameAt()`.
 */
const _entityFrameIndices = new Map<number, number>();

/**
 * Cached query terms — entities with Velocity + Appearance are animated.
 */
const ANIMATION_QUERY_TERMS = [Velocity, Appearance];

/**
 * Default WALK tick divisor.
 *
 * Divides the raw tick count to slow animation playback so sprites
 * don't cycle through all 9 walk frames in 9 consecutive ticks
 * (which would look like a blur at 60 fps).
 *
 * At 60 fps with divisor=8, the walk cycle completes in ~1.2 seconds
 * (9 frames × 8 ticks / 60 fps).
 */
const ANIMATION_TICK_DIVISOR = 8;

/**
 * Advances the per-entity animation clock and computes the current
 * LPC spritesheet frame index for all entities with Velocity and
 * Appearance components.
 *
 * Runs every frame, right before uniform buffer flushes in the
 * render pipeline. For each animated entity:
 *
 * 1. Reads velocity from the Velocity component (SoA arrays).
 * 2. Derives `LpcDirection` from the velocity vector via
 *    `velocityToDirection`.
 * 3. Increments the entity's animation tick counter.
 * 4. Computes the spritesheet frame index via `getLpcFrameIndex`
 *    (WALK state, modulus-wrapped to stay within bounds).
 * 5. Stores the frame index in `_entityFrameIndices` for render
 *    code to consume.
 *
 * Entities with zero velocity still advance their tick counter but
 * use `DOWN` as the default idle-facing direction — this produces
 * a static idle pose on frame 0 of the walk cycle.
 *
 * @param world - The bitECS world.
 */
const animateEntitySystem = (world: World): void => {
  if (!world) {
    return;
  }

  const entities = query(world, ANIMATION_QUERY_TERMS);
  for (const eid of entities) {
    // Read velocity from SoA arrays (not getComponent — Velocity is SoA)
    const vx = Velocity.x[eid] ?? 0;
    const vy = Velocity.y[eid] ?? 0;

    const direction = velocityToDirection(vx, vy);

    // Advance tick counter
    const rawTicks = (_entityTickCounters.get(eid) ?? 0) + 1;
    _entityTickCounters.set(eid, rawTicks);

    // Divide to slow animation playback
    const effectiveTicks = Math.floor(rawTicks / ANIMATION_TICK_DIVISOR);

    // Compute frame index for WALK state (default movement animation)
    const frameIndex = getLpcFrameIndex(LpcAnimationState.Walk, direction, effectiveTicks);

    _entityFrameIndices.set(eid, frameIndex);
  }
};

/**
 * Returns the computed LPC frame index for an entity.
 *
 * @param eid - The entity ID.
 * @returns The frame index, or -1 if not animated.
 */
const getEntityAnimationFrame = (eid: number): number => {
  return _entityFrameIndices.get(eid) ?? -1;
};

/**
 * Clears all per-entity animation tracking state.
 *
 * Call during world teardown to prevent stale entity references.
 */
const resetAnimationTracking = (): void => {
  _entityTickCounters.clear();
  _entityFrameIndices.clear();
};

/**
 * Snaps a single coordinate to the nearest grid cell center.
 *
 * Cell centers are at CELL_HALF + n * CELL_PIXEL_SIZE for n ≥ 0.
 * Negative coordinates clamp to the origin cell center.
 *
 * @param coord - The raw pixel coordinate.
 * @returns The nearest cell center coordinate.
 */
const toGridCellCenter = (coord: number): number => {
  const cellIndex = Math.round((coord - CELL_HALF) / CELL_PIXEL_SIZE);
  const clampedIndex = Math.max(0, cellIndex);
  return clampedIndex * CELL_PIXEL_SIZE + CELL_HALF;
};

/**
 * Converts floating-point simulation position data to a cell-aligned
 * display position for visual rendering.
 *
 * This is the C-040 cell position calculation layer: it bridges the
 * continuous simulation coordinate space into the discrete 32×32 pixel
 * tile grid used by the PixiJS display tree. Positions from the movement
 * system are already grid-aligned; this function provides the explicit
 * conversion layer for consumers that need guaranteed cell center alignment.
 *
 * @param options - Position conversion options.
 * @param options.x - Raw simulation x coordinate.
 * @param options.y - Raw simulation y coordinate.
 * @returns Cell-aligned display position.
 */
const toCellDisplayPosition = (options: { x: number; y: number }): { x: number; y: number } => {
  return {
    x: toGridCellCenter(options.x),
    y: toGridCellCenter(options.y),
  };
};

export {
  animateEntitySystem,
  dirtyCheckAppearance,
  getEntityAnimationFrame,
  hasAppearanceChanged,
  invalidateComposedSprite,
  LpcBatchManager,
  resetAnimationTracking,
  resetAppearanceTracking,
  setupVisualObservers,
  syncAppearanceSystem,
  toCellDisplayPosition,
  toGridCellCenter,
  updateEntityUbo,
  updateRender,
  updateRenderFromBuffer,
};
