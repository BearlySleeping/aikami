// packages/frontend/engine/src/systems/movement_system.ts
import type { World } from 'bitecs';
import { addComponent, getComponent, hasComponent, query, set } from 'bitecs';
import { logger } from '$logger';
import { CollisionData, CollisionLayer } from '../components/collision_data.ts';
import { isSimulationActive } from '../components/engine_state.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import type { VelocityData } from '../components/velocity.ts';
import { Velocity } from '../components/velocity.ts';
import { getEngineGameMode } from '../state/game_mode.ts';
import {
  getMapPixelBounds,
  getTerrainTileSize,
  isCellBlocked,
  isWalkable,
} from './collision_system.ts';
import { isEntityOffscreen } from './macro_simulation_system.ts';

// ---------------------------------------------------------------------------
// MovementSystem — axis-independent continuous collision detection
//
// Contract C-160 AC-2: Entities move freely with diagonal velocity and
// slide along walls when a single axis is blocked. Per-axis walkability
// checks allow the player to continue moving on the unblocked axis rather
// than stopping entirely or snapping to a grid cell.
//
// Contract C-173: Collision detection uses the spatial grid + bitmask
// collision. isCellBlocked() checks the dense spatial grid with intrusive
// linked list and CollisionData layer/mask bitwise AND. Terrain solidity
// via isWalkable() (terrain cost) is an INDEPENDENT condition — the
// composite is `isCellBlocked(...) || !isWalkable(...)`, evaluated
// regardless of whether a spatial grid is active (C-379).
//
// Contract C-379:
//   - Every mover carries its OWN collision mask — read from
//     CollisionData.mask[eid] in the loop, never the player's constant.
//     Entities without CollisionData default to "collides with walls only".
//   - Tile size comes from the map's terrain grid (getTerrainTileSize),
//     never a hardcoded 32.
//   - The boolean CollisionGrid is gone — isWalkable reads terrain cost.
// ---------------------------------------------------------------------------

/** Cached query terms — created once per world to avoid per-frame overhead. */
const MOVEMENT_QUERY_TERMS = [Position, Velocity];

/**
 * Default collision mask for the player entity — collides with walls,
 * NPCs, and enemies (not items).
 *
 * Kept as the player's VALUE (C-379). The movement loop reads each
 * entity's own mask from CollisionData; this constant is used by the
 * player spawn clamp and callers that construct the player mask.
 */
export const PLAYER_COLLISION_MASK =
  CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.enemy;

/**
 * Default collision mask for combatants (NPCs/enemies) used by the
 * tactical walkability composites (turn_manager `_checkWalkable` and
 * goap_combat_tactics `_checkWalkableComposite`).
 *
 * Blocks walls, other NPCs, the player, and other enemies — a combatant
 * must never treat a cell occupied by another combatant as walkable.
 */
export const COMBATANT_COLLISION_MASK =
  CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.player | CollisionLayer.enemy;

/**
 * Default collision mask for movers without a CollisionData component
 * (C-379 AC-3 watch point): "collides with walls only". The movement loop
 * must never fall back to the player's mask for a non-player mover.
 */
const DEFAULT_MOVER_COLLISION_MASK = CollisionLayer.wall;

/**
 * Half-width of the entity collision box in world pixels.
 *
 * Entities occupy a 32×32 world-unit collision box with a bottom-centre
 * anchor `(0.5, 1.0)`. The box is symmetric horizontally (±16), but
 * asymmetric vertically — it extends entirely upward from the feet
 * (32 px above, 0 px below).
 *
 * These are the ENTITY box, not the tile size — they do NOT scale with
 * the map's tile size (C-379 AC-5 watch point).
 */
const ENTITY_HALF_WIDTH = 16;

/**
 * Vertical extent of the collision box above the feet (world pixels).
 *
 * With the bottom-centre anchor, the box spans from `posY - 32` to `posY`.
 * No margin is applied below the feet — the sprite renders entirely upward.
 */
const ENTITY_HEIGHT_ABOVE = 32;

// ── C-332: NaN/Infinity position recovery ──────────────────────────

/**
 * Checks whether a coordinate value is safe (finite, not NaN) for
 * position storage. If the value is unsafe, logs an explicit error
 * and returns the entity's current position (fallback) as a recovery
 * coordinate — per-entity, always valid.
 */
