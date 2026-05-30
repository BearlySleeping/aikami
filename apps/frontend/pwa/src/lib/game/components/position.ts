// apps/frontend/pwa/src/lib/game/components/position.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Position — SoA component (Structure of Arrays)
// ---------------------------------------------------------------------------

/** SoA storage for 2D world-space positions. Indexed by entity ID. */
export const Position = {
  x: [] as number[],
  y: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type PositionData = {
  x: number;
  y: number;
};

/**
 * Registers onSet and onGet observers for the Position component on the
 * given world. Must be called once per world before any entity uses Position.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerPositionObservers = (world: World): void => {
  observe(world, onSet(Position), (eid: number, params: PositionData) => {
    Position.x[eid] = params.x;
    Position.y[eid] = params.y;
  });

  observe(
    world,
    onGet(Position),
    (eid: number): PositionData => ({
      x: Position.x[eid],
      y: Position.y[eid],
    }),
  );
};
