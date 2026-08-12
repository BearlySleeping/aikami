// packages/frontend/engine/src/assets/autotile.ts
//
// Layered corner-16 autotiler (C-378).
//
// The map format carries a semantic terrain-ID channel (`aikami.terrain`).
// This module resolves that channel into tile layers at load time:
//   - the lowest-precedence terrain (the "base") renders as a solid fill
//     over every cell, with optional deterministic variants;
//   - every higher `corner16` terrain renders as its own overlay layer in
//     precedence order, one frame per cell selected by the cell's 4-bit
//     corner mask.
//
// Corner-16 model (Tiled Wang "Corner" sets, Godot TileSet terrain):
// a cell's frame index is a 4-bit mask of which of its four CORNERS belong
// to the terrain being drawn. Each corner's terrain is the
// highest-precedence terrain among the (up to) 4 cells touching it.
// Corners outside the map are treated as the base terrain (documented OOB
// rule — AC-3 watch point).
//
// Bit order is pinned here and in the docs page (AC-10): bit0 = NW,
// bit1 = NE, bit2 = SE, bit3 = SW (clockwise from north-west). Mask 0 =
// "no corners" (fully outside the terrain's corner region), mask 15 =
// "fully inside". Any terrain sheet authored against a different order is
// wrong — this constant is the contract.
//
// The module is PURE — no module-level mutable state, so it is safe to run
// per `loadMap` (idempotency requirement, Quality Requirements).

import type { ContentPackTerrain } from '@aikami/schemas';

// ---------------------------------------------------------------------------
// Corner mask bit order (documented + tested — the atlas sheet contract)
// ---------------------------------------------------------------------------

/**
 * Corner indices for the 4-bit corner mask.
 *
 * bit0 = NW, bit1 = NE, bit2 = SE, bit3 = SW (clockwise from north-west).
 * The mask value is `(1 << index)` summed over the cell's corners.
 *
 * The keys are the four compass directions — fixed domain values, not
 * camelCase identifiers (the naming-convention rule is suppressed per key).
 */
export const TERRAIN_CORNER_BITS = {
  // biome-ignore lint/style/useNamingConvention: compass-direction domain key
  NW: 1 << 0,
  // biome-ignore lint/style/useNamingConvention: compass-direction domain key
  NE: 1 << 1,
  // biome-ignore lint/style/useNamingConvention: compass-direction domain key
  SE: 1 << 2,
  // biome-ignore lint/style/useNamingConvention: compass-direction domain key
  SW: 1 << 3,
} as const;

export type TerrainCorner = keyof typeof TERRAIN_CORNER_BITS;

/** All four corner bit values, in bit order (index 0 = bit0 = NW). */
export const TERRAIN_CORNER_ORDER: readonly TerrainCorner[] = ['NW', 'NE', 'SE', 'SW'];

/** Corner → [dx, dy] cell offset the corner points INTO (NE/SW inverted). */
const CORNER_TOUCH_OFFSETS: Record<TerrainCorner, readonly [number, number]> = {
  // The NW corner of cell (x,y) touches cell (x-1, y-1) at its SE corner.
  // biome-ignore lint/style/useNamingConvention: compass-direction domain key
  NW: [-1, -1],
  // biome-ignore lint/style/useNamingConvention: compass-direction domain key
  NE: [0, -1],
  // biome-ignore lint/style/useNamingConvention: compass-direction domain key
  SE: [0, 0],
  // biome-ignore lint/style/useNamingConvention: compass-direction domain key
  SW: [-1, 0],
};

/** Number of corner-16 masks. */
export const CORNER16_MASK_COUNT = 16;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The resolved terrain grid for one map load.
 *
 * `cells` holds terrain indexes into `terrainIds` (0 = first terrain in
 * pack order, which the pack validation guarantees is the base). The
 * channel is a Uint8Array so a 200×200 map costs 40 KB and resolves in
 * well under the 50 ms budget.
 */
export type ResolvedTerrainGrid = {
  width: number;
  height: number;
  /** Terrain index per cell, into the pack's ordered terrain list. */
  cells: Uint8Array;
  /** Reserved; all zero until cliffs land (C-378 elevation channel). */
  elevation: Int8Array;
  /** Ordered terrain ids, index-aligned with `cells` values. */
  terrainIds: readonly string[];
};

/**
 * A tile layer emitted by the autotiler.
 *
 * `frames` holds a frame NAME per cell (0 = empty), resolved against the
 * pack's atlas by name — never a GID (frames survive atlas regeneration;
 * GIDs do not).
 */
export type TerrainLayerEmission = {
  /** Layer name (e.g. `terrain_grass`). */
  name: string;
  /** Autotiled layers always render in the ground band. */
  band: 'ground';
  /** Frame name per cell, row-major; 0 = empty. */
  frames: Array<string | 0>;
  /** Pack precedence — emission order follows it. */
  precedence: number;
  /** True when this layer is the base fill (covers every cell). */
  isBase: boolean;
};

