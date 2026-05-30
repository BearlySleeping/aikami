// apps/frontend/game/src/engine/systems/movement_system.ts
import type { World } from 'bitecs';
import { addComponent, getComponent, query, set } from 'bitecs';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import type { VelocityData } from '../components/velocity.ts';
import { Velocity } from '../components/velocity.ts';

// ---------------------------------------------------------------------------
// MovementSystem — update Position from Velocity each frame
// ---------------------------------------------------------------------------

/** Cached query terms — created once per world to avoid per-frame overhead. */
const MOVEMENT_QUERY_TERMS = [Position, Velocity];

/**
 * Updates world-space positions for all entities that have both a
 * {@link Position} and a {@link Velocity} component.
 *
 * Runs every frame at ~60fps via the PixiJS ticker. Pure imperative —
 * zero framework reactivity. Position data stays in bitECS raw arrays.
 *
 * @param world - The bitECS world.
 * @param deltaMs - Elapsed time since last frame in milliseconds.
 */
const updateMovement = (world: World, deltaMs: number): void => {
  if (!world) {
    return;
  }

  const deltaSeconds = deltaMs / 1000;
  if (deltaSeconds <= 0) {
    return;
  }

  const entities = query(world, MOVEMENT_QUERY_TERMS);
  for (const eid of entities) {
    const vel = getComponent(world, eid, Velocity) as VelocityData | undefined;
    if (!vel || (vel.x === 0 && vel.y === 0)) {
      continue;
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    addComponent(
      world,
      eid,
      set(Position, {
        x: pos.x + vel.x * deltaSeconds,
        y: pos.y + vel.y * deltaSeconds,
      }),
    );
  }
};

export { updateMovement };
