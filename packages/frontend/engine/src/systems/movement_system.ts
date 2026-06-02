// apps/frontend/game/src/engine/systems/movement_system.ts
import type { World } from 'bitecs';
import { addComponent, getComponent, query, set } from 'bitecs';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import type { VelocityData } from '../components/velocity.ts';
import { Velocity } from '../components/velocity.ts';

// ---------------------------------------------------------------------------
// MovementSystem — grid-aligned cell-based movement pipeline
//
// Contract C-040: All position updates are constrained to a 32×32 pixel
// tile grid. Entities snap to the nearest cell center on first movement
// and step between cell centers at full speed. Diagonal velocity vectors
// are blocked to ensure rigid axis-aligned directional alignment for the
// LpcAnimationController.
// ---------------------------------------------------------------------------

/** Pixel size of a single grid cell. */
const CELL_SIZE = 32;

/** Half-cell offset for cell center computation. */
const HALF_CELL = CELL_SIZE / 2;

/** Cached query terms — created once per world to avoid per-frame overhead. */
const MOVEMENT_QUERY_TERMS = [Position, Velocity];

/**
 * Per-entity target cell center position, keyed by world.
 *
 * When an entity is actively moving, this holds the next cell center
 * the entity is interpolating toward. Set on first movement frame and
 * cleared when velocity drops to zero.
 */
const _worldTargets = new Map<World, Map<number, { x: number; y: number }>>();

/**
 * Entities that have been aligned to the grid on their current
 * movement burst, keyed by world. Cleared when velocity drops to zero.
 */
const _worldAligned = new Map<World, Set<number>>();

/**
 * Previous resolved velocity axis per entity, keyed by world.
 *
 * Tracks whether the entity was last moving horizontally (1), vertically (2),
 * or was idle (0). When the axis changes, grid alignment is reset so the
 * entity snaps to the nearest cell center before continuing in the new
 * direction.
 */
const _worldPrevAxis = new Map<World, Map<number, number>>();

/**
 * Retrieves (or creates) the per-world target map.
 */
const _getTargets = (world: World): Map<number, { x: number; y: number }> => {
  let targets = _worldTargets.get(world);
  if (!targets) {
    targets = new Map();
    _worldTargets.set(world, targets);
  }
  return targets;
};

/**
 * Retrieves (or creates) the per-world aligned set.
 */
const _getAligned = (world: World): Set<number> => {
  let aligned = _worldAligned.get(world);
  if (!aligned) {
    aligned = new Set();
    _worldAligned.set(world, aligned);
  }
  return aligned;
};

/**
 * Retrieves (or creates) the per-world previous axis map.
 */
const _getPrevAxis = (world: World): Map<number, number> => {
  let prevAxis = _worldPrevAxis.get(world);
  if (!prevAxis) {
    prevAxis = new Map();
    _worldPrevAxis.set(world, prevAxis);
  }
  return prevAxis;
};

/**
 * Snaps a single coordinate to the nearest grid cell center.
 *
 * Cell centers are at HALF_CELL + n * CELL_SIZE for integer n ≥ 0.
 * Negative coordinates clamp to the origin cell center.
 *
 * @param coord - The pixel coordinate to snap.
 * @returns The nearest cell center coordinate.
 */
const snapToCellCenter = (coord: number): number => {
  const cellIndex = Math.round((coord - HALF_CELL) / CELL_SIZE);
  const clampedIndex = Math.max(0, cellIndex);
  return clampedIndex * CELL_SIZE + HALF_CELL;
};

/**
 * Computes the next grid cell center in the direction of movement.
 *
 * @param currentX - Current x position (should be at a cell center).
 * @param currentY - Current y position (should be at a cell center).
 * @param vx - Velocity x component (axis-aligned, non-zero).
 * @param vy - Velocity y component (axis-aligned, non-zero).
 * @returns The next cell center position in the movement direction.
 */
const computeTargetCell = (
  currentX: number,
  currentY: number,
  vx: number,
  vy: number,
): { x: number; y: number } => {
  return {
    x: currentX + Math.sign(vx) * CELL_SIZE,
    y: currentY + Math.sign(vy) * CELL_SIZE,
  };
};

