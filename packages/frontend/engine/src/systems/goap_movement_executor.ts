// packages/frontend/engine/src/systems/goap_movement_executor.ts
//
// GoapMovementExecutor — goal-cell → path-request bridge (C-379 AC-7).
//
// GOAP picks an action; a handful of actions imply a destination. This
// executor is the minimal "where" layer the contract calls for: it reads
// each agent's currentActionId, and for movement-capable actions requests
// an A* path to a goal cell, attaching a PathFollow component that the
// path-follow system converts to Velocity.
//
// Repath storm guard: an agent whose goal is unreachable (A* returns no
// path) is given a `repathAtMs` deadline in the future — the executor does
// not re-request every tick. A new goal cell (or a changed one) resets
// the deadline so a legitimately reachable path is still found.

import type { World } from 'bitecs';
import { addComponent, getComponent, query, set } from 'bitecs';
import { GoapAgent } from '../components/goap_agent.ts';
import { GridPosition } from '../components/grid_position.ts';
import { PathFollow } from '../components/path_follow.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { findPath, type GridCell } from '../math/astar.ts';
import { getTerrainGrid, getTerrainTileSize } from './collision_system.ts';
import { hasActivePath } from './path_follow_system.ts';

/** Cached query terms — created once per world to avoid per-frame overhead. */
const GOAP_QUERY_TERMS = [GoapAgent, Position, GridPosition];

/**
 * Movement-capable GOAP actions (default registry actionIds).
 *
 * 0  = Idle — the scheduler always falls back to it (cost 0, no
 *      preconditions), so idle agents wander toward a nearby walkable goal
 *      (C-379 AC-7: "NPCs walk paths" — a villager with nothing to do
 *      still strolls rather than freezing at spawn).
 * 2  = Go to pub
 * 4  = Go to workplace
 * 7  = Pursue target (goal = target's current cell)
 * 10 = Combat — move to range (goal = target's current cell)
 */
const MOVEMENT_ACTION_IDS = new Set<number>([0, 2, 4, 7, 10]);

/** Wander radius in tiles around the agent's spawn for non-target actions. */
const WANDER_RADIUS_TILES = 4;

/** Repath backoff for unreachable goals (ms). */
const UNREACHABLE_BACKOFF_MS = 2000;

/** Repath cadence for idle wanderers (ms) — strolling, not sprinting. */
const IDLE_WANDER_BACKOFF_MS = 4000;

/** Speed for GOAP walkers (px/s). */
const GOAP_WALK_SPEED = 60;

/** Arrival radius for the final waypoint (px). */
const GOAP_ARRIVE_RADIUS = 6;

/** Deterministic pseudo-random per entity — stable across ticks. */
const _hash = (seed: number): number => {
  let h = seed | 0;
  h = h ^ 61 ^ (h >>> 16);
  h = (h + (h << 3)) | 0;
  h ^= h >>> 4;
  h = (h * 0x27d4eb2d) | 0;
  h ^= h >>> 15;
  return h >>> 0;
};

/**
 * Builds a wander goal cell near the agent's current cell.
 *
 * Deterministic per entity so the goal does not jitter every tick; the
 * hash seed uses the entity ID plus the current minute so agents do not
 * all march to the same cell.
 *
 * @param eid - The agent entity ID.
 * @param fromX - Current grid X.
 * @param fromY - Current grid Y.
 * @param width - Terrain width.
 * @param height - Terrain height.
 * @param cost - Terrain cost array.
 * @returns A walkable goal cell, or undefined when none is found.
 */
const _pickWanderGoal = (
  eid: number,
  fromX: number,
  fromY: number,
  width: number,
  height: number,
  cost: Uint8Array,
): GridCell | undefined => {
  const seed = _hash(eid * 7919 + Math.floor(Date.now() / 60_000));
  for (let attempt = 0; attempt < 8; attempt++) {
    // Unsigned shift + non-negative modulo: (x % m + m) % m keeps the
    // offset in [-WANDER_RADIUS_TILES, +WANDER_RADIUS_TILES]. A signed
    // shift of a large seed yields negative values, and JS % keeps the
    // sign — producing offsets far outside the intended ring.
    const range = WANDER_RADIUS_TILES * 2 + 1;
    const ox = ((((seed >>> (attempt * 3)) % range) + range) % range) - WANDER_RADIUS_TILES;
    const oy = ((((seed >>> (attempt * 3 + 5)) % range) + range) % range) - WANDER_RADIUS_TILES;
    const gx = Math.max(1, Math.min(width - 2, fromX + ox));
    const gy = Math.max(1, Math.min(height - 2, fromY + oy));
    if (cost[gy * width + gx] !== 0) {
      return { x: gx, y: gy };
    }
  }
  return undefined;
};