/** Options for {@link autotileLayers}. */
export type AutotileOptions = {
  width: number;
  height: number;
  /** Terrain id per cell, row-major. `''` = the pack's base terrain. */
  terrain: readonly string[];
  /** Pack terrain definitions, sorted by the caller (or unsorted — this
   *  module sorts by precedence and rejects duplicates). */
  terrains: readonly ContentPackTerrain[];
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Sorts terrains by precedence and validates the layered-corner-16
 * preconditions:
 *   - at least one terrain exists;
 *   - precedence values are unique (duplicates are unresolvable — AC-3);
 *   - exactly one `wang: 'fill'` terrain (the base) exists.
 *
 * Throws a descriptive error so the pack author sees WHY the pack is
 * rejected (schema validation rejects duplicates; this is the runtime
 * backstop for hand-authored fixtures).
 */
export const validateTerrains = (terrains: readonly ContentPackTerrain[]): ContentPackTerrain[] => {
  if (terrains.length === 0) {
    throw new Error('autotile: pack declares no terrains');
  }
  const byPrecedence = [...terrains].sort((a, b) => a.precedence - b.precedence);
  const seen = new Set<number>();
  for (const t of byPrecedence) {
    if (seen.has(t.precedence)) {
      throw new Error(
        `autotile: duplicate terrain precedence ${t.precedence} ("${t.name}") — precedence must be unique`,
      );
    }
    seen.add(t.precedence);
  }
  const fills = byPrecedence.filter((t) => t.wang === 'fill');
  if (fills.length !== 1) {
    throw new Error(`autotile: exactly one 'fill' terrain required (base) — found ${fills.length}`);
  }
  return byPrecedence;
};

// ---------------------------------------------------------------------------
// Grid resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a terrain-ID channel into a {@link ResolvedTerrainGrid}.
 *
 * Unknown terrain ids resolve to the base terrain (index 0) — the failure
 * recovery rule (Migration & Rollback). The caller logs the unknown ids
 * once per map load (this function does not log).
 *
 * @param options - Map dims + raw terrain ids + validated pack terrains.
 * @returns The resolved grid.
 */
export const resolveTerrainGrid = (
  options: Pick<AutotileOptions, 'width' | 'height' | 'terrain'> & {
    terrains: readonly ContentPackTerrain[];
  },
): ResolvedTerrainGrid => {
  const { width, height, terrain, terrains } = options;
  const ordered = validateTerrains(terrains);
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < ordered.length; i++) {
    idToIndex.set(ordered[i].name, i);
  }

  const total = width * height;
  const cells = new Uint8Array(total);
  const elevation = new Int8Array(total);

  for (let i = 0; i < total; i++) {
    const id = terrain[i] ?? '';
    const index = id === '' ? 0 : (idToIndex.get(id) ?? 0); // unknown → base
    cells[i] = index;
  }

  return { width, height, cells, elevation, terrainIds: ordered.map((t) => t.name) };
};

// ---------------------------------------------------------------------------
// Corner mask
// ---------------------------------------------------------------------------

/**
 * Computes the 4-bit corner mask for a cell of terrain `index` in a grid.
 *
 * For each of the four corners, the corner's terrain is the
 * highest-precedence terrain among the up-to-4 cells touching it (OOB
 * cells count as the base terrain). The bit is set when that owner equals
 * the cell's own terrain index.
 *
 * Precedence is encoded in the grid: lower index = lower precedence
 * (index 0 = base). "Highest precedence" = largest index among the
 * touching cells.
 *
 * @param cells - Resolved terrain grid.
 * @param width - Grid width.
 * @param height - Grid height.
 * @param x - Cell X.
 * @param y - Cell Y.
 * @param index - The cell's own terrain index.
 * @returns Mask 0..15.
 */
export const cornerMaskForCell = (
  cells: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  index: number,
): number => {
  let mask = 0;
  for (let b = 0; b < TERRAIN_CORNER_ORDER.length; b++) {
    const corner = TERRAIN_CORNER_ORDER[b];
    const [dx, dy] = CORNER_TOUCH_OFFSETS[corner];
    // Cells touching this corner: the corner at (x+dx, y+dy) touches the
    // 2×2 block starting at (x+dx, y+dy).
    const blockX = x + dx;
    const blockY = y + dy;
    let owner = 0; // base wins ties / OOB
    for (let by = 0; by <= 1; by++) {
      for (let bx = 0; bx <= 1; bx++) {
        const cx = blockX + bx;
        const cy = blockY + by;
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) {
          continue; // OOB → base terrain (index 0)
        }
        const cellIndex = cells[cy * width + cx];
        if (cellIndex > owner) {
          owner = cellIndex;
        }
      }
    }
    if (owner === index) {
      mask |= TERRAIN_CORNER_BITS[corner];
    }
  }
  return mask;
};

