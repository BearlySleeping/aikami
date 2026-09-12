// scripts/src/lib/ops/prop_atlas_packer.ts
//
// Irregular prop-atlas packer.
//
// Terrain lives in a fixed 32×32 grid atlas, where every cell is a tile and
// map GIDs index it by `row * columns + col`. Oversized transparent props
// cannot live there: a 192×152 ward tree or a 256×224 inn is not a tile cell,
// and per-cell edge extrusion would draw seams through a sprite spanning
// cells. This module packs approved prop artwork into one or more irregular
// pages instead.
//
// Contract:
//   - Frames keep their **stable logical names** (e.g. `ward_large.png`).
//     Page index and atlas coordinates are build output, never identity, so
//     the packer can add a page without touching a prop definition, a map or
//     a save file.
//   - Every frame is packed with a 1px extruded border (edge pixels
//     duplicated outward) so linear sampling at a sprite edge can never pull
//     in a neighbouring frame or transparent black.
//   - Pages never exceed the texture-size budget; a frame too large for one
//     page is a hard error rather than a silent clip.
//   - Frame names are unique across the whole pack — duplicates are rejected
//     here, and again at runtime by the frame resolver.
//
// Packing is deterministic: frames are sorted by descending height (then
// descending width, then name) and shelf-packed. Identical input always
// produces byte-identical pages, so a rebuild cannot churn the artifact hash.

import { findDuplicateAtlasFrames } from '@aikami/utils';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One source frame to pack: a stable logical name plus its encoded image. */
export type PropAtlasSource = {
  /** Stable logical frame name, e.g. `ward_large.png`. */
  name: string;
  /** Encoded image bytes (PNG/WebP, single frame, alpha expected). */
  bytes: Uint8Array;
};

/** A packed page: the texture bytes plus its spritesheet JSON. */
export type PropAtlasPage = {
  /** 0-based page index — build output, never referenced by prop definitions. */
  index: number;
  /** Encoded page texture (lossless WebP). */
  image: Uint8Array;
  /** TexturePacker-compatible spritesheet document. */
  spritesheet: PropAtlasSpritesheet;
  /** Pixel dimensions of the page texture. */
  width: number;
  height: number;
  /** Frame names on this page, in packed order. */
  frames: string[];
};

/** TexturePacker-compatible frame entry (the shape PixiJS `Spritesheet` parses). */
export type PropAtlasFrame = {
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
};

/** TexturePacker-compatible spritesheet document. */
export type PropAtlasSpritesheet = {
  frames: Record<string, PropAtlasFrame>;
  meta: {
    app: string;
    version: string;
    image: string;
    format: string;
    size: { w: number; h: number };
    scale: string;
  };
};

/** Options for {@link packPropAtlas}. */
export type PackPropAtlasOptions = {
  /** Source frames to pack. */
  sources: readonly PropAtlasSource[];
  /** Page texture name used in each spritesheet's `meta.image`. */
  pageImageName?: string;
  /** `meta.app` label. */
  appLabel?: string;
  /** Maximum page width/height in pixels. Default 2048. */
  maxPageSize?: number;
  /** Extrusion border around each frame, in pixels. Default 1. */
  padding?: number;
  /** Encoder for the page texture. Defaults to lossless WebP. */
  encodePage?: (raw: PropAtlasRawImage) => Promise<Uint8Array>;
};

/** Decoded RGBA image handed to the page encoder. */
export type PropAtlasRawImage = {
  data: Uint8Array;
  width: number;
  height: number;
  channels: 4;
};

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PAGE_SIZE = 2048;
const DEFAULT_PADDING = 1;

/** Deterministic pack order: tallest first, then widest, then name. */
const _packOrder = (a: { width: number; height: number; name: string }, b: typeof a): number => {
  if (b.height !== a.height) {
    return b.height - a.height;
  }
  if (b.width !== a.width) {
    return b.width - a.width;
  }
  return a.name.localeCompare(b.name);
};

/**
 * Packs prop frames into irregular atlas pages.
 *
 * @param options - Sources plus page budget and encoder.
 * @returns One or more packed pages, in page order.
 * @throws When two sources share a frame name, or a frame cannot fit a page.
 */
