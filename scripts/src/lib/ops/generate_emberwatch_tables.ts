// scripts/src/lib/ops/generate_emberwatch_tables.ts
//
// Shared GID-table derivation for the Emberwatch generators (C-376 AC-6 D5).
//
// The manifest is the single source of truth for the GID↔frame mapping.
// Both generators import from here instead of hand-declaring their own
// tables, so a manifest edit is the ONLY change needed to retile/regenerate.
//
// Side-effect free — safe to import from tests.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Atlas grid geometry.
 *
 * C-378 AC-5: frames are packed with 1px edge extrusion — each frame
 * occupies a 34px cell (1px padding on every side) so adjacent-atlas
 * sampling never bleeds. The 32px content stays at (cell*34+1).
 *
 * Single source of truth for the atlas grid dimensions: the atlas
 * generator's COLS/ROWS/W/H and the map tileset blocks (columns,
 * tilecount, imagewidth, imageheight, spacing, margin) are all derived
 * from these so the three cannot drift independently (CodeRabbit review,
 * C-376).
 */
export const ATLAS_COLS = 16;
// C-546 grew 8→10 for bridge frames; C-553 grows 10→11 for house frames;
// C-559 grows 11→13 for append-only pinned path and landing families. Existing
// GIDs and the original corner16 terrain block never move.
export const ATLAS_ROWS = 13;
export const ATLAS_TILE_SIZE = 32;

/** 1px edge extrusion around every frame (C-378 AC-5). */
export const ATLAS_PADDING = 1;

/** Cell pitch including padding (34px). */
export const ATLAS_CELL = ATLAS_TILE_SIZE + ATLAS_PADDING * 2;

export const ATLAS_WIDTH = ATLAS_COLS * ATLAS_CELL; // 544

export const ATLAS_HEIGHT = ATLAS_ROWS * ATLAS_CELL; // 442
export const ATLAS_TILE_COUNT = ATLAS_COLS * ATLAS_ROWS; // 208

/**
 * First atlas cell (0-based) reserved for the corner16 terrain block.
 *
 * The baked manifest tiles occupy cells 0..47 (GIDs 1..48). Terrain frames are
 * allocated from cell 48 regardless of any frames appended at higher GIDs:
 * growing `ATLAS_ROWS` to append a frame must never shift an existing terrain
 * frame's GID (the committed atlas.json and the derivation test pin them). A
 * baked frame placed inside this block is caught by the collision check in
 * `registerTerrainFrames`; appended frames belong after the block.
 */
export const ATLAS_TERRAIN_BLOCK_START = 48;

/** Exclusive end of the terrain block; appended frames start at GID 129. */
export const ATLAS_TERRAIN_BLOCK_END = 128;

/** Corner-16 mask count per terrain (C-378). */
export const CORNER16_FRAMES = 16;

const MANIFEST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../content/packs/emberwatch/manifest.json',
);

let _cachedManifestTiles: Record<string, { name: string; frame: string }> | undefined;

let _cachedManifestTerrains:
  | Array<{
      name: string;
      precedence: number;
      wang: string;
      frameBase: string;
      variants?: string[];
      isWalkable: boolean;
    }>
  | undefined;

/**
 * Reads manifest.json and returns tileId (gid string) → { name, frame }.
 *
 * Memoized — both buildG and buildFrames read the same parsed manifest, so
 * a generator run parses the file exactly once (CodeRabbit review, C-376).
 */
export const readManifestTiles = (): Record<string, { name: string; frame: string }> => {
  if (_cachedManifestTiles) {
    return _cachedManifestTiles;
  }
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
    tiles?: Record<string, { name?: string; frame?: string }>;
  };
  const tiles = raw.tiles ?? {};
  const result: Record<string, { name: string; frame: string }> = {};
  for (const [gid, def] of Object.entries(tiles)) {
    result[gid] = { name: def.name ?? gid, frame: def.frame ?? '' };
  }
  _cachedManifestTiles = result;
  return result;
};

/** Clears the memoized manifest (test isolation only). */
export const resetManifestTilesCache = (): void => {
  _cachedManifestTiles = undefined;
};

/**
 * Seeds the memoized manifest read (test-only — validation-guard tests).
 *
 * Pass the tiles to seed, or `undefined` to restore real-manifest reads.
 * Tests must restore the cache with `resetManifestTilesCache()` afterwards.
 */
export const setManifestTilesForTest = (
  tiles: Record<string, { name: string; frame: string }> | undefined,
): void => {
  _cachedManifestTiles = tiles;
};

