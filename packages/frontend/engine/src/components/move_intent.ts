// packages/frontend/engine/src/components/move_intent.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// MoveIntent — discrete movement intent for intent→resolve→apply pipeline
//
// Contract C-173: Input and AI systems write to MoveIntent instead of
// directly modifying GridPosition. The CollisionSystem reads MoveIntent,
// checks the SpatialGrid for occupancy, performs bitmask collision
// resolution, and conditionally applies the translation to GridPosition.
//
// Values are discrete tile offsets (-1, 0, or 1 per axis).
// ---------------------------------------------------------------------------

/** SoA storage for movement intents. */
export const MoveIntent = {
  /** X-axis movement intent: -1 (left), 0 (none), 1 (right). */
  dx: [] as number[],
  /** Y-axis movement intent: -1 (up), 0 (none), 1 (down). */
  dy: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type MoveIntentData = {
  dx: number;
  dy: number;
};

/**
 * Registers onSet and onGet observers for the MoveIntent component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerMoveIntentObservers = (world: World): void => {
  observe(world, onSet(MoveIntent), (eid: number, params: MoveIntentData) => {
    MoveIntent.dx[eid] = params.dx;
    MoveIntent.dy[eid] = params.dy;
  });

  observe(
    world,
    onGet(MoveIntent),
    (eid: number): MoveIntentData => ({
      dx: MoveIntent.dx[eid],
      dy: MoveIntent.dy[eid],
    }),
  );
};
