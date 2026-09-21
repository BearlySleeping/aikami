// scripts/src/lib/ops/emberwatch_map_navigation.ts
//
// Pure navigation geometry for Emberwatch map validation.
//
// Builds the same tile-granular walkability the runtime uses (manifest tile
// solidity + the explicit collision layer + solid prop origin cells) and
// exposes breadth-first reachability and connected-component analysis. No PNG
// alpha is ever consulted; collision is semantic.
//
// Side-effect free and PixiJS-free, so the validator, the studio and tests can
// all share it.

export type MapJsonLike = {
  width: number;
  height: number;
  layers?: Array<{
    name?: string;
    type?: string;
    data?: number[];
    objects?: Array<{ type?: string; properties?: Array<{ name: string; value: unknown }> }>;
  }>;
};

export type ManifestTile = { isWalkable?: boolean; name?: string };
export type ManifestProp = { isWalkable?: boolean; frame?: string };

export type WalkabilityGrid = {
  width: number;
  height: number;
  /** 1 = solid, 0 = walkable. */
  blocked: Uint8Array;
};

export const gridIndex = (grid: { width: number }, c: number, r: number): number =>
  r * grid.width + c;

export const inBounds = (grid: WalkabilityGrid, c: number, r: number): boolean =>
  c >= 0 && c < grid.width && r >= 0 && r < grid.height;

export const isWalkable = (grid: WalkabilityGrid, c: number, r: number): boolean =>
  inBounds(grid, c, r) && grid.blocked[gridIndex(grid, c, r)] === 0;

export const cellOfPoint = (x: number, y: number, tileSize = 32): { c: number; r: number } => ({
  c: Math.floor(x / tileSize),
  r: Math.floor(y / tileSize),
});

/** The four orthogonal neighbours, in a stable order. */
export const NEIGHBORS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Builds the terrain/collision walkability grid from a map + manifest tiles.
 *
 * Every non-collision tile layer contributes solidity exactly as the engine's
 * `buildCollisionGrid` does: a GID whose manifest tile is `isWalkable: false`
 * blocks its cell. The explicit collision layer then adds solid cells on top.
 */
export const buildWalkabilityGrid = (options: {
  map: MapJsonLike;
  tiles: Record<string, ManifestTile>;
}): WalkabilityGrid => {
  const { map, tiles } = options;
  const total = map.width * map.height;
  const blocked = new Uint8Array(total);
  for (const layer of map.layers ?? []) {
    if (layer.type !== 'tilelayer' || !Array.isArray(layer.data)) {
      continue;
    }
    markLayerSolidity({
      blocked,
      data: layer.data,
      total,
      tiles,
      isCollision: layer.name === 'collision',
    });
  }
  return { width: map.width, height: map.height, blocked };
};

/** Marks one tile layer's solid cells (collision layer or manifest solidity). */
const markLayerSolidity = (options: {
  blocked: Uint8Array;
  data: number[];
  total: number;
  tiles: Record<string, ManifestTile>;
  isCollision: boolean;
}): void => {
  for (let i = 0; i < options.total; i++) {
    const gid = options.data[i] ?? 0;
    if (gid === 0) {
      continue;
    }
    if (options.isCollision) {
      options.blocked[i] = 1;
      continue;
    }
    const def = options.tiles[String(gid)];
    if (def === undefined || def.isWalkable === false) {
      options.blocked[i] = 1;
    }
  }
};

/** A placed prop reduced to the fields navigation cares about. */
export type NavigableProp = {
  propId: string;
  /** World-pixel origin. */
  x: number;
  y: number;
};

/**
 * Marks each solid prop's ORIGIN cell blocked, matching the runtime's
 * tile-granular prop collision (entity_spawner `_spawnProp`). Walkable props
 * (manifest `isWalkable: true`, e.g. the village gate) never block.
 */
export const applyPropCollision = (options: {
  grid: WalkabilityGrid;
  props: readonly NavigableProp[];
  manifestProps: Record<string, ManifestProp>;
  tileSize?: number;
}): void => {
  const tileSize = options.tileSize ?? 32;
  for (const prop of options.props) {
    const propIsWalkable = options.manifestProps[prop.propId]?.isWalkable ?? false;
    if (propIsWalkable) {
      continue;
    }
    const { c, r } = cellOfPoint(prop.x, prop.y, tileSize);
    if (inBounds(options.grid, c, r)) {
      options.grid.blocked[gridIndex(options.grid, c, r)] = 1;
    }
  }
};

