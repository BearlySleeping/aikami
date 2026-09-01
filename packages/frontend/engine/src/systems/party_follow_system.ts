// packages/frontend/engine/src/systems/party_follow_system.ts
//
// PartyFollowSystem — companion locomotion goal provider (C-379 AC-7).
//
// Party follow is a goal provider, NOT a second movement path: recruited
// companions request an A* path to their formation slot behind the player;
// PathFollow writes Velocity; updateMovement resolves. No client service
// posts per-entity velocities (AC-7 watch point — the old
// party_follow_service.svelte.ts did exactly that and is deleted).
//
// Design notes (C-379 Open Questions):
//   - Separate provider, not a GOAP action: companions follow while GOAP is
//     idle; competing for the action slot would starve follow whenever an
//     action is available.
//   - Repath storm guard: when the player moves more than one tile, or the
//     agent's own position drifts from the plan, the provider re-requests a
//     path — never every tick.

import type { World } from 'bitecs';
import { addComponent, getComponent, query, removeComponent, set } from 'bitecs';
import { Companion } from '../components/companion.ts';
import { GridPosition } from '../components/grid_position.ts';
import { PathFollow } from '../components/path_follow.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { findPath } from '../math/astar.ts';
import { getTerrainGrid, getTerrainTileSize } from './collision_system.ts';
import { hasActivePath } from './path_follow_system.ts';

/** Cached query terms — created once per world to avoid per-frame overhead. */
const COMPANION_QUERY_TERMS = [Companion, Position, GridPosition];

/** Companion movement speed (px/s). */
const COMPANION_SPEED = 80;

/** Arrival radius for the final formation-slot waypoint (px). */
const COMPANION_ARRIVE_RADIUS = 8;

/** Formation offset behind the player (dx, dy in px) per follower slot. */
const FORMATION_OFFSETS = [
  { dx: -40, dy: 0 },
  { dx: -56, dy: -24 },
  { dx: -56, dy: 24 },
  { dx: -72, dy: -48 },
  { dx: -72, dy: 48 },
] as const;

/**
 * Ticks the party-follow provider.
 *
 * For each RECRUITED companion:
 * 1. Compute the formation slot pixel position behind the player.
 * 2. If the companion is within arrival radius of the slot, stop.
 * 3. If a path is already active, leave it alone.
 * 4. Otherwise request an A* path to the slot's grid cell and attach
 *    PathFollow.
 *
 * @param world - The bitECS world.
 * @param playerEid - The player entity ID (0 when not yet spawned).
 */
export const updatePartyFollow = (world: World, playerEid: number): void => {
  if (playerEid <= 0) {
    return;
  }
  const terrain = getTerrainGrid();
  if (!terrain) {
    return;
  }
  const tileSize = getTerrainTileSize();

  const playerPos = getComponent(world, playerEid, Position) as PositionData | undefined;
  if (!playerPos) {
    return;
  }

  let slot = 0;
  for (const eid of query(world, COMPANION_QUERY_TERMS)) {
    // Only recruited companions follow (C-340).
    const recruited = Companion.recruited[eid] === true;
    if (!recruited) {
      continue;
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    const offset = FORMATION_OFFSETS[slot % FORMATION_OFFSETS.length] ?? FORMATION_OFFSETS[0];
    slot++;

    const slotX = playerPos.x + offset.dx;
    const slotY = playerPos.y + offset.dy;

    // Already at the slot — stop.
    const dx = slotX - pos.x;
    const dy = slotY - pos.y;
    if (dx * dx + dy * dy <= COMPANION_ARRIVE_RADIUS ** 2) {
      continue;
    }

    // Live path — keep it unless the formation slot drifted more than one
    // tile from the path's final waypoint (the player kept walking).
    // Without this check, followers walk to where the player WAS and only
    // then re-path, which reads as rubber-banding.
    if (hasActivePath(world, eid)) {
      const pathLength = PathFollow.length[eid] ?? 0;
      const waypoints = PathFollow.waypoints[eid];
      const finalX = waypoints?.[(pathLength - 1) * 2];
      const finalY = waypoints?.[(pathLength - 1) * 2 + 1];
      if (finalX !== undefined && finalY !== undefined) {
        const driftX = slotX - finalX;
        const driftY = slotY - finalY;
        if (driftX * driftX + driftY * driftY <= tileSize * tileSize) {
          // Goal still within one tile — keep the current path.
          continue;
        }
        // Goal drifted more than one tile — invalidate the stale path so
        // the fall-through below re-requests a fresh one (the repathAtMs
        // backoff check still gates the request, so this cannot storm).
        removeComponent(world, eid, PathFollow);
        PathFollow.repathAtMs[eid] = 0;
      } else {
        continue;
      }
    }

    // Repath backoff — a failed request (impassable slot cell or
    // unreachable goal) set a future deadline; do not re-request every
    // tick while it is pending. The deadline is a timestamp, so a stale
    // value simply expires (CodeRabbit review, C-379).
    const deadline = PathFollow.repathAtMs[eid] ?? 0;
    if (deadline > 0 && Date.now() < deadline) {
      continue;
    }

    const fromX = GridPosition.x[eid];
    const fromY = GridPosition.y[eid];
    if (fromX === undefined || fromY === undefined) {
      continue;
    }

    const goal = {
      x: Math.max(0, Math.min(terrain.width - 1, Math.floor(slotX / tileSize))),
      y: Math.max(0, Math.min(terrain.height - 1, Math.floor(slotY / tileSize))),
    };

    // Slot cell impassable — back off (repath later) rather than spin.
    if (terrain.cost[goal.y * terrain.width + goal.x] === 0) {
      PathFollow.repathAtMs[eid] = Date.now() + 500;
      continue;
    }

    const result = findPath({
      grid: terrain,
      start: { x: fromX, y: fromY },
      goal,
    });

    if (result.path.length === 0) {
      PathFollow.repathAtMs[eid] = Date.now() + 1000;
      continue;
    }

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
        index: 1,
        length: result.path.length,
        speed: COMPANION_SPEED,
        repathAtMs: 0,
        arriveRadius: COMPANION_ARRIVE_RADIUS,
      }),
    );
  }
};