export const packPropAtlas = async (options: PackPropAtlasOptions): Promise<PropAtlasPage[]> => {
  const maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const padding = options.padding ?? DEFAULT_PADDING;

  // Padding is the extrusion border. Zero would place content flush against
  // the neighbouring frame (and write its first extrusion column into that
  // neighbour), and a fractional/negative value has no meaning.
  if (!Number.isInteger(padding) || padding < 1) {
    throw new Error(
      `prop-atlas: padding must be a positive integer (got ${String(options.padding)})`,
    );
  }
  const pageImageName = options.pageImageName ?? 'props.webp';
  const appLabel = options.appLabel ?? 'aikami-prop-atlas';

  // Duplicate frame names are a hard error: the resolver indexes frames by
  // name, so a duplicate would make lookup precedence ambiguous.
  const seen = new Set<string>();
  for (const source of options.sources) {
    if (seen.has(source.name)) {
      throw new Error(
        `prop-atlas: duplicate frame name "${source.name}" — frame names must be unique across the pack`,
      );
    }
    seen.add(source.name);
  }

  const sharp = await _loadSharp();
  const decode = async (source: PropAtlasSource) => {
    const { data, info } = await sharp(source.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      name: source.name,
      width: info.width,
      height: info.height,
      data: new Uint8Array(data),
    };
  };

  const decoded = await Promise.all(options.sources.map((source) => decode(source)));
  const ordered = [...decoded].sort(_packOrder);

  const encodePage =
    options.encodePage ??
    (async (raw: PropAtlasRawImage) =>
      new Uint8Array(
        await sharp(Buffer.from(raw.data), {
          raw: { width: raw.width, height: raw.height, channels: 4 },
        })
          .webp({ lossless: true, effort: 6 })
          .toBuffer(),
      ));

  // Shelf packing: fill a row left-to-right, then start the next row below.
  // Cells carry the extrusion border, so the content sits at (cellX + pad).
  type Placed = { name: string; width: number; height: number; cellX: number; cellY: number };
  const pages: PropAtlasPage[] = [];
  let current: Placed[] = [];
  let pageWidth = 0;
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  const flush = async () => {
    if (current.length === 0) {
      return;
    }
    const height = cursorY + rowHeight;
    const width = pageWidth;
    const raw = new Uint8Array(width * height * 4);

    for (const placed of current) {
      const source = ordered.find((item) => item.name === placed.name);
      if (!source) {
        continue;
      }
      const destX = placed.cellX + padding;
      const destY = placed.cellY + padding;

      // Blit the frame content.
      for (let y = 0; y < source.height; y++) {
        const from = y * source.width * 4;
        const to = ((destY + y) * width + destX) * 4;
        raw.set(source.data.subarray(from, from + source.width * 4), to);
      }

      // Extrude the frame edge outward into EVERY border layer so linear
      // sampling at the sprite edge cannot pull in a neighbour or transparent
      // black. Each layer replicates the frame's outermost pixel (constant
      // extension), which is what keeps a multi-pixel border consistent.
      for (let depth = 1; depth <= padding; depth++) {
        for (let y = 0; y < source.height; y++) {
          const rowStart = (destY + y) * width * 4;
          const left = raw.subarray(rowStart + destX * 4, rowStart + destX * 4 + 4);
          const right = raw.subarray(
            rowStart + (destX + source.width - 1) * 4,
            rowStart + (destX + source.width - 1) * 4 + 4,
          );
          raw.set(left, rowStart + (destX - depth) * 4);
          raw.set(right, rowStart + (destX + source.width - 1 + depth) * 4);
        }
        const topRow = destY * width + destX;
        const bottomRow = (destY + source.height - 1) * width + destX;
        for (let x = -depth; x <= source.width - 1 + depth; x++) {
          const px = Math.min(Math.max(x, 0), source.width - 1);
          const top = raw.subarray((topRow + px) * 4, (topRow + px) * 4 + 4);
          const bottom = raw.subarray((bottomRow + px) * 4, (bottomRow + px) * 4 + 4);
          raw.set(top, ((destY - depth) * width + destX + x) * 4);
          raw.set(bottom, ((destY + source.height - 1 + depth) * width + destX + x) * 4);
        }
      }
    }

    const frames: Record<string, PropAtlasFrame> = {};
    for (const placed of current) {
      frames[placed.name] = {
        frame: {
          x: placed.cellX + padding,
          y: placed.cellY + padding,
          w: placed.width,
          h: placed.height,
        },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: placed.width, h: placed.height },
        sourceSize: { w: placed.width, h: placed.height },
      };
    }

    const index = pages.length;
    pages.push({
      index,
      image: await encodePage({ data: raw, width, height, channels: 4 }),
      spritesheet: {
        frames,
        meta: {
          app: appLabel,
          version: '1.0',
          image: pageImageName,
          format: 'RGBA8888',
          size: { w: width, h: height },
          scale: '1',
        },
      },
      width,
      height,
      frames: current.map((placed) => placed.name),
    });

    logger.debug('propAtlasPacker:page-packed', {
      page: index,
      width,
      height,
      frames: current.length,
    });

    current = [];
    pageWidth = 0;
    cursorX = 0;
    cursorY = 0;
    rowHeight = 0;
  };

  for (const item of ordered) {
    const cellW = item.width + padding * 2;
    const cellH = item.height + padding * 2;

    if (cellW > maxPageSize || cellH > maxPageSize) {
      throw new Error(
        `prop-atlas: frame "${item.name}" (${item.width}×${item.height}) exceeds the ${maxPageSize}px page budget — split it or raise maxPageSize`,
      );
    }

    // Start a new row when the frame does not fit the current one.
    if (cursorX + cellW > maxPageSize) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    // Start a new page when the row would run past the page height.
    if (cursorY + cellH > maxPageSize) {
      await flush();
    }

    current.push({
      name: item.name,
      width: item.width,
      height: item.height,
      cellX: cursorX,
      cellY: cursorY,
    });
    cursorX += cellW;
    if (cursorX > pageWidth) {
      pageWidth = cursorX;
    }
    if (cellH > rowHeight) {
      rowHeight = cellH;
    }
  }
  await flush();

  if (pages.length === 0) {
    throw new Error('prop-atlas: no frames to pack');
  }

  return pages;
};

