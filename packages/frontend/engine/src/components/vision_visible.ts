// packages/frontend/engine/src/components/vision_visible.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// VisionVisible — per-entity visibility tracking
//
// Contract C-190: Updated by SpatialVisionSystem each tick. The
// `visibleByMask` field is a bitmask indicating which factions or
// individual observers can currently see this entity.
//
// Example: If the player (faction bit 1) and NPC guard #3 (faction bit 2)
// both see this entity, `visibleByMask = 0b11` = 3.
// ---------------------------------------------------------------------------

/** SoA storage for visibility state. */
export const VisionVisible = {
  /**
   * Bitmask of factions/observers that can currently see this entity.
   *
   * Each bit represents a faction or observer. A value of 0 means the
   * entity is not visible to any observer this tick.
   */
  visibleByMask: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type VisionVisibleData = {
  visibleByMask: number;
};

/**
 * Registers onSet and onGet observers for the VisionVisible component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerVisionVisibleObservers = (world: World): void => {
  observe(world, onSet(VisionVisible), (eid: number, params: VisionVisibleData) => {
    VisionVisible.visibleByMask[eid] = params.visibleByMask;
  });

  observe(
    world,
    onGet(VisionVisible),
    (eid: number): VisionVisibleData => ({
      visibleByMask: VisionVisible.visibleByMask[eid],
    }),
  );
};