/** Semantic key → manifest tile name (alias table kept minimal). */
const TILE_NAME_ALIASES = {
  GRASS: 'grass',
  GRASS_VARIANT: 'grass_variant',
  GRASS_DARK: 'grass_dark',
  DIRT: 'dirt',
  PATH: 'path_tough',
  STONE_FLOOR: 'stone_floor',
  WOOD_FLOOR: 'wood_floor',
  BRICK: 'brick',
  BRICK_VARIANT: 'brick_wall',
  WOOD_WALL: 'wood_wall',
  STONE_WALL: 'stone_wall',
  WALL_TOP: 'wall_top',
  ROOF: 'roof',
  WATER: 'water',
  FENCE: 'fence',
  WOOD_FENCE: 'wood_fence',
  NOTICE: 'notice_board',
  GATE: 'village_gate',
  CHEST: 'chest',
  RED_CHEST: 'red_chest',
  BARREL: 'barrel',
  CRATE: 'crate',
  COUNTER: 'counter',
  TABLE: 'table',
  BED: 'bed',
  RUG: 'rug',
  BOOKSHELF: 'bookshelf',
  FIREPLACE: 'fireplace',
  CANDLE: 'candle',
  PLANT: 'plant',
  ANVIL: 'anvil',
  PATH_VAR: 'path_tough_variant',
  STONE_VAR: 'stone_floor_variant',
  WOOD_VAR: 'wood_floor_variant',
  SAND: 'sand',
  BRIDGE: 'bridge',
  STEPS: 'steps',
  COLUMN: 'column',
  WINDOW: 'window',
  DOOR: 'wood_door',
  FLAGSTONE: 'flagstone',
  RUG_ROUND: 'rug_round',
} as const;

/**
 * Builds the map-generator G lookup from manifest.tiles.
 *
 * The return type is key-constrained to {@link TILE_NAME_ALIASES} so an
 * invalid alias access (e.g. `G.GRAS`) fails at compile time instead of
 * resolving to `undefined` at runtime (CodeRabbit review, C-376).
 *
 * Throws when a semantic alias has no matching manifest tile — a manifest
 * rename must update the alias table, never silently fall back — and when
 * two manifest tiles share a name (a duplicate would silently produce a
 * wrong GID mapping).
 */
export const buildG = (): Record<keyof typeof TILE_NAME_ALIASES, number> => {
  const tiles = readManifestTiles();
  const nameToGid = new Map<string, number>();
  for (const [gid, def] of Object.entries(tiles)) {
    if (nameToGid.has(def.name)) {
      throw new Error(
        `generate_emberwatch: duplicate manifest tile name "${def.name}" (GIDs ${nameToGid.get(def.name)} and ${gid})`,
      );
    }
    nameToGid.set(def.name, Number(gid));
  }

  const g = {} as Record<keyof typeof TILE_NAME_ALIASES, number>;
  for (const [key, name] of Object.entries(TILE_NAME_ALIASES)) {
    const gid = nameToGid.get(name);
    if (gid === undefined) {
      throw new Error(
        `generate_emberwatch: manifest.tiles has no tile named "${name}" (for ${key})`,
      );
    }
    g[key as keyof typeof TILE_NAME_ALIASES] = gid;
  }
  return g;
};

/**
 * Builds the atlas-generator FRAMES table (frame → [col, row]) from
 * manifest.tiles. GID = row*ATLAS_COLS + col + 1 in the atlas grid.
 *
 * Throws when a GID falls outside the declared atlas grid (1..ATLAS_COLS*ATLAS_ROWS)
 * so the atlas generator cannot emit rectangles beyond meta.size, and when
 * two tiles share a frame (a duplicate would silently overwrite the mapping).
 */
export const buildFrames = (): Record<string, [number, number]> => {
  const tiles = readManifestTiles();
  const frames: Record<string, [number, number]> = {};
  const maxGid = ATLAS_COLS * ATLAS_ROWS;
  for (const [gid, def] of Object.entries(tiles)) {
    if (!def.frame) {
      continue;
    }
    const numericGid = Number(gid);
    if (!Number.isInteger(numericGid) || numericGid < 1 || numericGid > maxGid) {
      throw new Error(
        `generate_emberwatch: tile GID ${numericGid} is outside the atlas grid (1..${maxGid}) — cannot emit frame "${def.frame}"`,
      );
    }
    const cell = numericGid - 1;
    if (cell >= ATLAS_TERRAIN_BLOCK_START && cell < ATLAS_TERRAIN_BLOCK_END) {
      throw new Error(
        `generate_emberwatch: tile GID ${numericGid} occupies reserved terrain cell ${cell} — cannot emit frame "${def.frame}"`,
      );
    }
    if (frames[def.frame]) {
      throw new Error(`generate_emberwatch: duplicate manifest frame "${def.frame}" (GID ${gid})`);
    }
    frames[def.frame] = [cell % ATLAS_COLS, Math.floor(cell / ATLAS_COLS)];
  }
  return frames;
};

/**
 * Corner-16 frame name for a mask (C-378): frameBase names mask 0, masks
 * 1..15 derive as `${stem}_${mask}${ext}`.
 */
export const cornerFrameName = (frameBase: string, mask: number): string => {
  if (mask === 0) {
    return frameBase;
  }
  const dot = frameBase.lastIndexOf('.');
  const ext = dot > 0 ? frameBase.slice(dot) : '';
  let stem = dot > 0 ? frameBase.slice(0, dot) : frameBase;
  stem = stem.replace(/_0$/, '');
  return `${stem}_${mask}${ext}`;
};

/**
 * Reads the pack manifest's `terrains` block (C-378). Returns [] when the
 * pack declares no terrains (legacy pack).
 */
