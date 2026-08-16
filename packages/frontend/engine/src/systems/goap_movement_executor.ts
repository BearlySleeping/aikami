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
import { NPCDialog } from '../components/npc_dialog.ts';
import { PathFollow } from '../components/path_follow.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { type AstarGrid, findPath, type GridCell } from '../math/astar.ts';
import {
  DEFAULT_ACTION_COMBAT_MOVE,
  DEFAULT_ACTION_GO_TO_PUB,
  DEFAULT_ACTION_GO_TO_WORKPLACE,
  DEFAULT_ACTION_IDLE,
  DEFAULT_ACTION_PURSUE_TARGET,
} from '../math/goap/action_registry.ts';
import { getTerrainGrid, getTerrainTileSize } from './collision_system.ts';
import { DEFAULT_INTERACTION_RADIUS } from './entity_spawner.ts';
import { hasActivePath } from './path_follow_system.ts';

/**
 * Executor-owned repath backoff, keyed by entity id (CodeRabbit review,
 * C-379).
 *
 * NOT stored on `PathFollow.repathAtMs`: that SoA slot is shared with the
 * party-follow provider, and a stale value there would gate this executor
 * across entity lifecycles (a recycled eid inherits a deadline written by
 * a previous companion). A Map entry is per-entity and disappears with the
 * entity; a brand-new entity starts with no deadline. Cleared/overwritten
 * whenever a path is attached or a new goal is requested.
 */
const _backoffUntil = new Map<number, number>();

/** Cached query terms — created once per world to avoid per-frame overhead. */
const GOAP_QUERY_TERMS = [GoapAgent, Position, GridPosition];

/**
 * Movement-capable GOAP actions (default registry actionIds).
 *
 * Idle — the scheduler always falls back to it (cost 0, no preconditions),
 * so idle agents wander toward a nearby walkable goal (C-379 AC-7: "NPCs
 * walk paths" — a villager with nothing to do still strolls rather than
 * freezing at spawn). Go to pub / Go to workplace are destination actions;
 * Pursue target / Combat move to range follow the target's cell.
 */
const MOVEMENT_ACTION_IDS = new Set<number>([
  DEFAULT_ACTION_IDLE,
  DEFAULT_ACTION_GO_TO_PUB,
  DEFAULT_ACTION_GO_TO_WORKPLACE,
  DEFAULT_ACTION_PURSUE_TARGET,
  DEFAULT_ACTION_COMBAT_MOVE,
]);

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
 * Picks a walkable goal cell at approximately `interactionRadius` pixels
 * from the target's cell centre, preferring cells on the agent's side.
 *
 * C-402: pursue-target goals must NOT be the target's own cell — A*
 * would route through the player's tile and the NPC would walk into the
 * player, recreating the deadlock the halt rule removes. The goal cell is
 * the walkable cell whose centre is nearest to `interactionRadius` px
 * from the target's centre, tie-broken by distance from the agent (so the
 * NPC approaches from its own side and the path stays short).
 *
 * @param fromX - Agent's current grid X.
 * @param fromY - Agent's current grid Y.
 * @param targetGx - Target's grid X.
 * @param targetGy - Target's grid Y.
 * @param radiusPx - Interaction radius in pixels.
 * @param tileSize - Map tile size in pixels.
 * @param terrain - The terrain grid for walkability.
 * @returns A walkable goal cell, or undefined when none is found in the ring.
 */