/**
 * Ticks the GOAP movement executor.
 *
 * For each agent with a movement action:
 * 1. If a path is already active, leave it alone.
 * 2. If the agent is within repath backoff, skip.
 * 3. Resolve the goal cell (target cell for pursue/move-to-range actions,
 *    a wander goal otherwise), request an A* path, and attach PathFollow.
 * 4. Unreachable goals set a repath deadline instead of spinning.
 *
 * Runs in the worker's Navigation slot before updatePathFollow.
 *
 * @param world - The bitECS world.
 */
export const updateGoapMovement = (world: World): void => {
  const terrain = getTerrainGrid();
  if (!terrain) {
    return;
  }
  const tileSize = getTerrainTileSize();

  for (const eid of query(world, GOAP_QUERY_TERMS)) {
    const actionId = GoapAgent.currentActionId[eid] ?? -1;
    if (!MOVEMENT_ACTION_IDS.has(actionId)) {
      continue;
    }

    // Skip agents that already have a live path.
    if (hasActivePath(world, eid)) {
      continue;
    }

    // Repath backoff — do not re-request every tick for unreachable goals.
    // Idle wanderers also pace themselves (stroll cadence). The deadline is
    // a timestamp, so a stale value simply expires — no reset needed.
    const deadline = PathFollow.repathAtMs[eid] ?? 0;
    if (deadline > 0 && Date.now() < deadline) {
      continue;
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }
    const fromX = GridPosition.x[eid];
    const fromY = GridPosition.y[eid];
    if (fromX === undefined || fromY === undefined) {
      continue;
    }

    let goal: GridCell | undefined;

    // Target-based actions follow the target's current cell.
    if (actionId === 7 || actionId === 10) {
      const targetEid = GoapAgent.targetEntityId[eid] ?? 0;
      if (targetEid > 0) {
        const targetGx = GridPosition.x[targetEid];
        const targetGy = GridPosition.y[targetEid];
        if (targetGx !== undefined && targetGy !== undefined) {
          goal = { x: targetGx, y: targetGy };
        }
      }
    }

    goal ??= _pickWanderGoal(eid, fromX, fromY, terrain.width, terrain.height, terrain.cost);
    if (!goal) {
      continue;
    }

    const result = findPath({
      grid: terrain,
      start: { x: fromX, y: fromY },
      goal,
    });

    if (result.path.length === 0) {
      // Unreachable — back off and try again later. The raw SoA write is
      // fine: the deadline is a timestamp that expires, and the executor
      // reads it unconditionally (no component needed).
      PathFollow.repathAtMs[eid] = Date.now() + UNREACHABLE_BACKOFF_MS;
      continue;
    }

    // Convert grid waypoints to world-pixel waypoints (tile centres).
    const waypoints = new Float32Array(result.path.length * 2);
    for (let i = 0; i < result.path.length; i++) {
      waypoints[i * 2] = result.path[i].x * tileSize + tileSize / 2;
      waypoints[i * 2 + 1] = result.path[i].y * tileSize + tileSize / 2;
    }

    addComponent(
      world,
      eid,
      set(PathFollow, {
        waypoints,
        index: 1, // skip the start cell — the agent is already there
        length: result.path.length,
        speed: GOAP_WALK_SPEED,
        // Idle wanderers pause between strolls (the path-follow system
        // detaches PathFollow on arrival; the deadline gates the next
        // request). Pursuit/movement actions re-request immediately.
        repathAtMs: actionId === 0 ? Date.now() + IDLE_WANDER_BACKOFF_MS : 0,
        arriveRadius: GOAP_ARRIVE_RADIUS,
      }),
    );
  }
};
