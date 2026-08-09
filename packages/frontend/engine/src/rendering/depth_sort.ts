// packages/frontend/engine/src/rendering/depth_sort.ts
//
// Y-depth entity ordering for top-down rendering (C-375 AC-2).
//
// Classic "y-sort": an entity with a larger world-space Y (feet position,
// lower on screen) must render ON TOP of an entity with a smaller Y.
// Entities at the same Y must keep a deterministic order (spawn order)
// to avoid per-frame flicker.

/** An entity participating in the depth sort. */
export type DepthSortable = {
  /** Entity ID. */
  eid: number;
  /** World-space Y (feet position) used as the primary sort key. */
  y: number;
  /** Monotonic spawn order used as the tie-break for equal Y. */
  order: number;
};

/**
 * Computes the render order (array of eids, back-to-front) for a set of
 * entities sorted by world Y, tie-broken by spawn order for stability.
 *
 * Pure + deterministic — no PixiJS dependency, unit-testable.
 *
 * @param items - The entities to sort (may be any iterable order).
 * @returns Entity IDs in back-to-front render order (first = furthest back).
 */
export const computeDepthOrder = (items: readonly DepthSortable[]): number[] => {
  return items
    .slice()
    .sort((a, b) => a.y - b.y || a.order - b.order)
    .map((item) => item.eid);
};