export const _pickPursueGoal = (options: {
  fromX: number;
  fromY: number;
  targetGx: number;
  targetGy: number;
  radiusPx: number;
  tileSize: number;
  terrain: AstarGrid;
}): GridCell | undefined => {
  const { fromX, fromY, targetGx, targetGy, radiusPx, tileSize, terrain } = options;
  const targetPx = targetGx * tileSize + tileSize / 2;
  const targetPy = targetGy * tileSize + tileSize / 2;

  // Scan a ring of cells around the target (2 tiles wide) and score each
  // walkable candidate by |centre distance − radius| then distance to the
  // agent. The ring spans roughly [radius − tileSize, radius + tileSize].
  const ringTiles = Math.max(1, Math.ceil(radiusPx / tileSize));
  let best: GridCell | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let dy = -ringTiles; dy <= ringTiles; dy++) {
    for (let dx = -ringTiles; dx <= ringTiles; dx++) {
      const gx = targetGx + dx;
      const gy = targetGy + dy;
      if (gx < 0 || gx >= terrain.width || gy < 0 || gy >= terrain.height) {
        continue;
      }
      // Never choose the target's own cell.
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (terrain.cost[gy * terrain.width + gx] === 0) {
        continue;
      }

      const cx = gx * tileSize + tileSize / 2;
      const cy = gy * tileSize + tileSize / 2;
      const centreDist = Math.hypot(cx - targetPx, cy - targetPy);
      const radiusError = Math.abs(centreDist - radiusPx);
      const agentDist = Math.hypot(gx - fromX, gy - fromY);
      const score = radiusError * 100 + agentDist;
      if (score < bestScore) {
        bestScore = score;
        best = { x: gx, y: gy };
      }
    }
  }
  return best;
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
    // executor-owned (per-eid map), so a stale PathFollow.repathAtMs value
    // written by another provider can never gate this executor.
    const deadline = _backoffUntil.get(eid) ?? 0;
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

    // Target-based actions follow the target's current cell. C-402: the
    // pursue-target goal is radius-aware — a walkable cell at roughly the
    // NPC's interaction radius from the player, NOT the player's own cell,
    // so A* never routes through the player's tile (the halt rule then
    // stops the NPC at conversational distance). Combat move-to-range
    // intentionally keeps the target's own cell — combat positioning is
    // out of scope (AC-4) and the combatant mask handles mutual blocking.
    if (actionId === DEFAULT_ACTION_PURSUE_TARGET || actionId === DEFAULT_ACTION_COMBAT_MOVE) {
      const targetEid = GoapAgent.targetEntityId[eid] ?? 0;
      if (targetEid > 0) {
        const targetGx = GridPosition.x[targetEid];
        const targetGy = GridPosition.y[targetEid];
        if (targetGx !== undefined && targetGy !== undefined) {
          if (actionId === DEFAULT_ACTION_PURSUE_TARGET) {
            // The NPC's own interaction radius (spawner default when a
            // legacy agent omits NPCDialog). Read the SoA value directly —
            // the spawner guarantees a sane default.
            const radiusPx = NPCDialog.interactionRadius[eid] ?? DEFAULT_INTERACTION_RADIUS;
            const radiusGoal = _pickPursueGoal({
              fromX,
              fromY,
              targetGx,
              targetGy,
              radiusPx: radiusPx > 0 ? radiusPx : DEFAULT_INTERACTION_RADIUS,
              tileSize,
              terrain,
            });
            if (radiusGoal) {
              goal = radiusGoal;
            }
          }
          goal ??= { x: targetGx, y: targetGy };
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
      // Unreachable — back off and try again later. The deadline is a
      // timestamp that expires; the executor owns it in a per-eid map so
      // recycled eids never inherit another entity's backoff.
      _backoffUntil.set(eid, Date.now() + UNREACHABLE_BACKOFF_MS);
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
        // Idle wanderers pause between strolls: the backoff deadline gates
        // the next request after the path-follow system detaches PathFollow
        // on arrival. Pursuit/movement actions re-request immediately.
        repathAtMs: 0,
        arriveRadius: GOAP_ARRIVE_RADIUS,
      }),
    );
    // Pace idle wanderers via the executor-owned backoff (CodeRabbit
    // review, C-379): the deadline outlives the PathFollow component so it
    // still gates the NEXT wander request after detachment.
    if (actionId === DEFAULT_ACTION_IDLE) {
      _backoffUntil.set(eid, Date.now() + IDLE_WANDER_BACKOFF_MS);
    } else {
      _backoffUntil.delete(eid);
    }
  }
};