/** Enqueues every walkable orthogonal neighbour of a cell not yet visited. */
const enqueueNeighbors = (options: {
  grid: WalkabilityGrid;
  visited: Uint8Array;
  queue: number[];
  index: number;
}): void => {
  const { grid, visited, queue, index } = options;
  const c = index % grid.width;
  const r = Math.floor(index / grid.width);
  for (const [dc, dr] of NEIGHBORS4) {
    const nc = c + dc;
    const nr = r + dr;
    if (!isWalkable(grid, nc, nr)) {
      continue;
    }
    const next = nr * grid.width + nc;
    if (visited[next] === 0) {
      visited[next] = 1;
      queue.push(next);
    }
  }
};

/** Breadth-first reachable set from a list of start cells. */
export const reachableFrom = (
  grid: WalkabilityGrid,
  starts: ReadonlyArray<{ c: number; r: number }>,
): Uint8Array => {
  const visited = new Uint8Array(grid.width * grid.height);
  const queue: number[] = [];
  for (const start of starts) {
    if (!isWalkable(grid, start.c, start.r)) {
      continue;
    }
    const index = gridIndex(grid, start.c, start.r);
    if (visited[index] === 0) {
      visited[index] = 1;
      queue.push(index);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++];
    if (index !== undefined) {
      enqueueNeighbors({ grid, visited, queue, index });
    }
  }
  return visited;
};

/**
 * Labels every walkable cell with a connected-component id (`-1` = blocked).
 * Deterministic: components are numbered in row-major discovery order.
 */
export const componentsOf = (grid: WalkabilityGrid): Int32Array => {
  const labels = new Int32Array(grid.width * grid.height).fill(-1);
  let next = 0;
  for (let start = 0; start < labels.length; start++) {
    if (grid.blocked[start] === 1 || labels[start] !== -1) {
      continue;
    }
    labelComponent(grid, labels, start, next);
    next += 1;
  }
  return labels;
};

/** Flood-fills one connected component with `label`, using `visited` = labels. */
const labelComponent = (
  grid: WalkabilityGrid,
  labels: Int32Array,
  start: number,
  label: number,
): void => {
  const queue = [start];
  labels[start] = label;
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++];
    if (index === undefined) {
      continue;
    }
    const c = index % grid.width;
    const r = Math.floor(index / grid.width);
    for (const [dc, dr] of NEIGHBORS4) {
      const nc = c + dc;
      const nr = r + dr;
      if (!isWalkable(grid, nc, nr)) {
        continue;
      }
      const n = nr * grid.width + nc;
      if (labels[n] === -1) {
        labels[n] = label;
        queue.push(n);
      }
    }
  }
};

/** Copies a grid so a rule can trial a hypothesis (e.g. unblock one prop). */
export const cloneGrid = (grid: WalkabilityGrid): WalkabilityGrid => ({
  width: grid.width,
  height: grid.height,
  blocked: new Uint8Array(grid.blocked),
});

/**
 * Clearance (in cells) at a walkable cell: the longer of the contiguous
 * horizontal and vertical walkable runs through it. This is the local corridor
 * width an actor of a given body size can use — a proxy for "is this route
 * companion-safe?".
 */
export const clearanceAt = (grid: WalkabilityGrid, c: number, r: number): number => {
  if (!isWalkable(grid, c, r)) {
    return 0;
  }
  let horizontal = 1;
  for (let x = c - 1; isWalkable(grid, x, r); x--) {
    horizontal += 1;
  }
  for (let x = c + 1; isWalkable(grid, x, r); x++) {
    horizontal += 1;
  }
  let vertical = 1;
  for (let y = r - 1; isWalkable(grid, c, y); y--) {
    vertical += 1;
  }
  for (let y = r + 1; isWalkable(grid, c, y); y++) {
    vertical += 1;
  }
  return Math.max(horizontal, vertical);
};
