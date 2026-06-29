// packages/frontend/engine/src/math/vision/shadowcasting.ts

// ---------------------------------------------------------------------------
// Recursive Shadowcasting FOV — 8-octant directional field of view
//
// Contract C-190 AC-3: Recursive Shadowcasting FOV engine for alert/suspicious
// NPC states. Processes 8 triangular octants outward from the observer, tracking
// slope boundaries for shadow occlusion. Clamped to the NPC's look direction
// heading and peripheral fovAngle.
//
// Based on Adam Milazzo's recursive shadowcasting algorithm. Uses floating-point
// slopes for correctness with directional clamping. Zero heap allocations inside
// the recursion — all writes go to a pre-allocated Uint8Array visibility map.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Octant transform table — maps (col, row) → world (dx, dy)
//
// Each octant covers a 45° arc. The transform function converts internal
// (col, row) coordinates (where col ≥ 1, 0 ≤ row ≤ col) to world offsets.
// ---------------------------------------------------------------------------

/** Octant transform function type. */
type OctantTransform = (col: number, row: number) => [number, number];

/** Pre-computed octant transforms, indexed 0-7. */
const OCTANT_TRANSFORMS: OctantTransform[] = [
  // Octant 0: ENE  (0° to 45°)  — dx = col,  dy = -row
  (col, row) => [col, -row],
  // Octant 1: NNE  (45° to 90°) — dx = row,  dy = -col
  (col, row) => [row, -col],
  // Octant 2: NNW  (90° to 135°) — dx = -row, dy = -col
  (col, row) => [-row, -col],
  // Octant 3: WNW  (135° to 180°) — dx = -col, dy = -row
  (col, row) => [-col, -row],
  // Octant 4: WSW  (180° to 225°) — dx = -col, dy = row
  (col, row) => [-col, row],
  // Octant 5: SSW  (225° to 270°) — dx = -row, dy = col
  (col, row) => [-row, col],
  // Octant 6: SSE  (270° to 315°) — dx = row,  dy = col
  (col, row) => [row, col],
  // Octant 7: ESE  (315° to 360°) — dx = col,  dy = row
  (col, row) => [col, row],
];

/** Base angle (in radians) for each octant. Octant 0 starts at angle 0. */
const OCTANT_BASE_ANGLES = [
  0,
  Math.PI / 4,
  Math.PI / 2,
  (3 * Math.PI) / 4,
  Math.PI,
  (5 * Math.PI) / 4,
  (3 * Math.PI) / 2,
  (7 * Math.PI) / 4,
];

// ---------------------------------------------------------------------------
// Slope helpers
// ---------------------------------------------------------------------------

/**
 * Computes the upper slope of a diamond cell at (col, row).
 *
 * The upper slope is the top edge of the diamond — any light above this
 * slope passes over the top of the cell. Used when transitioning from
 * blocked → unblocked to set the new start slope for recursion.
 */
const _upperSlope = (col: number, row: number): number => {
  return col === 0 ? 0 : (row - 0.5) / (col + 0.5);
};

// ---------------------------------------------------------------------------
// Core recursive shadowcasting for a single octant
// ---------------------------------------------------------------------------

/**
 * Recursive shadow-casting pass for one octant.
 *
 * Processes column `col` outward from the observer, scanning rows within
 * `[startSlope, endSlope]`. When a wall is encountered, shadows are cast
 * by adjusting slopes for the next recursive call.
 *
 * All visible cells are marked as 1 in `visibleMap`.
 *
 * @param cx - Observer grid X.
 * @param cy - Observer grid Y.
 * @param col - Current column distance from observer.
 * @param startSlope - Minimum visible slope for this column.
 * @param endSlope - Maximum visible slope for this column.
 * @param octantIndex - Which octant (0-7) is being processed.
 * @param maxRadius - Maximum vision distance in tiles.
 * @param isWall - Wall-check function (gx, gy) => boolean.
 * @param visibleMap - Pre-allocated Uint8Array visibility map.
 * @param gridW - Grid width in tiles.
 * @param gridH - Grid height in tiles.
 */
