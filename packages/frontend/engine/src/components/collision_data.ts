// packages/frontend/engine/src/components/collision_data.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// CollisionData — bitmask collision layers for grid-based entities
//
// Contract C-173: Each entity carries a `layer` (what it IS) and `mask`
// (what it COLLIDES WITH). The CollisionSystem performs a bitwise AND
// between the moving entity's mask and the occupying entity's layer —
// a non-zero result means a collision and the move is blocked.
//
// Predefined collision layers (powers of two for bitmask compatibility):
//   WALL  (1)   — Solid tiles, map borders
//   PLAYER (2)  — The player character
//   NPC    (4)  — Non-player characters
//   ENEMY  (8)  — Hostile entities
//   ITEM   (16) — Pickup items (no collision, just spatial awareness)
// ---------------------------------------------------------------------------

/** Predefined bitmask collision layers. */
export const CollisionLayer = {
  wall: 1,
  player: 2,
  npc: 4,
  enemy: 8,
  item: 16,
} as const;

/** Type alias for CollisionLayer values. */
export type CollisionLayer = (typeof CollisionLayer)[keyof typeof CollisionLayer];

/** SoA storage for collision data. */
export const CollisionData = {
  /** What this entity IS (bitmask, e.g. CollisionLayer.wall). */
  layer: [] as number[],
  /** What this entity COLLIDES WITH (bitmask, e.g. CollisionLayer.wall | CollisionLayer.player). */
  mask: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type CollisionDataPayload = {
  layer: number;
  mask: number;
};

/**
 * Registers onSet and onGet observers for the CollisionData component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerCollisionDataObservers = (world: World): void => {
  observe(world, onSet(CollisionData), (eid: number, params: CollisionDataPayload) => {
    CollisionData.layer[eid] = params.layer;
    CollisionData.mask[eid] = params.mask;
  });

  observe(
    world,
    onGet(CollisionData),
    (eid: number): CollisionDataPayload => ({
      layer: CollisionData.layer[eid],
      mask: CollisionData.mask[eid],
    }),
  );
};
