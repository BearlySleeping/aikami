// packages/frontend/engine/src/systems/path_follow_system.ts
//
// PathFollowSystem — the single locomotion executor (C-379 AC-7).
//
// Reads PathFollow waypoints and writes Velocity toward the current
// waypoint. Runs in the worker's Navigation slot (step 5) BEFORE
// updateMovement in Resolution (step 6), so the velocity it writes is
// resolved the same frame — no lost frames, no facing desync.
//
// Locomotion has exactly one executor: GOAP picks a goal cell, A* produces
// waypoints, PathFollow writes Velocity, updateMovement resolves. No client
// service posts per-entity velocities.

import type { World } from 'bitecs';
import { addComponent, getComponent, hasComponent, query, removeComponent, set } from 'bitecs';
import { PathFollow } from '../components/path_follow.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { Velocity } from '../components/velocity.ts';

/** Cached query terms — created once per world to avoid per-frame overhead. */
const PATH_FOLLOW_QUERY_TERMS = [Position, PathFollow];

/**
 * Converts an entity's waypoint buffer to a path request.
 *
 * Not a public API — the system reads the component directly; consumers
 * write the component via `addComponent(world, eid, set(PathFollow, {...}))`.
 */

/**
 * Returns true when the entity has a PathFollow component with a live path.
 *
 * World-aware: uses bitECS hasComponent so a component removed from THIS
 * world is not reported as active via stale module-global SoA arrays.
 *
 * @param world - The bitECS world.
 * @param eid - The entity ID.
 */
export const hasActivePath = (world: World, eid: number): boolean => {
  if (!hasComponent(world, eid, PathFollow)) {
    return false;
  }
  const length = PathFollow.length[eid] ?? 0;
  const index = PathFollow.index[eid] ?? 0;
  return length > 0 && index < length;
};
/**
 * Steers entities that carry PathFollow toward their current waypoint.
 *
 * For each entity with Position + PathFollow:
 * 1. If the path is finished (index >= length), zero velocity and clear
 *    the component.
 * 2. Otherwise move toward waypoint[index] at `speed` px/s; when within
 *    `arriveRadius` (final waypoint) or the waypoint itself (intermediate),
 *    advance the index.
 *
 * The repath deadline is NOT enforced here — a goal provider that detects
 * a stale goal (unreachable, or the goal cell changed) rewrites the
 * component. The system only executes what is in the buffer, so a
 * provider that backs off (repathAtMs in the future) simply leaves the
 * agent standing still — the pre-contract behaviour.
 *
 * @param world - The bitECS world.
 * @param deltaMs - Elapsed time since last frame in milliseconds.
 */
export const updatePathFollow = (world: World, deltaMs: number): void => {
  if (!world || deltaMs <= 0) {
    return;
  }

  const deltaSeconds = deltaMs / 1000;

  for (const eid of query(world, PATH_FOLLOW_QUERY_TERMS)) {
    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    const index = PathFollow.index[eid] ?? 0;
    const length = PathFollow.length[eid] ?? 0;
    const speed = PathFollow.speed[eid] ?? 0;
    const arriveRadius = PathFollow.arriveRadius[eid] ?? 0;

    // Path finished — stop and detach the component.
    if (length <= 0 || index >= length) {
      addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
      removeComponent(world, eid, PathFollow);
      continue;
    }

    const waypoints = PathFollow.waypoints[eid];
    if (!waypoints) {
      addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
      removeComponent(world, eid, PathFollow);
      continue;
    }

    const targetX = waypoints[index * 2];
    const targetY = waypoints[index * 2 + 1];
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;
    const distSq = dx * dx + dy * dy;

    const isFinal = index === length - 1;
    const arrivalRadiusSq = isFinal
      ? Math.max(arriveRadius, 0.5) ** 2
      : (speed * deltaSeconds) ** 2 + 0.5;

    if (distSq <= arrivalRadiusSq) {
      // Reached this waypoint — advance.
      PathFollow.index[eid] = index + 1;
      if (index + 1 >= length) {
        // Final waypoint reached — stop.
        addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
        removeComponent(world, eid, PathFollow);
        continue;
      }
      // Continue toward the next waypoint on the following frame.
      addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
      continue;
    }

    // Steer toward the waypoint at the agent's speed.
    const dist = Math.sqrt(distSq);
    const velX = (dx / dist) * speed;
    const velY = (dy / dist) * speed;
    addComponent(world, eid, set(Velocity, { x: velX, y: velY }));
  }
};
