// packages/shared/constants/src/lib/game/world_scale.ts
//
// C-497 — Named world-scale / camera-framing policy.
//
// The game world container is scaled by BASE_WORLD_SCALE so that each
// world-space pixel renders as that many CSS pixels. Combined with
// DEFAULT_TILE_SIZE, a tile renders at `tileSize * BASE_WORLD_SCALE` CSS px.
//
// This module is the single source of truth for the base scale — the bare `4`
// literal that previously lived in `game_world.ts` / `camera_system.ts` is
// banned. The policy is a named, configurable constant so the framing can be
// restated (and re-baselined) without hunting magic numbers.

/** World units per map tile. Default when a map does not declare a tile size. */
export const DEFAULT_TILE_SIZE = 32;

/**
 * Base world-to-screen scale: each world-space pixel renders as this many
 * CSS pixels. With DEFAULT_TILE_SIZE this renders each tile at 128 CSS px.
 */
export const BASE_WORLD_SCALE = 4;

/** Lower bound for the derived framing scale (never zoom below this). */
export const MIN_WORLD_SCALE = 1;

/** Upper bound for the derived framing scale (never zoom past this). */
export const MAX_WORLD_SCALE = 8;

/** Rendered on-screen size of a DEFAULT_TILE_SIZE tile at base scale (px). */
export const BASE_TILE_SCREEN_SIZE = DEFAULT_TILE_SIZE * BASE_WORLD_SCALE; // 128

/**
 * Default map extents (in tiles) used when a map dimension is missing or
 * reported as zero. Guarantees the camera never clamps against unbounded
 * empty space in a default/transient boot (C-497 AC-2).
 */
export const DEFAULT_MAP_WIDTH_TILES = 100;
export const DEFAULT_MAP_HEIGHT_TILES = 100;

/** Default map extents in world-space pixels (tiles × DEFAULT_TILE_SIZE). */
export const DEFAULT_MAP_WORLD_WIDTH = DEFAULT_MAP_WIDTH_TILES * DEFAULT_TILE_SIZE;
export const DEFAULT_MAP_WORLD_HEIGHT = DEFAULT_MAP_HEIGHT_TILES * DEFAULT_TILE_SIZE;

/** Inputs for the framing-scale policy. */
export type WorldScalePolicyInput = {
  /** Tile size in world units. Defaults to {@link DEFAULT_TILE_SIZE}. */
  tileSize?: number;
  /** Viewport size in CSS pixels. */
  viewport: { width: number; height: number };
  /** Map extent in world-space pixels, when known. */
  mapSize?: { width: number; height: number };
};

/**
 * Derives the base world scale from the named policy for a given tile size
 * and viewport.
 *
 * Without a known map extent it returns {@link BASE_WORLD_SCALE}. When a map
 * extent is provided, it downscales from the base only as far as needed so
 * the whole map fits the viewport (whole-map visibility wins over fill); it
 * never zooms past the base scale, which preserves the pixel-art look and the
 * C-161 dialogue-zoom 1.0–1.5× relationship.
 */
export const computeWorldScale = (input: WorldScalePolicyInput): number => {
  const base = BASE_WORLD_SCALE;
  if (!input.mapSize || input.mapSize.width <= 0 || input.mapSize.height <= 0) {
    return base;
  }
  const fitX = input.viewport.width / input.mapSize.width;
  const fitY = input.viewport.height / input.mapSize.height;
  const fit = Math.min(fitX, fitY);
  return Math.min(base, Math.max(MIN_WORLD_SCALE, fit));
};