const safeCoordinate = (value: number, fallback: number, eid: number, axis: 'x' | 'y'): number => {
  if (!Number.isFinite(value)) {
    logger.error('[WorkerEngine] CRITICAL: Invalid position — NaN/Infinity detected', {
      eid,
      axis,
      value,
      fallback,
    });
    // Validate fallback before returning it; if fallback is also invalid, use 0
    if (!Number.isFinite(fallback)) {
      logger.error('[WorkerEngine] CRITICAL: Fallback position also invalid — returning 0', {
        eid,
        axis,
        fallback,
      });
      return 0;
    }
    return fallback;
  }
  return value;
};

/**
 * Returns the collision mask a mover uses for occupancy checks.
 *
 * Reads the entity's own CollisionData.mask and returns it UNCHANGED —
 * including an explicit 0, which is a valid non-colliding mask (the mover
 * collides with nothing). Only an entity WITHOUT the CollisionData
 * component gets {@link DEFAULT_MOVER_COLLISION_MASK} (walls only); a
 * component with no stored value yet also falls back to the default
 * (CodeRabbit review, C-379). Never falls back to the player's mask.
 *
 * Component-existence check, not a raw SoA read: recycled eids in the
 * worker can carry stale CollisionData.mask values from a previous
 * entity, and a mover without the component must not inherit them.
 *
 * @param world - The bitECS world (for component-existence check).
 * @param eid - The moving entity ID.
 * @returns The mover's collision mask.
 */
const _getMoverMask = (world: World, eid: number): number => {
  if (!hasComponent(world, eid, CollisionData)) {
    return DEFAULT_MOVER_COLLISION_MASK;
  }
  const mask = CollisionData.mask[eid];
  // An explicit 0 is a valid non-colliding mask — return it unchanged.
  return mask === undefined ? DEFAULT_MOVER_COLLISION_MASK : mask;
};

/**
 * Samples a tile for blocking with a mover-specific mask.
 *
 * Canonical composite (C-379): dynamic-occupancy bitmask check OR terrain
 * solidity. Uses the given mover mask, never the player constant.
 *
 * @param tx - Tile X.
 * @param ty - Tile Y.
 * @param px - Representative pixel X (tile centre).
 * @param py - Representative pixel Y (tile centre).
 * @param mask - The mover's collision mask.
 * @returns `true` when the tile is blocked for this mover.
 */
const _isTileBlockedFor = (
  tx: number,
  ty: number,
  px: number,
  py: number,
  mask: number,
  selfEid: number,
): boolean => {
  return isCellBlocked(tx, ty, mask, selfEid) || !isWalkable(px, py);
};

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
 * Collision detection (C-379):
 * 1. Bitmask spatial grid (isCellBlocked) with the mover's OWN mask
 * 2. Terrain cost grid (isWalkable) — the boolean grid is gone
 *
 * Runs every frame at ~60fps via the worker tick loop. Pure imperative —
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

    // C-379 AC-3: per-entity mask — never the player's constant.
    const moverMask = _getMoverMask(world, eid);

    // C-379 AC-5: map-driven tile size — never a hardcoded 32.
    const tileSize = getTerrainTileSize();

    // Axis-independent continuous movement with per-axis collision.
    let nextX = pos.x + vel.x * deltaSeconds;
    let nextY = pos.y + vel.y * deltaSeconds;

    // ── Map pixel bounds for per-entity bounding-box enforcement ──
    const bounds = getMapPixelBounds();

    // ── X-axis: bounding-box boundary wall ──
    if (bounds.width > 0) {
      if (nextX - ENTITY_HALF_WIDTH < 0 || nextX + ENTITY_HALF_WIDTH >= bounds.width) {
        nextX = pos.x;
      }
    }

    // ── X-axis: tile-level collision (only when boundary allows movement) ──
    if (nextX !== pos.x) {
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
          const px = tx * tileSize + tileSize / 2;
          const py = ty * tileSize + tileSize / 2;
          if (_isTileBlockedFor(tx, ty, px, py, moverMask, eid)) {
            blocked = true;
          }
        }
      }
      if (blocked) {
        nextX = pos.x;
      }
    }

    // ── Y-axis: bounding-box boundary wall ──
    if (bounds.height > 0) {
      if (nextY - ENTITY_HEIGHT_ABOVE < 0 || nextY >= bounds.height) {
        nextY = pos.y;
      }
    }

    // ── Y-axis: tile-level collision (only when boundary allows movement) ──
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
          if (_isTileBlockedFor(tx, ty, px, py, moverMask, eid)) {
            blocked = true;
          }
        }
      }
      if (blocked) {
        nextY = pos.y;
      }
    }

    // ── C-332: NaN/Infinity position guard ──
    nextX = safeCoordinate(nextX, pos.x, eid, 'x');
    nextY = safeCoordinate(nextY, pos.y, eid, 'y');

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

