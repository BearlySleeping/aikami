// packages/frontend/engine/src/math/vision/dda_raycaster.ts

// ---------------------------------------------------------------------------
// DDA Vision Cone Raycaster — zero-allocation patrol vision
//
// Contract C-190 AC-2: Casts Digital Differential Analyzer (DDA) rays across
// an NPC's vision cone. Each ray traverses grid cells using unit-hypotenuse
// stepping until hitting a wall or reaching maxRadius.
//
// All output is written into a pre-allocated Uint8Array visibility map.
// No heap allocations inside the ray-casting loop.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module-level pre-allocated constants
// ---------------------------------------------------------------------------

/** Minimum number of rays cast per vision cone. */
const MIN_RAYS = 4;

/** Maximum number of rays cast per vision cone. */
const MAX_RAYS = 64;

// ---------------------------------------------------------------------------
// castDdaRay — single ray traversal (zero-allocation)
// ---------------------------------------------------------------------------

/**
 * Casts a single DDA ray from (ox, oy) in direction (dx, dy).
 *
 * Marks visited cells as 1 in the visibility map. Terminates early
 * when hitting a wall or exceeding maxSteps.
 *
 * No heap allocations — pure arithmetic and TypedArray writes.
 *
 * @param ox - Observer grid X coordinate.
 * @param oy - Observer grid Y coordinate.
 * @param dx - Normalized direction X component.
 * @param dy - Normalized direction Y component.
 * @param maxSteps - Maximum cells to traverse (fovRadius).
 * @param isWall - Wall-check callback (gx, gy) => boolean.
 * @param visibleMap - Pre-allocated Uint8Array visibility map (0 = hidden, 1 = visible).
 * @param gridW - Grid width in tiles.
 * @param gridH - Grid height in tiles.
 */
const _castDdaRay = (
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxSteps: number,
  isWall: (gx: number, gy: number) => boolean,
  visibleMap: Uint8Array,
  gridW: number,
  gridH: number,
): void => {
  // ── DDA initialization ──
  let mapX = Math.floor(ox);
  let mapY = Math.floor(oy);

  // Distance to next cell boundary along each axis
  const deltaX = dx === 0 ? 1e30 : Math.abs(1 / dx);
  const deltaY = dy === 0 ? 1e30 : Math.abs(1 / dy);

  let stepX: number;
  let stepY: number;
  let sideX: number;
  let sideY: number;

  if (dx < 0) {
    stepX = -1;
    sideX = (ox - mapX) * deltaX;
  } else {
    stepX = 1;
    sideX = (mapX + 1 - ox) * deltaX;
  }

  if (dy < 0) {
    stepY = -1;
    sideY = (oy - mapY) * deltaY;
  } else {
    stepY = 1;
    sideY = (mapY + 1 - oy) * deltaY;
  }

  // ── DDA traversal ──
  let steps = 0;

  // Mark observer cell as visible
  if (mapX >= 0 && mapX < gridW && mapY >= 0 && mapY < gridH) {
    visibleMap[mapY * gridW + mapX] = 1;
  }

  while (steps < maxSteps) {
    // Step to next cell boundary
    if (sideX < sideY) {
      sideX += deltaX;
      mapX += stepX;
    } else {
      sideY += deltaY;
      mapY += stepY;
    }

    // Bounds check
    if (mapX < 0 || mapX >= gridW || mapY < 0 || mapY >= gridH) {
      return;
    }

    // Mark cell visible
    visibleMap[mapY * gridW + mapX] = 1;

    // Wall check — terminate ray
    if (isWall(mapX, mapY)) {
      return;
    }

    steps++;
  }
};

// ---------------------------------------------------------------------------
// castDdaVisionCone — cone-cast DDA rays for patrol vision
// ---------------------------------------------------------------------------

/**
 * Casts a cone of DDA rays from the observer position across the vision cone.
 *
 * The number of rays is proportional to `fovAngle * maxRadius` (capped at
 * {@link MAX_RAYS}). Each ray uses unit-hypotenuse DDA stepping and terminates
 * at walls or the radius limit.
 *
 * Results are written into the pre-allocated `visibleMap` (Uint8Array).
 * Callers must zero the map before calling.
 *
 * @param options.ox - Observer grid X coordinate.
 * @param options.oy - Observer grid Y coordinate.
 * @param options.lookDir - Look direction heading in radians.
 * @param options.fovAngle - Vision cone arc in radians.
 * @param options.maxRadius - Maximum tile distance for vision.
 * @param options.isWall - Wall-check function (gx, gy) => boolean.
 * @param options.visibleMap - Pre-allocated Uint8Array visibility map.
 * @param options.gridW - Grid width in tiles.
 * @param options.gridH - Grid height in tiles.
 * @returns Number of rays cast.
 */
export const castDdaVisionCone = (options: {
  ox: number;
  oy: number;
  lookDir: number;
  fovAngle: number;
  maxRadius: number;
  isWall: (gx: number, gy: number) => boolean;
  visibleMap: Uint8Array;
  gridW: number;
  gridH: number;
}): number => {
  const { ox, oy, lookDir, fovAngle, maxRadius, isWall, visibleMap, gridW, gridH } = options;

  // Determine ray count: one per cell-width at max radius across the arc
  const rayCount = Math.max(MIN_RAYS, Math.min(MAX_RAYS, Math.ceil(fovAngle * maxRadius)));

  const halfAngle = fovAngle / 2;
  const startAngle = lookDir - halfAngle;
  const angleStep = fovAngle / (rayCount - 1);

  // Observer is always visible to itself
  if (ox >= 0 && ox < gridW && oy >= 0 && oy < gridH) {
    visibleMap[oy * gridW + ox] = 1;
  }

  // Mark the observer's starting cell explicitly
  const startCellX = Math.floor(ox);
  const startCellY = Math.floor(oy);
  if (startCellX >= 0 && startCellX < gridW && startCellY >= 0 && startCellY < gridH) {
    visibleMap[startCellY * gridW + startCellX] = 1;
  }

  // Cast rays across the cone — always include the look direction center
  _castDdaRay(
    ox,
    oy,
    Math.cos(lookDir),
    Math.sin(lookDir),
    maxRadius,
    isWall,
    visibleMap,
    gridW,
    gridH,
  );

  for (let i = 0; i < rayCount; i++) {
    const angle = startAngle + angleStep * i;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    _castDdaRay(ox, oy, dx, dy, maxRadius, isWall, visibleMap, gridW, gridH);
  }

  return rayCount;
};
