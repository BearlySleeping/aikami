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
 * Atlas grid geometry — the 512×256 atlas is 16×8 32px cells.
 *
 * Single source of truth for the atlas grid dimensions: the atlas
 * generator's COLS/ROWS/W/H and the map tileset blocks (columns,
 * tilecount, imagewidth, imageheight) are all derived from these so the
 * three cannot drift independently (CodeRabbit review, C-376).
 */
export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 8;
export const ATLAS_TILE_SIZE = 32;

export const ATLAS_WIDTH = ATLAS_COLS * ATLAS_TILE_SIZE; // 512
export const ATLAS_HEIGHT = ATLAS_ROWS * ATLAS_TILE_SIZE; // 256
export const ATLAS_TILE_COUNT = ATLAS_COLS * ATLAS_ROWS; // 128

const MANIFEST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/frontend/client/static/content-packs/emberwatch/manifest.json',
);

let _cachedManifestTiles: Record<string, { name: string; frame: string }> | undefined;

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