/**
 * Collects duplicate frame names across every atlas source.
 *
 * The grid atlas and every prop-atlas page share one flat frame namespace at
 * runtime, so a name appearing in two sources would make lookup precedence
 * ambiguous. Validation rejects it rather than picking a winner.
 *
 * Thin re-export of the shared helper so the build-time packer gate and the
 * runtime resolver cannot disagree about what counts as a duplicate.
 *
 * @param sources - `{ label, frames }` per atlas source.
 * @returns One entry per duplicated name, naming every source that declares it.
 */
export const findDuplicateFrameNames = findDuplicateAtlasFrames;

// ---------------------------------------------------------------------------
// Sharp surface
// ---------------------------------------------------------------------------

/**
 * The slice of the sharp API this packer uses.
 *
 * Declared structurally instead of importing sharp's own types: sharp is a
 * build-time-only dependency resolved from the repository root, and its
 * `dist` type entry point resolves to a module namespace with no call
 * signature. Declaring the surface keeps the dependency out of the type
 * graph and documents exactly what the packer relies on.
 */
type SharpPipeline = {
  ensureAlpha(): SharpPipeline;
  raw(): SharpPipeline;
  webp(options?: { lossless?: boolean; effort?: number }): SharpPipeline;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Buffer;
    info: { width: number; height: number; channels: number };
  }>;
  toBuffer(): Promise<Buffer>;
};

type SharpFactory = (input?: unknown, options?: unknown) => SharpPipeline;

/** Lazily resolves sharp — the packer is only run from build tooling. */
const _loadSharp = async (): Promise<SharpFactory> => {
  const { createRequire } = await import('node:module');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const require = createRequire(join(here, '../../../package.json'));
  return require('sharp') as SharpFactory;
};
