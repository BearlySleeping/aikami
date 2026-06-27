// packages/frontend/engine/src/components/spatial_link.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// SpatialLink — intrusive doubly-linked list for grid cell overlap
//
// Contract C-173: When multiple entities share the same grid cell, the
// SpatialGrid dense array stores the head EID, and SpatialLink.next/prev
// chain the remaining entities. This allows O(1) insertion at head and
// O(k) traversal where k is the number of entities in the cell.
//
// Sentinel value: EID 0 means null (end of list). bitECS reserves EID 0.
// ---------------------------------------------------------------------------

/** SoA storage for linked list pointers. */
export const SpatialLink = {
  /** Next entity in the same grid cell's linked list (0 = null). */
  next: [] as number[],
  /** Previous entity in the linked list (0 = null). */
  prev: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type SpatialLinkData = {
  next: number;
  prev: number;
};

/**
 * Registers onSet and onGet observers for the SpatialLink component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerSpatialLinkObservers = (world: World): void => {
  observe(world, onSet(SpatialLink), (eid: number, params: SpatialLinkData) => {
    SpatialLink.next[eid] = params.next;
    SpatialLink.prev[eid] = params.prev;
  });

  observe(
    world,
    onGet(SpatialLink),
    (eid: number): SpatialLinkData => ({
      next: SpatialLink.next[eid],
      prev: SpatialLink.prev[eid],
    }),
  );
};