// ---------------------------------------------------------------------------
// Frame naming
// ---------------------------------------------------------------------------

/**
 * Derives the atlas frame name for a corner-16 mask from the terrain's
 * `frameBase` (mask 0's frame name).
 *
 * Convention: `frameBase` = mask 0; masks 1..15 derive as
 * `${stem}_${mask}${ext}`. A trailing `_0` in the stem (e.g. `dirt_0.png`)
 * is stripped first so `dirt_0.png` → `dirt_1.png` … `dirt_15.png`.
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
 * Deterministically picks a fill variant for a cell.
 *
 * Uses a tiny integer hash of (x, y) — no RNG state, so repeated calls
 * with the same coordinates pick the same frame (idempotency + determinism).
 */
export const pickFillVariant = (
  variants: readonly string[],
  frameBase: string,
  x: number,
  y: number,
): string => {
  if (variants.length === 0) {
    return frameBase;
  }
  // Knuth multiplicative hash of the cell coordinate.
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  const index = Math.abs(h) % (variants.length + 1);
  return index === 0 ? frameBase : variants[index - 1];
};

// ---------------------------------------------------------------------------
// Layer emission
// ---------------------------------------------------------------------------

/**
 * Runs the layered corner-16 autotiler over a terrain channel.
 *
 * Emits one layer per terrain in precedence order:
 *   - the base (lowest precedence, `wang: 'fill'`) covers EVERY cell with
 *     its fill frame (variant chosen deterministically);
 *   - every higher `corner16` terrain emits an overlay layer covering only
 *     its own cells, frame = the cell's corner mask (0..15).
 *
 * The returned layers are ordered by precedence (base first) so the caller
 * renders them bottom-to-top. This is the "layered precedence" model — an
 * N-terrain map needs N layers and N×16 frames, never N²×16.
 *
 * @param options - Map dims + terrain channel + pack terrains.
 * @returns Emitted layers (never empty — the base layer always emits).
 */
export const autotileLayers = (options: AutotileOptions): TerrainLayerEmission[] => {
  const { width, height, terrain, terrains } = options;
  const ordered = validateTerrains(terrains);
  const grid = resolveTerrainGrid({ width, height, terrain, terrains: ordered });
  const { cells } = grid;
  const total = width * height;

  const base = ordered[0];
  if (base.wang !== 'fill') {
    // validateTerrains guarantees exactly one fill and it is the lowest
    // precedence (sort above) — this is a defensive assertion.
    throw new Error(`autotile: base terrain "${base.name}" must be 'fill'`);
  }

  const emissions: TerrainLayerEmission[] = [];

  // Base fill layer — every cell gets the base frame (or a deterministic
  // variant). This is the underlay for every overlay.
  {
    const frames: Array<string | 0> = new Array<string | 0>(total).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        frames[y * width + x] = pickFillVariant(base.variants ?? [], base.frameBase, x, y);
      }
    }
    emissions.push({
      name: `terrain_${base.name}`,
      band: 'ground',
      frames,
      precedence: base.precedence,
      isBase: true,
    });
  }

  // Overlay layers — one per corner16 terrain above the base.
  for (let t = 1; t < ordered.length; t++) {
    const terrainDef = ordered[t];
    if (terrainDef.wang !== 'corner16') {
      // 'fill' terrains above the base are legal but have no transitions —
      // emit them as plain fill overlays (frameBase everywhere).
      const frames: Array<string | 0> = new Array<string | 0>(total).fill(0);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (cells[y * width + x] === t) {
            frames[y * width + x] = pickFillVariant(
              terrainDef.variants ?? [],
              terrainDef.frameBase,
              x,
              y,
            );
          } else {
            frames[y * width + x] = 0;
          }
        }
      }
      emissions.push({
        name: `terrain_${terrainDef.name}`,
        band: 'ground',
        frames,
        precedence: terrainDef.precedence,
        isBase: false,
      });
      continue;
    }

    const frames: Array<string | 0> = new Array<string | 0>(total).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cellIndex = y * width + x;
        if (cells[cellIndex] !== t) {
          continue; // not this terrain — empty in this overlay
        }
        const mask = cornerMaskForCell(cells, width, height, x, y, t);
        frames[cellIndex] = cornerFrameName(terrainDef.frameBase, mask);
      }
    }
    emissions.push({
      name: `terrain_${terrainDef.name}`,
      band: 'ground',
      frames,
      precedence: terrainDef.precedence,
      isBase: false,
    });
  }

  return emissions;
};
