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
export const ATLAS_ROWS = 8;
export const ATLAS_TILE_SIZE = 32;

/** 1px edge extrusion around every frame (C-378 AC-5). */
export const ATLAS_PADDING = 1;

/** Cell pitch including padding (34px). */
export const ATLAS_CELL = ATLAS_TILE_SIZE + ATLAS_PADDING * 2;

export const ATLAS_WIDTH = ATLAS_COLS * ATLAS_CELL; // 544

export const ATLAS_HEIGHT = ATLAS_ROWS * ATLAS_CELL; // 272
export const ATLAS_TILE_COUNT = ATLAS_COLS * ATLAS_ROWS; // 128

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
  WELL: 'well',
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
    if (frames[def.frame]) {
      throw new Error(`generate_emberwatch: duplicate manifest frame "${def.frame}" (GID ${gid})`);
    }
    frames[def.frame] = [(numericGid - 1) % ATLAS_COLS, Math.floor((numericGid - 1) / ATLAS_COLS)];
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

/** Clears the memoized terrain read (test isolation only). */
export const resetManifestTerrainsCache = (): void => {
  _cachedManifestTerrains = undefined;
};
