// apps/frontend/pwa/src/lib/game/components/velocity.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Velocity — SoA component (Structure of Arrays)
// ---------------------------------------------------------------------------

/** SoA storage for 2D velocity in pixels per second. Indexed by entity ID. */
export const Velocity = {
  x: [] as number[],
  y: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type VelocityData = {
  x: number;
  y: number;
};

/**
 * Registers onSet and onGet observers for the Velocity component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerVelocityObservers = (world: World): void => {
  observe(world, onSet(Velocity), (eid: number, params: VelocityData) => {
    Velocity.x[eid] = params.x;
    Velocity.y[eid] = params.y;
  });

  observe(
    world,
    onGet(Velocity),
    (eid: number): VelocityData => ({
      x: Velocity.x[eid],
      y: Velocity.y[eid],
    }),
  );
};
