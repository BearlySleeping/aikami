// packages/frontend/engine/src/math/jps/generational_table.ts

// ---------------------------------------------------------------------------
// Generational Table — O(1) cost map reset via epoch counter
//
// Contract C-192 AC-1: Instead of looping to clear N-element tracking arrays
// on each new search, we increment a global generation counter. During
// node access, if NodeGenerationMap[nodeId] !== GlobalGeneration, the node
// is treated as unvisited (cost = Infinity, parent = null).
//
// This reduces cost map reset from O(N) to O(1), eliminating GC thrashing
// on large grids.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PathfinderMemoryBuffers — fixed-capacity typed arrays
// ---------------------------------------------------------------------------

/**
 * Pre-allocated memory buffers for JPS pathfinding.
 *
 * All arrays are indexed by node ID (derived from grid coordinates converted
 * to a flat 1D index). Their capacity is `gridWidth * gridHeight`.
 */
export type PathfinderMemoryBuffers = {
  /** Movement cost from the start node (G-cost). */
  gCostMap: Float32Array;
  /** Estimated total cost G + H (F-cost). */
  fCostMap: Float32Array;
  /** Parent node flat index for path reconstruction (-1.0 = no parent). */
  parentMap: Float32Array;
  /** Generation epoch for each node (0 = never visited). */
  nodeGenerationMap: Uint32Array;
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Current global generation counter. Incremented on each new search. */
let _globalGeneration = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Allocates pathfinder memory buffers for a grid of the given dimensions.
 *
 * All arrays are initialized to 0 (treated as unvisited by the generational
 * check). Capacity = gridWidth × gridHeight.
 *
 * @param gridWidth - Width of the pathfinding grid in cells.
 * @param gridHeight - Height of the pathfinding grid in cells.
 * @returns Pre-allocated PathfinderMemoryBuffers.
 */
export const allocatePathfinderBuffers = (
  gridWidth: number,
  gridHeight: number,
): PathfinderMemoryBuffers => {
  const capacity = gridWidth * gridHeight;
  return {
    gCostMap: new Float32Array(capacity),
    fCostMap: new Float32Array(capacity),
    parentMap: new Float32Array(capacity).fill(-1),
    nodeGenerationMap: new Uint32Array(capacity),
  };
};

/**
 * Increments the global generation counter, effectively resetting all
 * tracking tables in O(1) time.
 *
 * Must be called at the start of each new pathfinding search.
 *
 * @returns The new global generation value.
 */
export const incrementGeneration = (): number => {
  _globalGeneration++;
  // Prevent overflow: reset to 1 if we approach uint32 max
  if (_globalGeneration > 0xfffffff0) {
    _globalGeneration = 1;
  }
  return _globalGeneration;
};

/**
 * Returns the current global generation value.
 */
export const getGlobalGeneration = (): number => {
  return _globalGeneration;
};

/**
 * Checks whether a node has been visited in the current search generation.
 *
 * A node is "visited" if its generation matches the global counter.
 *
 * @param buffers - The pathfinder memory buffers.
 * @param nodeId - Flat 1D node index.
 * @returns `true` if the node was visited in the current generation.
 */
export const isNodeVisited = (buffers: PathfinderMemoryBuffers, nodeId: number): boolean => {
  return buffers.nodeGenerationMap[nodeId] === _globalGeneration;
};

/**
 * Marks a node as visited in the current generation.
 *
 * @param buffers - The pathfinder memory buffers.
 * @param nodeId - Flat 1D node index.
 */
export const markNodeVisited = (buffers: PathfinderMemoryBuffers, nodeId: number): void => {
  buffers.nodeGenerationMap[nodeId] = _globalGeneration;
};

/**
 * Resets a node to unvisited state (clears generation, costs, parent).
 *
 * @param buffers - The pathfinder memory buffers.
 * @param nodeId - Flat 1D node index.
 */
export const resetNode = (buffers: PathfinderMemoryBuffers, nodeId: number): void => {
  buffers.nodeGenerationMap[nodeId] = 0;
  buffers.gCostMap[nodeId] = 0;
  buffers.fCostMap[nodeId] = 0;
  buffers.parentMap[nodeId] = -1;
};

/**
 * Frees all buffers by releasing references (let GC handle actual memory).
 *
 * @param buffers - The buffers to release.
 */
export const freePathfinderBuffers = (_buffers: PathfinderMemoryBuffers): void => {
  // TypedArray buffers are GC-managed; setting to 0-length releases the view
  // but the underlying ArrayBuffer persists until all views are collected.
  // This is a no-op for now — production could use SharedArrayBuffer pooling.
};

// ---------------------------------------------------------------------------
// Node ID conversion helpers
// ---------------------------------------------------------------------------

/**
 * Converts 2D grid coordinates to a flat 1D node index.
 *
 * @param gx - Grid X coordinate.
 * @param gy - Grid Y coordinate.
 * @param gridWidth - Grid width in cells.
 * @returns Flat 1D index.
 */
export const toNodeId = (gx: number, gy: number, gridWidth: number): number => {
  return gy * gridWidth + gx;
};

/**
 * Converts a flat 1D node index back to 2D grid coordinates.
 *
 * @param nodeId - Flat 1D index.
 * @param gridWidth - Grid width in cells.
 * @returns [gx, gy] tuple.
 */
export const fromNodeId = (nodeId: number, gridWidth: number): [number, number] => {
  const gy = Math.floor(nodeId / gridWidth);
  const gx = nodeId % gridWidth;
  return [gx, gy];
};
