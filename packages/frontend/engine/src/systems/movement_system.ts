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
import { getMapPixelBounds, isCellBlocked, isWalkable } from './collision_system.ts';
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
 * Half-width of the entity collision box in world pixels.
 *
 * Entities occupy a 32×32 world-unit collision box with a bottom-centre
 * anchor `(0.5, 1.0)`. The box is symmetric horizontally (±16), but
 * asymmetric vertically — it extends entirely upward from the feet
 * (32 px above, 0 px below).
 *
 * Horizontal boundary: `posX ± 16` must stay within `[0, mapPixelWidth)`.
 * Vertical boundary:   `posY - 32` must be ≥ 0; `posY` must be < mapPixelHeight.
 */
const ENTITY_HALF_WIDTH = 16;

/**
 * Vertical extent of the collision box above the feet (world pixels).
 *
 * With the bottom-centre anchor, the box spans from `posY - 32` to `posY`.
 * No margin is applied below the feet — the sprite renders entirely upward.
 */
const ENTITY_HEIGHT_ABOVE = 32;

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

    const tileSize = 32; // Default tile size (matches CELL_PIXEL_SIZE in render_system)

    // ── Map pixel bounds for per-entity bounding-box enforcement ──
    const bounds = getMapPixelBounds();

    // ── X-axis: bounding-box boundary wall ──
    // The entity box is symmetric horizontally (±ENTITY_HALF_WIDTH).
    // Both edges must stay within [0, mapPixelWidth); otherwise the axis
    // is clamped. When no map bounds are active (width === 0), the check
    // falls through to tile-level collision only.
    if (bounds.width > 0) {
      if (nextX - ENTITY_HALF_WIDTH < 0 || nextX + ENTITY_HALF_WIDTH >= bounds.width) {
        nextX = pos.x;
      }
    }

    // ── X-axis: tile-level collision (only when boundary allows movement) ──
    // Multi-point bounding-box check: sweeps all tiles the 32×32 collision
    // box covers, not just the single pixel at the entity's feet. Prevents
    // the top of the sprite from bleeding into water/wall tiles when the
    // feet stop at the tile boundary.
    if (nextX !== pos.x) {
      // Bounding box extents at the candidate X, current Y.
      const boxLeft = nextX - ENTITY_HALF_WIDTH;
      const boxRight = nextX + ENTITY_HALF_WIDTH - 1;
      const boxTop = pos.y - ENTITY_HEIGHT_ABOVE + 1;
      const boxBottom = pos.y;

      const tx1 = Math.floor(boxLeft / tileSize);
      const tx2 = Math.floor(boxRight / tileSize);
      const ty1 = Math.floor(boxTop / tileSize);
      const ty2 = Math.floor(boxBottom / tileSize);

      let blocked = false;
      for (let ty = ty1; ty <= ty2 && !blocked; ty++) {
        for (let tx = tx1; tx <= tx2 && !blocked; tx++) {
          // Representative pixel: centre of the tile. Any pixel within a
          // blocked tile is blocked, so the tile-centre sample is sufficient.
          const px = tx * tileSize + tileSize / 2;
          const py = ty * tileSize + tileSize / 2;
          if (isCellBlocked(tx, ty, PLAYER_COLLISION_MASK) || !isWalkable(px, py)) {
            blocked = true;
          }
        }
      }
      if (blocked) {
        nextX = pos.x;
      }
    }

    // ── Y-axis: bounding-box boundary wall ──
    // The entity box is asymmetric vertically (bottom-centre anchor):
    // it extends ENTITY_HEIGHT_ABOVE (32 px) upward from the feet and
    // 0 px downward. The top edge must be ≥ 0; the feet must be < mapH.
    // Uses the (potentially clamped) nextX so an entity blocked on X
    // slides freely along Y within the bounding box.
    if (bounds.height > 0) {
      if (nextY - ENTITY_HEIGHT_ABOVE < 0 || nextY >= bounds.height) {
        nextY = pos.y;
      }
    }

    // ── Y-axis: tile-level collision (only when boundary allows movement) ──
    // Multi-point bounding-box check, matching the X-axis logic. Sweeps
    // all tiles covered by the 32×32 box at the candidate Y. Uses the
    // (potentially clamped) nextX from the X-axis check above.
    if (nextY !== pos.y) {
      const boxLeft = nextX - ENTITY_HALF_WIDTH;
      const boxRight = nextX + ENTITY_HALF_WIDTH - 1;
      const boxTop = nextY - ENTITY_HEIGHT_ABOVE + 1;
      const boxBottom = nextY;

      const tx1 = Math.floor(boxLeft / tileSize);
      const tx2 = Math.floor(boxRight / tileSize);
      const ty1 = Math.floor(boxTop / tileSize);
      const ty2 = Math.floor(boxBottom / tileSize);

      let blocked = false;
      for (let ty = ty1; ty <= ty2 && !blocked; ty++) {
        for (let tx = tx1; tx <= tx2 && !blocked; tx++) {
          const px = tx * tileSize + tileSize / 2;
          const py = ty * tileSize + tileSize / 2;
          if (isCellBlocked(tx, ty, PLAYER_COLLISION_MASK) || !isWalkable(px, py)) {
            blocked = true;
          }
        }
      }
      if (blocked) {
        nextY = pos.y;
      }
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
