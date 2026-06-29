// packages/frontend/engine/src/components/vision_observer.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// VisionObserver — NPC perception parameters for SpatialVisionSystem
//
// Contract C-190: Each NPC with vision carries this component. The
// SpatialVisionSystem reads these parameters to select between DDA
// raycasting (idle/patrol) and Recursive Shadowcasting (alert/suspicious).
// ---------------------------------------------------------------------------

/** Observer state flags for algorithm selection. */
export const ObserverState = {
  /** Idle or patrolling — uses cheap DDA raycasting. */
  idle: 0,
  /** Suspicious, alert, or confused — uses expensive shadowcasting FOV. */
  alert: 1,
} as const;

/** Type alias for ObserverState values. */
export type ObserverState = (typeof ObserverState)[keyof typeof ObserverState];

/** SoA storage for vision observer parameters. */
export const VisionObserver = {
  /** Maximum tile distance for vision. */
  fovRadius: [] as number[],
  /** Vision cone arc width in radians (e.g., Math.PI / 2 = 90° cone). */
  fovAngle: [] as number[],
  /** Current look direction heading in radians [0, 2π). */
  lookDirection: [] as number[],
  /**
   * Observer state flag.
   * 0 = idle/patrol (DDA raycasting), 1 = suspicious/alert (shadowcasting).
   */
  stateMask: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type VisionObserverData = {
  fovRadius: number;
  fovAngle: number;
  lookDirection: number;
  stateMask: number;
};

/**
 * Registers onSet and onGet observers for the VisionObserver component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerVisionObserverObservers = (world: World): void => {
  observe(world, onSet(VisionObserver), (eid: number, params: VisionObserverData) => {
    VisionObserver.fovRadius[eid] = params.fovRadius;
    VisionObserver.fovAngle[eid] = params.fovAngle;
    VisionObserver.lookDirection[eid] = params.lookDirection;
    VisionObserver.stateMask[eid] = params.stateMask;
  });

  observe(
    world,
    onGet(VisionObserver),
    (eid: number): VisionObserverData => ({
      fovRadius: VisionObserver.fovRadius[eid],
      fovAngle: VisionObserver.fovAngle[eid],
      lookDirection: VisionObserver.lookDirection[eid],
      stateMask: VisionObserver.stateMask[eid],
    }),
  );
};
