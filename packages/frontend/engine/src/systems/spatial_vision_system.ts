// packages/frontend/engine/src/systems/spatial_vision_system.ts

import type { World } from 'bitecs';
import { query } from 'bitecs';
import { GridPosition } from '../components/grid_position.ts';
import { ObserverState, VisionObserver } from '../components/vision_observer.ts';
import { VisionVisible } from '../components/vision_visible.ts';
import { castDdaVisionCone } from '../math/vision/dda_raycaster.ts';
import { castShadowcastingFov } from '../math/vision/shadowcasting.ts';
import { isEntityOffscreen } from './macro_simulation_system.ts';

// ---------------------------------------------------------------------------
// SpatialVisionSystem — bitECS perception tick
//
// Contract C-190: Runs inside the Web Worker each frame. For each entity
// carrying VisionObserver + GridPosition, evaluates its stateMask and
// selects between DDA raycasting (idle/patrol) and Recursive Shadowcasting
// (suspicious/alert). Updates VisionVisible.visibleByMask on target entities
// that fall within visible cells.
//
// Uses a Dual Spatial Hash approach:
//   Static Map  — read-only wall grid (set once per tilemap change).
//   Dynamic Map — per-frame actor position index (Map<cellIndex → eid[]>).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Wall-check function: (gx, gy) => true if cell blocks vision. */
let _wallCheck: ((gx: number, gy: number) => boolean) | undefined;

/** Grid width in tiles. */
let _gridW = 0;

/** Grid height in tiles. */
let _gridH = 0;

/** Pre-allocated visibility map (0 = hidden, 1 = visible). */
let _visibilityMap: Uint8Array | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Configures the vision system's static wall grid.
 *
 * Must be called after the collision grid is initialized. The wall-check
 * function is stored and used by both DDA and shadowcasting algorithms
 * to terminate rays and cast shadows.
 *
 * @param wallCheck - Function returning true if the cell blocks vision.
 * @param gridW - Grid width in tiles.
 * @param gridH - Grid height in tiles.
 */
export const setVisionGrid = (
  wallCheck: (gx: number, gy: number) => boolean,
  gridW: number,
  gridH: number,
): void => {
  _wallCheck = wallCheck;
  _gridW = gridW;
  _gridH = gridH;

  // Allocate visibility map sized to the grid
  _visibilityMap = new Uint8Array(gridW * gridH);
};

/**
 * Clears the vision system's grid reference.
 */
export const clearVisionGrid = (): void => {
  _wallCheck = undefined;
  _gridW = 0;
  _gridH = 0;
  _visibilityMap = undefined;
};

/**
 * Ticks the SpatialVisionSystem for one frame.
 *
 * For each entity with `VisionObserver + GridPosition`:
 * 1. Builds a dynamic actor index from all target entities.
 * 2. Zeros the visibility map.
 * 3. Runs DDA or shadowcasting depending on the observer's stateMask.
 * 4. Cross-references the visibility map against the dynamic index.
 * 5. Updates `VisionVisible.visibleByMask` on each visible target.
 *
 * @param world - The bitECS world.
 */
