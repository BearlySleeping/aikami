// packages/frontend/engine/src/components/transition.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Transition — SoA component for map transition zones
//
// Marks an entity (typically a static trigger region) as a map boundary.
// When the player steps into the zone, the zoning system emits a
// ZONE_TRIGGERED event to initiate a map load.
//
// Contract: C-138 Map Transitions
// ---------------------------------------------------------------------------

/** SoA storage for transition zone data. Indexed by entity ID. */
export const Transition = {
  /** Target map filename or ID. */
  targetMap: [] as string[],
  /** Target X pixel coordinate on the destination map. */
  targetX: [] as number[],
  /** Target Y pixel coordinate on the destination map. */
  targetY: [] as number[],
  /** Pixel width of the trigger rectangle (for bounding-box overlap). */
  width: [] as number[],
  /** Pixel height of the trigger rectangle. */
  height: [] as number[],
  /**
   * Whether this zone has already been triggered.
   *
   * Set to `true` by the zoning system on the first overlap to
   * prevent multiple triggers from the same zone in one frame.
   */
  triggered: [] as boolean[],
};

/** Payload shape stored/retrieved via observers. */
export type TransitionData = {
  targetMap: string;
  targetX: number;
  targetY: number;
  width: number;
  height: number;
  triggered: boolean;
};

/**
 * Registers onSet and onGet observers for the Transition component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerTransitionObservers = (world: World): void => {
  observe(world, onSet(Transition), (eid: number, params: TransitionData) => {
    Transition.targetMap[eid] = params.targetMap;
    Transition.targetX[eid] = params.targetX;
    Transition.targetY[eid] = params.targetY;
    Transition.width[eid] = params.width;
    Transition.height[eid] = params.height;
    Transition.triggered[eid] = params.triggered;
  });

  observe(
    world,
    onGet(Transition),
    (eid: number): TransitionData => ({
      targetMap: Transition.targetMap[eid],
      targetX: Transition.targetX[eid],
      targetY: Transition.targetY[eid],
      width: Transition.width[eid],
      height: Transition.height[eid],
      triggered: Transition.triggered[eid],
    }),
  );
};