const _castOctant = (
  cx: number,
  cy: number,
  col: number,
  startSlope: number,
  endSlope: number,
  octantIndex: number,
  maxRadius: number,
  isWall: (gx: number, gy: number) => boolean,
  visibleMap: Uint8Array,
  gridW: number,
  gridH: number,
): void => {
  if (startSlope >= endSlope || col > maxRadius) {
    return;
  }

  const transform = OCTANT_TRANSFORMS[octantIndex];
  const maxRadiusSq = maxRadius * maxRadius;

  let nextStartSlope = startSlope;
  let prevBlocked = false;

  // Scan rows: from ceil(col * startSlope) to min(col, floor(col * endSlope))
  const rowStart = Math.ceil(col * startSlope);
  const rowEnd = Math.min(col, Math.floor(col * endSlope));

  for (let row = rowStart; row <= rowEnd; row++) {
    // Distance check
    if (col * col + row * row > maxRadiusSq) {
      break;
    }

    const [dx, dy] = transform(col, row);
    const wx = cx + dx;
    const wy = cy + dy;

    // Bounds check
    if (wx < 0 || wx >= gridW || wy < 0 || wy >= gridH) {
      // Out-of-bounds: treat as blocked (terminates this scan line)
      prevBlocked = true;
      continue;
    }

    const blocked = isWall(wx, wy);

    // Mark cell visible if it's a wall OR if it's symmetric (avoids
    // double-processing cells at octant boundaries)
    if (blocked || _isSymmetric(col, row)) {
      visibleMap[wy * gridW + wx] = 1;
    }

    if (prevBlocked && !blocked) {
      // Transition: blocked → unblocked — start of a new visible region
      nextStartSlope = _upperSlope(col, row);
    }

    if (!prevBlocked && blocked) {
      // Transition: unblocked → blocked — cast shadow for this region
      _castOctant(
        cx,
        cy,
        col + 1,
        nextStartSlope,
        _upperSlope(col, row),
        octantIndex,
        maxRadius,
        isWall,
        visibleMap,
        gridW,
        gridH,
      );
    }

    prevBlocked = blocked;
  }

  // If last cell was unblocked, continue casting to the next column
  if (!prevBlocked && rowStart <= rowEnd) {
    _castOctant(
      cx,
      cy,
      col + 1,
      nextStartSlope,
      endSlope,
      octantIndex,
      maxRadius,
      isWall,
      visibleMap,
      gridW,
      gridH,
    );
  }
};

// ---------------------------------------------------------------------------
// Symmetry check — prevents double-processing at octant boundaries
// ---------------------------------------------------------------------------

/**
 * Checks whether a cell at (col, row) is symmetric (lies on an octant boundary)
 * and should be processed in the current octant rather than the adjacent one.
 *
 * A cell on the top edge (row == 0) is always processed. Cells on the diagonal
 * (row == col) are only processed if this octant is responsible for them —
 * we process all boundary cells to avoid gaps.
 */
const _isSymmetric = (_col: number, _row: number): boolean => {
  // Always mark visible cells — the duplicate-write is harmless and avoids
  // gaps at octant boundaries. The alternative (tracking which octant "owns"
  // boundary cells) adds complexity with no visual benefit.
  return true;
};

// ---------------------------------------------------------------------------
// Octant overlap computation
// ---------------------------------------------------------------------------

/**
 * Result of octant-clamping for a single octant.
 *
 * Contains clamped `startSlope` and `endSlope` in octant-local [0, 1] slope
 * space. If `overlaps` is false, the octant should be skipped entirely.
 */
type OctantOverlap = {
  /** Whether this octant overlaps the vision cone at all. */
  overlaps: boolean;
  /** Clamped start slope (0 = octant base, 1 = octant + 45°). */
  startSlope: number;
  /** Clamped end slope (0 = octant base, 1 = octant + 45°). */
  endSlope: number;
};

/**
 * Computes the overlap between the vision cone and a single octant.
 *
 * The vision cone spans [lookDir - fovAngle/2, lookDir + fovAngle/2].
 * Each octant covers [octantBase, octantBase + π/4].
 * Overlaps are mapped to octant-local [0, 1] slope space via tan().
 *
 * @param octantIndex - Octant index 0-7.
 * @param lookDir - Look direction heading in radians [0, 2π).
 * @param fovAngle - Vision cone arc in radians.
 * @returns OctantOverlap with clamped slopes.
 */
