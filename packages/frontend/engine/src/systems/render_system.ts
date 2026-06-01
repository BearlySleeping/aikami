// packages/frontend/engine/src/systems/render_system.ts
import type { World } from 'bitecs';
import { addComponent, getComponent, query, set } from 'bitecs';
import { Buffer, BufferUsage, type Container, Graphics, Rectangle } from 'pixi.js';
import type { LpcLayerRecipe } from '../components/appearance.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import type { SpriteData } from '../components/sprite.ts';
import { Sprite } from '../components/sprite.ts';
import { COMPONENT_STRIDE } from '../config/memory_config.ts';
import type { SpriteComposer } from '../rendering/sprite_composer.ts';
import { packRecipeToUboBuffer } from '../rendering/sprite_composer.ts';

// ---------------------------------------------------------------------------
// RenderSystem — sync bitECS entities to PixiJS display objects
// ---------------------------------------------------------------------------

/**
 * Default cell geometry dimensions in pixels.
 *
 * Used to pre-assign {@link filterArea} bounds so the PixiJS renderer
 * skips per-frame boundary recalculations for static-sized entities.
 */
const CELL_GEOMETRY_RECT = new Rectangle(0, 0, 32, 32);

/** Cached query terms — entities with Position + Sprite are rendered. */
const RENDER_QUERY_TERMS = [Position, Sprite];

/**
 * Synchronizes bitECS entity positions to their PixiJS display objects.
 *
 * Runs every frame after the movement system. For each entity with both a
 * {@link Position} and {@link Sprite} component, updates the PixiJS
 * container transform to match the world-space position.
 *
 * Entities without a `displayObject` are skipped — the display object is
 * created lazily in {@link ensureDisplayObject} and stored back via
 * {@link addComponent}.
 *
 * Off-screen entities are hidden via `visible = false` to skip GPU
 * draw calls (spatial culling).
 *
 * @param world - The bitECS world.
 * @param stage - The PixiJS stage container to add sprites to.
 */
const updateRender = (world: World, stage: Container): void => {
  if (!world || !stage) {
    return;
  }

  const entities = query(world, RENDER_QUERY_TERMS);
  for (const eid of entities) {
    const spriteData = getComponent(world, eid, Sprite) as SpriteData | undefined;
    if (!spriteData) {
      continue;
    }

    let displayObject = spriteData.displayObject;
    if (!displayObject) {
      displayObject = ensureDisplayObject(spriteData, stage);
      if (!displayObject) {
        continue;
      }
      // Store the display object back into the component arrays
      addComponent(
        world,
        eid,
        set(Sprite, {
          ...spriteData,
          displayObject,
        }),
      );
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
      pos.x + 32 < stageBounds.x ||
      pos.x > stageBounds.x + stageBounds.width ||
      pos.y + 32 < stageBounds.y ||
      pos.y > stageBounds.y + stageBounds.height;

    displayObject.visible = !isOffScreen;
  }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Creates and returns a PixiJS display object for the given sprite data.
 *
 * For the MVP, generates a colored rectangle via {@link Graphics} if no
 * texture key is provided. When texture atlases are available later, this
 * will use {@link PixiSprite} with `Assets.load()`.
 *
 * **Optimization flags applied:**
 * - `eventMode = 'none'` — bypasses layout hit-testing (character
 *   sprites are not interactive; interaction is handled via spatial
 *   queries against entity positions, not DOM events).
 * - `filterArea` — pre-assigned to match cell geometry bounds so the
 *   PixiJS renderer skips per-frame `getBounds()` recalculations.
 *
 * @param spriteData - The sprite component data.
 * @param stage - The PixiJS stage to add the new display object to.
 * @returns The created display object, or `undefined` on failure.
 */
const ensureDisplayObject = (spriteData: SpriteData, stage: Container): Container | undefined => {
  const { tint } = spriteData;

  const graphic = new Graphics();
  graphic.rect(0, 0, 32, 32);
  graphic.fill({ color: tint });

  // Per-contract C-032: bypass layout hit-tests for character visuals
  graphic.eventMode = 'none';
  // Pre-assign filter area to avoid per-frame bounds recalc overhead
  graphic.filterArea = CELL_GEOMETRY_RECT;

  stage.addChild(graphic);
  return graphic;
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
 * to keep snapshot comparison fast. Palette changes are structural
 * changes and will be caught by the caller's own dirty check.
 *
 * @param recipes - The current layer recipes.
 * @returns A JSON-stringified fingerprint for fast comparison.
 */
const recipeStructuralFingerprint = (recipes: readonly LpcLayerRecipe[]): string => {
  return JSON.stringify(recipes.map((r) => (r ? { s: r.slot, a: r.assetId } : null)));
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
  const fingerprint = recipeStructuralFingerprint(recipes);
  const previous = uboRecipeSnapshots.get(eid);

  if (previous === fingerprint) {
    return false;
  }

  uboRecipeSnapshots.set(eid, fingerprint);
  return true;
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

export {
  dirtyCheckAppearance,
  hasAppearanceChanged,
  invalidateComposedSprite,
  updateEntityUbo,
  updateRender,
  updateRenderFromBuffer,
};