export const updateSpatialVision = (world: World): void => {
  if (!_wallCheck || !_visibilityMap || _gridW <= 0 || _gridH <= 0) {
    return;
  }

  const wallCheck = _wallCheck;
  const visibilityMap = _visibilityMap;
  const gridW = _gridW;
  const gridH = _gridH;

  // ── Step 1: Build dynamic actor index ──
  //
  // Maps cell index → array of entity IDs. Only includes entities that have
  // VisionVisible (i.e., entities that CAN be seen). Excludes the observer
  // entities themselves (they don't need to be visible to themselves).
  const dynamicMap = _buildDynamicActorIndex(world, gridW);

  // ── Step 2: Process each observer ──
  //
  // Use bitECS query for correct entity existence — this handles
  // removed entities whose SoA arrays still have stale values.
  for (const observerEid of query(world, [VisionObserver, GridPosition])) {
    // ── C-194 AC-1: Skip observers in inactive zones ──
    if (isEntityOffscreen(observerEid)) {
      continue;
    }

    const fovRadius = VisionObserver.fovRadius[observerEid];
    if (fovRadius === undefined || fovRadius <= 0) {
      continue;
    }

    const gx = GridPosition.x[observerEid];
    const gy = GridPosition.y[observerEid];
    if (gx === undefined || gy === undefined) {
      continue;
    }

    const lookDir = VisionObserver.lookDirection[observerEid] ?? 0;
    const fovAngle = VisionObserver.fovAngle[observerEid] ?? Math.PI;
    const stateMask = VisionObserver.stateMask[observerEid] ?? ObserverState.idle;

    // Determine observer faction bit (entity ID as a simple faction proxy)
    // In production, a Faction component would provide this. For now, each
    // observer entity is its own "faction" — bit = 1 << (eid % 31).
    const observerBit = 1 << (observerEid % 31);

    // ── Step 2a: Zero visibility map ──
    visibilityMap.fill(0);

    // ── Step 2b: Run vision algorithm ──
    if (stateMask === ObserverState.idle) {
      // Patrol vision: cheap DDA raycasting
      castDdaVisionCone({
        ox: gx,
        oy: gy,
        lookDir,
        fovAngle,
        maxRadius: Math.floor(fovRadius),
        isWall: wallCheck,
        visibleMap: visibilityMap,
        gridW,
        gridH,
      });
    } else {
      // Alert vision: expensive recursive shadowcasting
      castShadowcastingFov({
        cx: gx,
        cy: gy,
        lookDir,
        fovAngle,
        maxRadius: Math.floor(fovRadius),
        isWall: wallCheck,
        visibleMap: visibilityMap,
        gridW,
        gridH,
      });
    }

    // ── Step 2c: Cross-reference visible cells → dynamic actors ──
    //
    // For each visible cell, look up which actors are there and OR
    // the observer's faction bit into their visibleByMask.
    _applyVisibilityToActors(visibilityMap, dynamicMap, observerBit, gridW, gridH);
  }
};

/**
 * Resets all VisionVisible.visibleByMask values to 0.
 *
 * Called at the start of each frame before updateSpatialVision runs,
 * so entities that were visible last frame but not this frame are cleared.
 */
export const resetVisibilityMasks = (): void => {
  const count = VisionVisible.visibleByMask.length;
  for (let i = 0; i < count; i++) {
    VisionVisible.visibleByMask[i] = 0;
  }
};

// ---------------------------------------------------------------------------
// Internal: Dynamic actor index
// ---------------------------------------------------------------------------

/**
 * Builds a per-frame index mapping cell indices to arrays of entity IDs.
 *
 * Only includes entities that have both GridPosition and VisionVisible
 * (i.e., entities that CAN be seen by observers).
 *
 * @param world - The bitECS world.
 * @param gridW - Grid width for index computation.
 * @returns Map of `cellIndex → eid[]`.
 */
const _buildDynamicActorIndex = (_world: World, gridW: number): Map<number, number[]> => {
  const map = new Map<number, number[]>();

  // Scan VisionVisible as the sparse marker for "seeable" entities
  const count = VisionVisible.visibleByMask.length;
  for (let eid = 0; eid < count; eid++) {
    const gx = GridPosition.x[eid];
    const gy = GridPosition.y[eid];
    if (gx === undefined || gy === undefined) {
      continue;
    }

    const cellIndex = gy * gridW + gx;
    const existing = map.get(cellIndex);
    if (existing) {
      existing.push(eid);
    } else {
      map.set(cellIndex, [eid]);
    }
  }

  return map;
};

// ---------------------------------------------------------------------------
// Internal: Apply visibility to dynamic actors
// ---------------------------------------------------------------------------

/**
 * Cross-references the visibility map against the dynamic actor index.
 *
 * For each visible cell that contains actors, ORs the observer's faction
 * bit into each actor's `VisionVisible.visibleByMask`.
 *
 * @param visibilityMap - The post-cast visibility map (1 = visible).
 * @param dynamicMap - The per-frame actor index.
 * @param observerBit - Faction bit for the current observer.
 * @param gridW - Grid width.
 * @param gridH - Grid height.
 */
const _applyVisibilityToActors = (
  visibilityMap: Uint8Array,
  dynamicMap: Map<number, number[]>,
  observerBit: number,
  gridW: number,
  gridH: number,
): void => {
  const totalCells = gridW * gridH;
  for (let i = 0; i < totalCells; i++) {
    if (visibilityMap[i] !== 1) {
      continue;
    }

    const actors = dynamicMap.get(i);
    if (!actors) {
      continue;
    }

    for (let a = 0; a < actors.length; a++) {
      const targetEid = actors[a];
      const current = VisionVisible.visibleByMask[targetEid] ?? 0;
      VisionVisible.visibleByMask[targetEid] = current | observerBit;
    }
  }
};