/**
 * Resolves diagonal velocity to a single dominant axis.
 *
 * When both x and y velocity components are non-zero, the axis with
 * the larger absolute magnitude wins. Horizontal is preferred on a tie.
 *
 * @param vel - The raw velocity data.
 * @returns Axis-aligned velocity with the non-dominant component zeroed.
 */
const resolveDiagonalVelocity = (vel: VelocityData): { x: number; y: number } => {
  if (vel.x === 0 || vel.y === 0) {
    return { x: vel.x, y: vel.y };
  }

  if (Math.abs(vel.x) >= Math.abs(vel.y)) {
    return { x: vel.x, y: 0 };
  }

  return { x: 0, y: vel.y };
};

/**
 * Updates world-space positions for all entities that have both a
 * {@link Position} and a {@link Velocity} component.
 *
 * Movement is grid-aligned: entities snap to the nearest 32×32 cell
 * center on the first movement frame, then step between cell centers
 * in the velocity direction. Diagonal velocity is blocked — only one
 * axis moves at a time.
 *
 * Idle entities (zero velocity) are left untouched — no aggressive
 * cell snapping.
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
  const entityTargets = _getTargets(world);
  const entityAligned = _getAligned(world);
  const prevAxis = _getPrevAxis(world);

  for (const eid of entities) {
    const vel = getComponent(world, eid, Velocity) as VelocityData | undefined;
    if (!vel || (vel.x === 0 && vel.y === 0)) {
      // Entity stopped — clear grid alignment state
      entityTargets.delete(eid);
      entityAligned.delete(eid);
      prevAxis.delete(eid);
      continue;
    }

    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    // Block diagonal drift — only one axis at a time
    const resolved = resolveDiagonalVelocity(vel);
    const effectiveSpeed = Math.abs(resolved.x) + Math.abs(resolved.y);

    // Detect axis change: if the entity changed movement axis (e.g., right→down),
    // reset alignment so it snaps to the nearest cell center first.
    const currentAxis = resolved.x !== 0 ? 1 : 2;
    const lastAxis = prevAxis.get(eid);
    if (lastAxis !== undefined && lastAxis !== currentAxis) {
      entityAligned.delete(eid);
      entityTargets.delete(eid);
    }
    prevAxis.set(eid, currentAxis);

    let currentX = pos.x;
    let currentY = pos.y;

    // First movement frame (or after axis change): snap to nearest cell center
    if (!entityAligned.has(eid)) {
      currentX = snapToCellCenter(currentX);
      currentY = snapToCellCenter(currentY);
      entityAligned.add(eid);
    }

    // Step through grid cells until the frame's movement budget is spent
    let remainingStep = effectiveSpeed * deltaSeconds;

    while (remainingStep > 0) {
      let target = entityTargets.get(eid);
      if (!target) {
        target = computeTargetCell(currentX, currentY, resolved.x, resolved.y);
        entityTargets.set(eid, target);
      }

      const dx = target.x - currentX;
      const dy = target.y - currentY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= remainingStep || dist < 0.01) {
        // Reached target cell center — snap exactly and advance to next cell
        currentX = target.x;
        currentY = target.y;
        remainingStep -= dist;
        entityTargets.delete(eid);
      } else {
        // Partial step toward the target cell center
        const ratio = remainingStep / dist;
        currentX += dx * ratio;
        currentY += dy * ratio;
        remainingStep = 0;
      }
    }

    addComponent(
      world,
      eid,
      set(Position, {
        x: currentX,
        y: currentY,
      }),
    );
  }
};

export { updateMovement };

/**
 * Clears all per-world grid alignment tracking state.
 *
 * Call during world teardown to prevent stale entity references
 * from leaking between world instances.
 *
 * @param world - The bitECS world to clear tracking for.
 */
const resetMovementTracking = (world: World): void => {
  _worldTargets.delete(world);
  _worldAligned.delete(world);
  _worldPrevAxis.delete(world);
};

export { resetMovementTracking };
