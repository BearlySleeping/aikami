// packages/frontend/engine/src/systems/movement_system.ts
import type { World } from 'bitecs';
import { addComponent, getComponent, query, set } from 'bitecs';
import { CollisionLayer } from '../components/collision_data.ts';
import { isSimulationActive } from '../components/engine_state.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import type { VelocityData } from '../components/velocity.ts';
import { Velocity } from '../components/velocity.ts';
import { getEngineGameMode } from '../state/game_mode.ts';
import { isCellBlocked, isWalkable } from './collision_system.ts';
import { isEntityOffscreen } from './macro_simulation_system.ts';

// ---------------------------------------------------------------------------
// MovementSystem — axis-independent continuous collision detection
//
// Contract C-160 AC-2: Entities move freely with diagonal velocity and
// slide along walls when a single axis is blocked. Per-axis walkability
// checks allow the player to continue moving on the unblocked axis rather
// than stopping entirely or snapping to a grid cell.
//
// Contract C-173: Collision detection upgraded to use spatial grid +
// bitmask collision. isCellBlocked() checks the dense spatial grid with
// intrusive linked list and CollisionData layer/mask bitwise AND.
// Falls back to legacy isWalkable() when no spatial grid is active.
// ---------------------------------------------------------------------------

/** Cached query terms — created once per world to avoid per-frame overhead. */
const MOVEMENT_QUERY_TERMS = [Position, Velocity];

/**
 * Default collision mask for the player entity — collides with walls,
 * NPCs, and enemies (not items).
 */
const PLAYER_COLLISION_MASK = CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.enemy;

/**
 * Updates world-space positions for all entities that have both a
 * {@link Position} and a {@link Velocity} component.
 *
 * Movement uses axis-independent continuous collision detection:
 * nextX and nextY are computed independently, and each axis is
 * walkability-checked in sequence. If one axis is blocked the entity
 * slides along the other — diagonal drift into walls resolves to
 * smooth wall sliding.
 *
 * Collision detection priority (C-173):
 * 1. Bitmask spatial grid (isCellBlocked) — checks CollisionData layer/mask
 * 2. Legacy boolean grid (isWalkable) — Tiled collision layer fallback
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

  // ── C-172 AC-1: Return early during map transitions ──
  if (!isSimulationActive()) {
    return;
  }

  // Gate: only process movement in EXPLORE mode.
  if (getEngineGameMode() !== 'EXPLORE') {
    return;
  }

  const deltaSeconds = deltaMs / 1000;
  if (deltaSeconds <= 0) {
    return;
  }

  const entities = query(world, MOVEMENT_QUERY_TERMS);

  for (const eid of entities) {
    // ── C-194 AC-1: Skip entities in inactive zones ──
    if (isEntityOffscreen(eid)) {
      continue;
    }

    const vel = getComponent(world, eid, Velocity) as VelocityData | undefined;
    if (!vel || (vel.x === 0 && vel.y === 0)) {
      continue;
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    // Axis-independent continuous movement with per-axis collision.
    // Compute the candidate position after applying full velocity for
    // this frame, then check each axis independently.
    let nextX = pos.x + vel.x * deltaSeconds;
    let nextY = pos.y + vel.y * deltaSeconds;

    // ── C-173: Bitmask collision via spatial grid ──
    // Convert pixel positions to grid coordinates and check occupancy.
    const tileSize = 32; // Default tile size (matches CELL_PIXEL_SIZE in render_system)

    // X-axis: check grid cell at candidate X, current Y
    const tileDestX = Math.floor(nextX / tileSize);
    const tileCurrentY = Math.floor(pos.y / tileSize);

    if (isCellBlocked(tileDestX, tileCurrentY, PLAYER_COLLISION_MASK)) {
      nextX = pos.x;
    } else if (!isWalkable(nextX, pos.y)) {
      // Legacy fallback
      nextX = pos.x;
    }

    // Y-axis: check grid cell at (possibly clamped) X, candidate Y
    const tileCurrentX = Math.floor(nextX / tileSize);
    const tileDestY = Math.floor(nextY / tileSize);

    if (isCellBlocked(tileCurrentX, tileDestY, PLAYER_COLLISION_MASK)) {
      nextY = pos.y;
    } else if (!isWalkable(nextX, nextY)) {
      // Legacy fallback
      nextY = pos.y;
    }

    addComponent(
      world,
      eid,
      set(Position, {
        x: nextX,
        y: nextY,
      }),
    );
  }
};

export { updateMovement };

/**
 * Clears all per-world movement tracking state.
 *
 * With the axis-independent movement system there is no per-world
 * state to clear, but the export is preserved for downstream callers
 * to avoid breaking imports.
 *
 * @param _world - The bitECS world (unused in current implementation).
 */
const resetMovementTracking = (_world: World): void => {
  // No-op: axis-independent movement has no per-world state to clear.
  // Export preserved for downstream compatibility (C-160 AC-2).
};

export { resetMovementTracking };
