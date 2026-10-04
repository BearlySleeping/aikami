// packages/frontend/engine/src/rendering/lpc_sheet.ts
//
// "Turn this base texture plus this layout into a parsed LPC spritesheet."
//
// Split out of the texture cache because the two questions are different: the
// cache owns LIFETIMES (leases, eviction, teardown), this owns IDENTITY and
// GEOMETRY. Getting identity wrong is what let one sheet answer another's
// frame lookups, so it is stated in one place and tested directly.

import { Spritesheet, type Texture } from 'pixi.js';
import type { LpcSpritesheetLayout } from './texture_manager.ts';

// ---------------------------------------------------------------------------
// LPC Atlas Data — dynamically generated Spritesheet JSON descriptor
// ---------------------------------------------------------------------------

/**
 * JSON atlas data format for PixiJS `Spritesheet` construction.
 *
 * Each entry in `frames` maps a string key (e.g. `'idle_down'`, `'walk_0'`)
 * to a frame rectangle within the base texture. The `meta` block carries
 * the image identifier (used for cache keying) and atlas format metadata.
 *
 * Generated procedurally by {@link generateLpcAtlas} from a grid layout
 * rather than hardcoded — the LPC spritesheet grid is fully regular.
 */
export type LpcAtlasData = {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: {
    image: string;
    format: string;
    size: { w: number; h: number };
    scale: number;
  };
};

/**
 * Generates a PixiJS-compatible {@link LpcAtlasData} JSON descriptor
 * for a procedurally gridded LPC spritesheet.
 *
 * Since LPC spritesheets follow a strict regular grid (e.g. 9 columns ×
 * 4 rows of 64×64 px frames for a walk sheet), the atlas is generated
 * algorithmically rather than hand-authored. Each frame is labelled by
 * `{keyPrefix}_{row}_{col}` (e.g. `"walk_0_0"` through `"walk_3_8"`).
 *
 * The `image` field in `meta` is set to the provided `cacheKey` so
 * downstream consumers (Spritesheet cache, debug overlays) can identify
 * the source asset without re-deriving the URL.
 *
 * @param options - Atlas generation options.
 * @param options.layout - Grid layout descriptor.
 * @param options.imageKey - String key for the `meta.image` field
 *   (used as the spritesheet cache key — typically the asset URL).
 * @returns A populated {@link LpcAtlasData} ready for
 *   `new Spritesheet(baseTexture, atlasData)`.
 */
export const generateLpcAtlas = (options: {
  layout: LpcSpritesheetLayout;
  imageKey: string;
}): LpcAtlasData => {
  const { layout, imageKey } = options;
  const { frameWidth, frameHeight } = layout;

  const columns = layout.columns ?? Math.floor(layout.rows ? layout.rows : 1);
  // Derive rows from frameHeight and known sheet height, or use layout.rows
  // Callers must provide at least `columns` or `rows` — validated upstream.
  const rows = layout.rows ?? 1;
  const totalWidth = columns * frameWidth;
  const totalHeight = rows * frameHeight;
  const keyPrefix = layout.keyPrefix ?? 'frame';

  const frames: LpcAtlasData['frames'] = {};

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const key = `${keyPrefix}_${row}_${col}`;
      frames[key] = {
        frame: {
          x: col * frameWidth,
          y: row * frameHeight,
          w: frameWidth,
          h: frameHeight,
        },
      };
    }
  }

  return {
    frames,
    meta: {
      image: imageKey,
      format: 'RGBA8888',
      size: { w: totalWidth, h: totalHeight },
      scale: 1,
    },
  };
};

/**
 * Builds the cache key of a parsed sheet.
 *
 * Every field that changes the PARSED RESULT must be in the key, not just the
 * URL and the grid shape. Two callers can legitimately pass the same URL with
 * different cell sizes, different grid shapes, or a different frame-label
 * prefix — and `keyPrefix` alone changes every frame label the per-frame path
 * looks up (`walk_2_0` vs `idle_2_0`). Collapsing them would serve one caller
 * a sheet whose frames do not exist. The base texture's `uid` separates two
 * distinct textures that share a URL.
 */
export const buildSheetKey = (options: {
  baseTexture: Texture;
  layout: LpcSpritesheetLayout;
  cacheKey: string;
}): string => {
  const { baseTexture, layout, cacheKey } = options;
  const columns = layout.columns ?? Math.floor(baseTexture.width / layout.frameWidth);
  const rows = layout.rows ?? Math.floor(baseTexture.height / layout.frameHeight);
  return [
    cacheKey,
    `c${columns}`,
    `r${rows}`,
    `w${layout.frameWidth}`,
    `h${layout.frameHeight}`,
    `p${layout.keyPrefix ?? 'frame'}`,
    `t${baseTexture.uid}`,
  ].join('::');
};

/** Builds and parses the sheet described by `options`. */
export const createSheet = async (options: {
  baseTexture: Texture;
  layout: LpcSpritesheetLayout;
  cacheKey: string;
}): Promise<Spritesheet> => {
  const { baseTexture, layout, cacheKey } = options;
  const columns = layout.columns ?? Math.floor(baseTexture.width / layout.frameWidth);
  const rows = layout.rows ?? Math.floor(baseTexture.height / layout.frameHeight);

  const spritesheet = new Spritesheet(
    baseTexture,
    generateLpcAtlas({ layout: { ...layout, columns, rows }, imageKey: cacheKey }),
  );
  await spritesheet.parse();
  return spritesheet;
};

/**
 * Builds the cache key of a parsed sheet.
 *
 * Every field that changes the PARSED RESULT must be in the key, not just the
 * URL and the grid shape. Two callers can legitimately pass the same URL with
 * different cell sizes, different grid shapes, or a different frame-label
 * prefix — and `keyPrefix` alone changes every frame label the per-frame path
 * looks up (`walk_2_0` vs `idle_2_0`). Collapsing them would serve one caller
 * a sheet whose frames do not exist. The base texture's `uid` separates two
 * distinct textures that share a URL.
 */
