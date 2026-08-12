// packages/frontend/engine/src/components/path_follow.ts
//
// PathFollow — waypoint buffer for an agent following a path (C-379 AC-7).
//
// Written by a locomotion consumer (GOAP movement executor, party-follow
// goal provider, or a future click-to-move command) and read by the
// path-follow system in the Navigation slot, which converts the current
// waypoint into a Velocity that updateMovement resolves the same frame.
//
// Runtime-only: never serialized. The ECS serializer persists only
// Position/Appearance/CombatStats/Visual (ecs_serializer.ts), so PathFollow
// can never leak into a save snapshot (AC-10 watch point).

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

/** SoA storage for path-follow state. */
export const PathFollow = {
  /** Flat [x0,y0,x1,y1,...] world-pixel waypoints per entity. */
  waypoints: [] as Float32Array[],
  /** Index of the waypoint currently being approached. */
  index: [] as number[],
  /** Number of valid waypoints (waypoints.length / 2). */
  length: [] as number[],
  /** Movement speed in px/s for this agent. */
  speed: [] as number[],
  /** Repath when the goal cell changes or this deadline passes (ms). */
  repathAtMs: [] as number[],
  /** Stop this many pixels short of the final waypoint. */
  arriveRadius: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type PathFollowData = {
  waypoints: Float32Array;
  index: number;
  length: number;
  speed: number;
  repathAtMs: number;
  arriveRadius: number;
};

/**
 * Registers onSet and onGet observers for the PathFollow component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerPathFollowObservers = (world: World): void => {
  observe(world, onSet(PathFollow), (eid: number, params: PathFollowData) => {
    PathFollow.waypoints[eid] = params.waypoints;
    PathFollow.index[eid] = params.index;
    PathFollow.length[eid] = params.length;
    PathFollow.speed[eid] = params.speed;
    PathFollow.repathAtMs[eid] = params.repathAtMs;
    PathFollow.arriveRadius[eid] = params.arriveRadius;
  });

  observe(
    world,
    onGet(PathFollow),
    (eid: number): PathFollowData => ({
      waypoints: PathFollow.waypoints[eid],
      index: PathFollow.index[eid] ?? 0,
      length: PathFollow.length[eid] ?? 0,
      speed: PathFollow.speed[eid] ?? 0,
      repathAtMs: PathFollow.repathAtMs[eid] ?? 0,
      arriveRadius: PathFollow.arriveRadius[eid] ?? 0,
    }),
  );
};