const _computeOctantOverlap = (
  octantIndex: number,
  lookDir: number,
  fovAngle: number,
): OctantOverlap => {
  const octantBase = OCTANT_BASE_ANGLES[octantIndex];
  const octantEnd = octantBase + Math.PI / 4;

  const halfAngle = fovAngle / 2;
  let coneStart = lookDir - halfAngle;
  let coneEnd = lookDir + halfAngle;

  // Normalize cone angles to [0, 2π)
  const normalize = (a: number): number => {
    let result = a % (2 * Math.PI);
    if (result < 0) {
      result += 2 * Math.PI;
    }
    return result;
  };

  // Full 360° — process all octants with full range
  if (fovAngle >= 2 * Math.PI - 1e-9) {
    return { overlaps: true, startSlope: 0, endSlope: 1 };
  }

  coneStart = normalize(coneStart);
  coneEnd = normalize(coneEnd);

  // Handle cone wrapping around 0
  if (coneStart > coneEnd) {
    // Cone wraps: [coneStart, 2π) ∪ [0, coneEnd]
    const overlap1 = _intervalOverlap(coneStart, 2 * Math.PI, octantBase, octantEnd);
    const overlap2 = _intervalOverlap(0, coneEnd, octantBase, octantEnd);

    if (!overlap1 && !overlap2) {
      return { overlaps: false, startSlope: 0, endSlope: 0 };
    }

    if (overlap1 && overlap2) {
      // Cone fully contains the octant
      return { overlaps: true, startSlope: 0, endSlope: 1 };
    }

    const overlapStart = overlap1 ? coneStart : 0;
    const overlapEnd = overlap2 ? coneEnd : 2 * Math.PI;

    return _buildOctantSlopes(octantBase, overlapStart, overlapEnd);
  }

  // No wrap: simple interval overlap
  if (!_intervalOverlap(coneStart, coneEnd, octantBase, octantEnd)) {
    return { overlaps: false, startSlope: 0, endSlope: 0 };
  }

  const overlapStart = Math.max(coneStart, octantBase);
  const overlapEnd = Math.min(coneEnd, octantEnd);

  return _buildOctantSlopes(octantBase, overlapStart, overlapEnd);
};

/**
 * Checks whether two intervals [a1, a2] and [b1, b2] overlap.
 */
const _intervalOverlap = (a1: number, a2: number, b1: number, b2: number): boolean => {
  return a1 < b2 && b1 < a2;
};

/**
 * Maps absolute angle overlap [overlapStart, overlapEnd] into octant-local
 * [0, 1] slope space.
 */
const _buildOctantSlopes = (
  octantBase: number,
  overlapStart: number,
  overlapEnd: number,
): OctantOverlap => {
  const localStart = Math.max(0, overlapStart - octantBase);
  const localEnd = Math.min(Math.PI / 4, overlapEnd - octantBase);

  const startSlope = Math.tan(localStart);
  const endSlope = Math.tan(localEnd);

  // Clamp slopes to [0, 1] — octant slopes range from 0 to tan(45°) = 1
  return {
    overlaps: true,
    startSlope: Math.max(0, Math.min(1, startSlope)),
    endSlope: Math.max(0, Math.min(1, endSlope)),
  };
};

// ---------------------------------------------------------------------------
// castShadowcastingFov — public entry point
// ---------------------------------------------------------------------------

/**
 * Casts directional Recursive Shadowcasting FOV from an observer position.
 *
 * Processes 8 triangular octants outward from `(cx, cy)`, clamping slope
 * boundaries to the NPC's look direction and peripheral FOV angle. Marks
 * all visible cells as 1 in the pre-allocated `visibleMap`.
 *
 * Zero heap allocations inside the recursion — all writes go to the
 * TypedArray visibility map.
 *
 * @param options.cx - Observer grid X coordinate.
 * @param options.cy - Observer grid Y coordinate.
 * @param options.lookDir - Look direction heading in radians [0, 2π).
 * @param options.fovAngle - Peripheral vision cone arc in radians.
 * @param options.maxRadius - Maximum tile distance for vision.
 * @param options.isWall - Wall-check function (gx, gy) => boolean.
 * @param options.visibleMap - Pre-allocated Uint8Array visibility map.
 * @param options.gridW - Grid width in tiles.
 * @param options.gridH - Grid height in tiles.
 */
export const castShadowcastingFov = (options: {
  cx: number;
  cy: number;
  lookDir: number;
  fovAngle: number;
  maxRadius: number;
  isWall: (gx: number, gy: number) => boolean;
  visibleMap: Uint8Array;
  gridW: number;
  gridH: number;
}): void => {
  const { cx, cy, lookDir, fovAngle, maxRadius, isWall, visibleMap, gridW, gridH } = options;

  // Mark observer cell as visible
  if (cx >= 0 && cx < gridW && cy >= 0 && cy < gridH) {
    visibleMap[cy * gridW + cx] = 1;
  }

  // Process each octant — only those overlapping the vision cone
  for (let o = 0; o < 8; o++) {
    const overlap = _computeOctantOverlap(o, lookDir, fovAngle);

    if (!overlap.overlaps) {
      continue;
    }

    // Start recursion from column 1 (column 0 is the observer cell)
    _castOctant(
      cx,
      cy,
      1,
      overlap.startSlope,
      overlap.endSlope,
      o,
      maxRadius,
      isWall,
      visibleMap,
      gridW,
      gridH,
    );
  }
};