// ---------------------------------------------------------------------------
// Spawn / restore clamping (C-378)
// ---------------------------------------------------------------------------

/**
 * Returns true when a player at the given feet position would be blocked.
 *
 * Samples the SAME 32×32 collision box the movement system uses (not just
 * the feet tile): `x ± 16` horizontally, `y - 32 .. y` vertically. Uses the
 * map-driven tile size and the player's own collision mask (C-379).
 *
 * @param pixelX - Candidate feet X in world pixels.
 * @param pixelY - Candidate feet Y in world pixels.
 * @returns `true` when any tile under the collision box is blocked.
 */
export const isPlayerSpawnBlocked = (pixelX: number, pixelY: number): boolean => {
  const tileSize = getTerrainTileSize();
  const boxLeft = pixelX - ENTITY_HALF_WIDTH;
  const boxRight = pixelX + ENTITY_HALF_WIDTH - 1;
  const boxTop = pixelY - ENTITY_HEIGHT_ABOVE + 1;
  const boxBottom = pixelY;
  const tx1 = Math.floor(boxLeft / tileSize);
  const tx2 = Math.floor(boxRight / tileSize);
  const ty1 = Math.floor(boxTop / tileSize);
  const ty2 = Math.floor(boxBottom / tileSize);
  for (let ty = ty1; ty <= ty2; ty++) {
    for (let tx = tx1; tx <= tx2; tx++) {
      const px = tx * tileSize + tileSize / 2;
      const py = ty * tileSize + tileSize / 2;
      if (_isTileBlockedFor(tx, ty, px, py, PLAYER_COLLISION_MASK, 0)) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Clamps a spawn or restore point to the nearest walkable position.
 *
 * Shared by the worker's LOAD_MAP and RESTORE_PLAYER paths (C-378): a
 * saved position can land inside a solid prop or wall. Because the
 * player's collision box samples the whole tile under the feet,
 * restoring onto a solid cell deadlocks EVERY movement axis. Clamping at
 * restore time (not just at map spawn) prevents that freeze.
 *
 * Scans outward in square rings (ring radius in tiles, up to 20) from the
 * blocked point and returns the first unblocked position. Falls back to the
 * map centre when no walkable tile is found AND the centre itself is
 * walkable.
 *
 * @param x - Candidate X position in world pixels.
 * @param y - Candidate Y position in world pixels.
 * @param isBlocked - Oracle: `true` when a pixel position is blocked
 *   (spatial-grid entity occupancy OR terrain solidity).
 * @param bounds - Optional map pixel bounds used for the centre fallback.
 * @returns The clamped position (unchanged when the input was walkable).
 */
export const clampSpawnToWalkable = (
  x: number,
  y: number,
  isBlocked: (pixelX: number, pixelY: number) => boolean,
  bounds?: { width: number; height: number },
): { x: number; y: number } => {
  if (!isBlocked(x, y)) {
    return { x, y };
  }

  const tileSize = getTerrainTileSize();
  const centerX = (bounds?.width ?? 0) / 2;
  const centerY = (bounds?.height ?? 0) / 2;
  let clampedX = x;
  let clampedY = y;
  let found = false;

  for (let radius = 0; radius < 20 && !found; radius++) {
    for (let dy = -radius; dy <= radius && !found; dy++) {
      for (let dx = -radius; dx <= radius && !found; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
          continue;
        }
        const tx = x + dx * tileSize;
        const ty = y + dy * tileSize;
        if (!isBlocked(tx, ty)) {
          clampedX = tx;
          clampedY = ty;
          found = true;
        }
      }
    }
  }

  if (!found) {
    if (!isBlocked(centerX, centerY)) {
      clampedX = centerX;
      clampedY = centerY;
    }
  }
  return { x: clampedX, y: clampedY };
};