export const readManifestTerrains = (): Array<{
  name: string;
  precedence: number;
  wang: string;
  frameBase: string;
  variants?: string[];
  isWalkable: boolean;
}> => {
  if (_cachedManifestTerrains) {
    return _cachedManifestTerrains;
  }
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
    terrains?: Array<{
      name?: string;
      precedence?: number;
      wang?: string;
      frameBase?: string;
      variants?: string[];
      isWalkable?: boolean;
    }>;
  };
  const terrains = raw.terrains ?? [];
  // Fail fast: a `corner16` terrain without a frameBase would silently
  // allocate 16 atlas cells for frames no painter can draw (muted-grass
  // tiles instead of a generator error). name and frameBase are required,
  // and `wang` accepts only the two modes the generator understands
  // ('fill' — the default — and 'corner16', the mode registerTerrainFrames
  // consumes). An unsupported wang value would otherwise be silently
  // skipped by the frame registrar while the runtime schema rejects the
  // pack — surface it here instead.
  _cachedManifestTerrains = terrains.map((t) => {
    const wang = t.wang ?? 'fill';
    if (!t.name) {
      throw new Error('generate_emberwatch: manifest.terrains entry has no "name"');
    }
    if (wang !== 'fill' && wang !== 'corner16') {
      throw new Error(
        `generate_emberwatch: terrain "${t.name}" has unsupported wang value "${wang}" (only 'fill' and 'corner16' are supported)`,
      );
    }
    if (!t.frameBase) {
      throw new Error(
        `generate_emberwatch: terrain "${t.name}" has no "frameBase" (required for wang "${wang}")`,
      );
    }
    return {
      name: t.name,
      precedence: t.precedence ?? 0,
      wang,
      frameBase: t.frameBase,
      variants: t.variants,
      isWalkable: t.isWalkable ?? true,
    };
  });
  return _cachedManifestTerrains;
};

/** Validates and resolves one reserved terrain cell before registration. */
const terrainFramePosition = (options: {
  frames: Record<string, [number, number]>;
  occupiedCells: ReadonlySet<number>;
  name: string;
  cell: number;
}): [number, number] => {
  const { frames, occupiedCells, name, cell } = options;
  if (cell >= ATLAS_TERRAIN_BLOCK_END) {
    throw new Error(
      `generate_emberwatch: reserved terrain block full — cannot place corner frame "${name}" at cell ${cell}`,
    );
  }
  if (frames[name]) {
    throw new Error(
      `generate_emberwatch: corner frame "${name}" collides with an existing atlas frame`,
    );
  }
  if (occupiedCells.has(cell)) {
    throw new Error(
      `generate_emberwatch: terrain cell ${cell} for corner frame "${name}" is occupied by an existing atlas frame`,
    );
  }
  const col = cell % ATLAS_COLS;
  const row = Math.floor(cell / ATLAS_COLS);
  if (row >= ATLAS_ROWS) {
    throw new Error(
      `generate_emberwatch: atlas full — cannot place corner frame "${name}" (row ${row})`,
    );
  }
  return [col, row];
};

const registerPinnedTerrainFrames = (options: {
  frames: Record<string, [number, number]>;
  occupiedCells: Set<number>;
  frameBase: string;
}): boolean => {
  const pinnedStart = options.frames[options.frameBase];
  if (!pinnedStart) {
    return false;
  }
  const pinnedCell = pinnedStart[1] * ATLAS_COLS + pinnedStart[0];
  for (let mask = 0; mask < CORNER16_FRAMES; mask++) {
    const name = cornerFrameName(options.frameBase, mask);
    const expectedCell = pinnedCell + mask;
    const position = options.frames[name];
    const actualCell = position ? position[1] * ATLAS_COLS + position[0] : undefined;
    if (actualCell !== expectedCell) {
      throw new Error(
        `generate_emberwatch: pinned terrain "${name}" must occupy cell ${expectedCell}`,
      );
    }
    options.occupiedCells.add(expectedCell);
  }
  return true;
};

/**
 * Allocates the reserved terrain cells and registers each corner16 mask.
 * Frames stay local to one atlas pack so repeated builds cannot collide.
 */
export const registerTerrainFrames = (frames: Record<string, [number, number]>): void => {
  const occupiedCells = new Set(Object.values(frames).map(([col, row]) => row * ATLAS_COLS + col));
  let nextCell = ATLAS_TERRAIN_BLOCK_START;
  for (const terrain of readManifestTerrains()) {
    if (terrain.wang !== 'corner16') {
      continue;
    }
    if (registerPinnedTerrainFrames({ frames, occupiedCells, frameBase: terrain.frameBase })) {
      continue;
    }
    for (let mask = 0; mask < CORNER16_FRAMES; mask++) {
      const name = cornerFrameName(terrain.frameBase, mask);
      const [col, row] = terrainFramePosition({ frames, occupiedCells, name, cell: nextCell });
      frames[name] = [col, row];
      occupiedCells.add(nextCell);
      nextCell += 1;
    }
  }
};

/** Clears the memoized terrain read (test isolation only). */
export const resetManifestTerrainsCache = (): void => {
  _cachedManifestTerrains = undefined;
};
