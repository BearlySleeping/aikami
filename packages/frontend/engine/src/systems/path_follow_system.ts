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
import { logger } from '$logger';
import { Companion } from '../components/companion.ts';
import { NPCDialog } from '../components/npc_dialog.ts';
import { PathFollow } from '../components/path_follow.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { Velocity } from '../components/velocity.ts';

/** Cached query terms — created once per world to avoid per-frame overhead. */
const PATH_FOLLOW_QUERY_TERMS = [Position, PathFollow];

// ---------------------------------------------------------------------------
// C-402: NPC halt rule + observability
// ---------------------------------------------------------------------------

/**
 * Why an NPC stopped moving this tick — carried for observability and
 * asserted in the halt-rule unit test.
 *
 * `player_proximity` is set by the C-402 halt rule when an NPC with an
 * interaction radius is within `interactionRadius` of the player; the NPC
 * stops at conversational distance instead of entering the player's tile.
 */
export type NpcHaltReason =
  | 'none'
  | 'reached_goal'
  | 'player_proximity'
  | 'blocked_terrain'
  | 'blocked_actor';

/**
 * Per-entity halt reason, keyed by entity id.
 *
 * Module-level (not a component) — C-402 mandates no component layout
 * changes; the reason is carried for observability and the halt-rule unit
 * test. Defaults to `'none'` for entities never seen by the system.
 */
const _npcHaltReason = new Map<number, NpcHaltReason>();

/**
 * Returns the last halt reason recorded for an entity.
 *
 * @param eid - The entity ID.
 * @returns The halt reason, `'none'` when never recorded.
 */
export const getNpcHaltReason = (eid: number): NpcHaltReason => {
  return _npcHaltReason.get(eid) ?? 'none';
};

/**
 * Records a halt reason, logging the transition at debug level.
 *
 * @param eid - The entity ID.
 * @param reason - The new halt reason.
 */
const _setNpcHaltReason = (eid: number, reason: NpcHaltReason): void => {
  const previous = _npcHaltReason.get(eid) ?? 'none';
  if (previous !== reason) {
    logger.debug('path-follow:halt-reason', { eid, previous, reason });
    _npcHaltReason.set(eid, reason);
  }
};

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
 * 1. C-402 halt rule: an NPC carrying NPCDialog (and NOT a party follower)
 *    that is within `interactionRadius` of the player is halted — velocity
 *    is zeroed, `NpcHaltReason.player_proximity` is set, and the path is
 *    not advanced. This prevents the NPC from entering the player's tile,
 *    which is the deadlock class C-402 removes (a moving NPC pathing into
 *    the player's tile and a player pathing into the NPC's tile used to
 *    block each other with no resolution rule).
 * 2. If the path is finished (index >= length), zero velocity and clear
 *    the component.
 * 3. Otherwise move toward waypoint[index] at `speed` px/s; when within
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
 * @param playerEntityId - The player entity ID for the C-402 halt rule;
 *   `0` (default) disables the halt check (no player known).
 */
export const updatePathFollow = (world: World, deltaMs: number, playerEntityId = 0): void => {
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

    // ── C-402 halt rule: NPCs halt at their interaction radius ──
    // Gated to NPCs carrying NPCDialog; party followers (Companion) are
    // excluded so they can still reach their formation slot behind the
    // player. An NPC within interactionRadius of the player stops moving
    // and never enters the player's tile — removing the symmetric-block
    // deadlock by construction.
    //
    // Look-ahead: the halt fires when the NEXT frame step would put the
    // NPC inside the radius (dist < radius + speed*dt), so the NPC settles
    // at distance >= interactionRadius rather than overshooting one step
    // into it — AC-3 asserts final distance >= interactionRadius.
    if (
      playerEntityId > 0 &&
      hasComponent(world, eid, NPCDialog) &&
      !hasComponent(world, eid, Companion)
    ) {
      const radius = NPCDialog.interactionRadius[eid] ?? 0;
      if (radius > 0) {
        const playerPos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
        if (playerPos) {
          const dx = playerPos.x - pos.x;
          const dy = playerPos.y - pos.y;
          const step = speed * deltaSeconds;
          // Use squared distance — no sqrt in the hot path.
          if (dx * dx + dy * dy < (radius + step) * (radius + step)) {
            addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
            _setNpcHaltReason(eid, 'player_proximity');
            // Path stays attached (live) so the GOAP executor does not
            // re-request every tick; steering resumes when the player
            // moves beyond the radius.
            continue;
          }
        }
      }
    }

    // Path finished — stop and detach the component.
    if (length <= 0 || index >= length) {
      addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
      _setNpcHaltReason(eid, 'reached_goal');
      removeComponent(world, eid, PathFollow);
      PathFollow.repathAtMs[eid] = 0;
      continue;
    }

    const waypoints = PathFollow.waypoints[eid];
    if (!waypoints) {
      addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
      _setNpcHaltReason(eid, 'reached_goal');
      removeComponent(world, eid, PathFollow);
      PathFollow.repathAtMs[eid] = 0;
      continue;
    }

    _setNpcHaltReason(eid, 'none');

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
        // Final waypoint reached — stop and detach.
        addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
        removeComponent(world, eid, PathFollow);
        // Clear the SoA repath slot so a stale deadline written by another
        // provider (party-follow) cannot gate a recycled eid (CodeRabbit
        // review, C-379).
        PathFollow.repathAtMs[eid] = 0;
        continue;
      }
      // Intermediate waypoint reached — steer toward the NEXT waypoint in
      // the same frame instead of writing zero velocity (the old stall-a-
      // frame-at-every-waypoint behaviour desynced facing and added a
      // frame of idle at each corner; CodeRabbit review, C-379).
      const nextIndex = index + 1;
      const nextX = waypoints[nextIndex * 2];
      const nextY = waypoints[nextIndex * 2 + 1];
      const ndx = nextX - pos.x;
      const ndy = nextY - pos.y;
      const ndist = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
      addComponent(
        world,
        eid,
        set(Velocity, { x: (ndx / ndist) * speed, y: (ndy / ndist) * speed }),
      );
      continue;
    }

    // Steer toward the waypoint at the agent's speed.
    const dist = Math.sqrt(distSq);
    const velX = (dx / dist) * speed;
    const velY = (dy / dist) * speed;
    addComponent(world, eid, set(Velocity, { x: velX, y: velY }));
  }
};
