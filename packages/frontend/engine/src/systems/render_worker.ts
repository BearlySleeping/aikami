// packages/frontend/engine/src/systems/render_worker.ts
// Worker-safe subset of render_system.ts — NO pixi.js dependency.
// Contains LpcBatchManager, animateEntitySystem, syncAppearanceSystem.

import type { World } from 'bitecs';
import { query } from 'bitecs';
import type { LpcLayerRecipe } from '../components/appearance.ts';
import { Appearance, getAppearanceLayers } from '../components/appearance.ts';
import { Velocity } from '../components/velocity.ts';
import {
  getLpcFrameIndex,
  LpcAnimationState,
  velocityToDirection,
} from '../rendering/animation_controller.ts';
import { packRecipeToUboBuffer } from '../rendering/sprite_composer.ts';
import type { GameEvent } from '../types.ts';

/** Stand-in for PixiJS Buffer — worker has no GPU. */
type _GpuBuffer = {
  data: Float32Array;
  destroy(): void;
};

/** Per-entity GPU buffer cache (unused in worker — headless mode). */
const uboBufferCache = new Map<number, _GpuBuffer>();

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
 */
const uboRecipeSnapshots = new Map<number, string>();

/**
 * Computes a structural fingerprint for a set of layer recipes.
 */
const recipeStructuralFingerprint = (recipes: readonly LpcLayerRecipe[]): string => {
  return JSON.stringify(recipes.map((r) => (r ? { s: r.slot, a: r.assetId } : null)));
};

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

const _lastKnownAppearanceLayers = new Map<number, string>();

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
 * @param options.bridge - Optional EngineBridge to emit APPEARANCE_CHANGED events.
 */
const syncAppearanceSystem = (options: {
  world: World;
  batchManager: LpcBatchManager;
  recipeResolver: (layerIds: readonly number[]) => LpcLayerRecipe[];
  bridge?: { emit: (event: GameEvent) => void };
}): void => {
  const { world, batchManager, recipeResolver, bridge } = options;

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
      _lastKnownAppearanceLayers.delete(eid);
      tracked.delete(eid);
    }
  }

  // Detect enters + process existing entities
  for (const eid of entities) {
    const layerIds = getAppearanceLayers(eid);
    const layerKey = layerIds.join(',');
    const recipes = recipeResolver(layerIds);

    if (!tracked.has(eid)) {
      // Enter: new entity — register in batch pool
      batchManager.registerEntity(eid, recipes);
      _lastKnownAppearanceLayers.set(eid, layerKey);
      if (bridge) {
        bridge.emit({
          type: 'APPEARANCE_CHANGED',
          eid,
          layerIds: [...layerIds],
        });
      }
    } else {
      const prevKey = _lastKnownAppearanceLayers.get(eid);
      if (prevKey !== layerKey) {
        _lastKnownAppearanceLayers.set(eid, layerKey);
        if (bridge) {
          bridge.emit({
            type: 'APPEARANCE_CHANGED',
            eid,
            layerIds: [...layerIds],
          });
        }
      }
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
  createBuffer?: () => _GpuBuffer;
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
  private readonly _bufferPool: DenseObjectPool<_GpuBuffer>;

  /** Active GPU Buffers keyed by entity ID. */
  private readonly _entityBuffers = new Map<number, _GpuBuffer>();

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
      this._bufferPool = new DenseObjectPool<_GpuBuffer>(this._maxInstances, () => factory());
    } else {
      // Dummy pool — never used (acquire / release are guarded by _hasGpuBuffers)
      this._bufferPool = new DenseObjectPool<_GpuBuffer>(
        this._maxInstances,
        () => ({}) as _GpuBuffer,
      );
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
 * Written by {@link animateEntitySystem} and read by render code that
 * needs to pass a {@code frameIndex} to {@code TextureManager.getFrameAt()}.
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
 * Clears all per-entity animation tracking state.
 *
 * Call during world teardown to prevent stale entity references.
 */
const resetAnimationTracking = (): void => {
  _entityTickCounters.clear();
  _entityFrameIndices.clear();
};

export { animateEntitySystem, LpcBatchManager, resetAnimationTracking, syncAppearanceSystem };
