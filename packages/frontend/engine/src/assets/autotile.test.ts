// packages/frontend/engine/src/assets/autotile.test.ts
//
// C-378 AC-3 — layered corner-16 autotiling resolves edges and three-way
// junctions.
//
// Table-driven over all 16 corner masks per terrain, plus the 3-terrain
// junction fixture. Also pins the OOB rule (map-edge corners treat OOB as
// the base terrain) and the mask bit order (bit0=NW, bit1=NE, bit2=SE,
// bit3=SW).

import { describe, expect, test } from 'bun:test';
import type { ContentPackTerrain } from '@aikami/schemas';
import {
  autotileLayers,
  CORNER16_MASK_COUNT,
  cornerFrameName,
  cornerMaskForCell,
  pickFillVariant,
  resolveTerrainGrid,
  TERRAIN_CORNER_BITS,
  validateTerrains,
} from './autotile.ts';

// ---------------------------------------------------------------------------
// Fixture terrains (mirror the emberwatch pack shape)
// ---------------------------------------------------------------------------

const GRASS: ContentPackTerrain = {
  name: 'grass',
  precedence: 0,
  wang: 'fill',
  frameBase: 'grass.png',
  isWalkable: true,
};

const DIRT: ContentPackTerrain = {
  name: 'dirt',
  precedence: 1,
  wang: 'corner16',
  frameBase: 'dirt_0.png',
  isWalkable: true,
};

const WATER: ContentPackTerrain = {
  name: 'water',
  precedence: 2,
  wang: 'corner16',
  frameBase: 'water_0.png',
  isWalkable: false,
};

const TERRAINS = [GRASS, DIRT, WATER] as const;

// ---------------------------------------------------------------------------
// AC-3: table-driven corner masks
// ---------------------------------------------------------------------------

/**
 * Builds an N×N grid where every cell is the base terrain except the
 * center cell, which is `index`. The 8 neighbors are set to the corner
 * "owners" from `owners` (a 3×3 map keyed `"dx,dy"` → terrain index).
 */
const maskGrid = (
  size: number,
  index: number,
  owners: Record<string, number>,
): { cells: Uint8Array; width: number; height: number } => {
  const cells = new Uint8Array(size * size);
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);
  cells[cy * size + cx] = index;
  for (const [key, owner] of Object.entries(owners)) {
    const [dx, dy] = key.split(',').map(Number);
    const x = cx + dx;
    const y = cy + dy;
    if (x >= 0 && x < size && y >= 0 && y < size) {
      cells[y * size + x] = owner;
    }
  }
  return { cells, width: size, height: size };
};

describe('cornerMaskForCell — all 16 masks (AC-3)', () => {
  // A 3×3 grid: center = dirt (1), neighbors arranged to produce every mask.
  // Mask bits: bit0=NW, bit1=NE, bit2=SE, bit3=SW.
  const cases: Array<{ name: string; owners: Record<string, number>; expected: number }> = [
    // All neighbors grass (0) → all 4 corners owned by dirt → 0b1111
    { name: 'mask 15 — fully inside', owners: {}, expected: 0b1111 },
    // NW corner owned by water (2) → NW bit clear
    {
      name: 'mask 14 — NW corner cut',
      owners: { '-1,-1': 2 },
      expected: 0b1110,
    },
    {
      name: 'mask 13 — NE corner cut',
      owners: { '1,-1': 2 },
      expected: 0b1101,
    },
    {
      name: 'mask 11 — SE corner cut',
      owners: { '1,1': 2 },
      expected: 0b1011,
    },
    {
      name: 'mask 7 — SW corner cut',
      owners: { '-1,1': 2 },
      expected: 0b0111,
    },
    // Two adjacent corners cut
    {
      name: 'mask 12 — NW+NE cut (north edge)',
      owners: { '-1,-1': 2, '1,-1': 2 },
      expected: 0b1100,
    },
    // Two opposite corners cut
    {
      name: 'mask 10 — NW+SE cut (diagonal)',
      owners: { '-1,-1': 2, '1,1': 2 },
      expected: 0b1010,
    },
    // Three corners cut
    {
      name: 'mask 4 — only SE owned by dirt',
      owners: { '-1,-1': 2, '1,-1': 2, '-1,1': 2 },
      expected: 0b0100,
    },
    // Single corner owned by dirt (the remaining seven masks)
    {
      name: 'mask 1 — only NW owned by dirt',
      owners: { '1,-1': 2, '1,1': 2, '-1,1': 2 },
      expected: 0b0001,
    },
    {
      name: 'mask 2 — only NE owned by dirt',
      owners: { '-1,-1': 2, '1,1': 2, '-1,1': 2 },
      expected: 0b0010,
    },
    {
      name: 'mask 3 — NW+NE owned by dirt (north edge)',
      owners: { '1,1': 2, '-1,1': 2 },
      expected: 0b0011,
    },
    {
      name: 'mask 5 — NW+SE owned by dirt (diagonal)',
      owners: { '1,-1': 2, '-1,1': 2 },
      expected: 0b0101,
    },
    {
      name: 'mask 6 — NE+SE owned by dirt (east edge)',
      owners: { '-1,-1': 2, '-1,1': 2 },
      expected: 0b0110,
    },
    {
      name: 'mask 8 — only SW owned by dirt',
      owners: { '-1,-1': 2, '1,-1': 2, '1,1': 2 },
      expected: 0b1000,
    },
    {
      name: 'mask 9 — NW+SW owned by dirt (west edge)',
      owners: { '1,-1': 2, '1,1': 2 },
      expected: 0b1001,
    },
    // All corners owned by water → mask 0 ("no corners")
    {
      name: 'mask 0 — fully enclosed by higher terrain',
      owners: { '-1,-1': 2, '1,-1': 2, '1,1': 2, '-1,1': 2 },
      expected: 0b0000,
    },
  ];

  // The table above covers all 16 masks (15, 14, 13, 11, 7, 12, 10, 4, 1, 2,
  // 3, 5, 6, 8, 9, 0) — every bit pattern is exercised.

  for (const c of cases) {
    test(`cornerMaskForCell → ${c.name}`, () => {
      const { cells, width, height } = maskGrid(3, 1, c.owners);
      expect(cornerMaskForCell(cells, width, height, 1, 1, 1)).toBe(c.expected);
    });
  }

  test('map-edge corners treat OOB as the base terrain (documented rule)', () => {
    // A 2×2 grid, all dirt (index 1). Cell (0,0) touches 3 OOB corners.
    // Its corners: NW touches 3 OOB (base=0) + cell itself (1). The corner
    // owner is max(0, 1) = 1 = dirt → NW bit set. NE touches cell (1,0)
    // (dirt) + 2 OOB → owner dirt → bit set. SW touches cell (0,1) (dirt)
    // → bit set. SE touches (0,0),(1,0),(0,1),(1,1) all dirt → bit set.
    // So mask 15 even at the map corner — OOB cells never cut the edge.
    const cells = new Uint8Array([1, 1, 1, 1]);
    expect(cornerMaskForCell(cells, 2, 2, 0, 0, 1)).toBe(0b1111);
  });

  test('bit order is pinned: bit0=NW, bit1=NE, bit2=SE, bit3=SW', () => {
    expect(TERRAIN_CORNER_BITS.NW).toBe(1);
    expect(TERRAIN_CORNER_BITS.NE).toBe(2);
    expect(TERRAIN_CORNER_BITS.SE).toBe(4);
    expect(TERRAIN_CORNER_BITS.SW).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// AC-3: layered emission + junction fixture
// ---------------------------------------------------------------------------

describe('autotileLayers — layered precedence emission (AC-3)', () => {
  test('emits base fill first, then overlays in precedence order', () => {
    const layers = autotileLayers({
      width: 2,
      height: 2,
      terrain: ['grass', 'grass', 'grass', 'dirt'],
      terrains: TERRAINS,
    });

    expect(layers.length).toBe(3);
    expect(layers[0].name).toBe('terrain_grass');
    expect(layers[0].isBase).toBe(true);
    expect(layers[1].name).toBe('terrain_dirt');
    expect(layers[2].name).toBe('terrain_water');
    expect(layers[0].precedence).toBeLessThan(layers[1].precedence);
    expect(layers[1].precedence).toBeLessThan(layers[2].precedence);
  });

  test('base fill covers every cell with a frame (no holes)', () => {
    const layers = autotileLayers({
      width: 3,
      height: 3,
      terrain: ['grass', 'grass', 'grass', 'grass', 'dirt', 'grass', 'grass', 'grass', 'grass'],
      terrains: TERRAINS,
    });
    const base = layers[0];
    expect(base.frames.every((f) => typeof f === 'string')).toBe(true);
  });

  test('dirt overlay emits only dirt cells, each with its corner mask frame', () => {
    // 3×3: center dirt, everything else grass. Center's corners all owned
    // by dirt (no higher terrain) → mask 15 → dirt_15.png.
    const layers = autotileLayers({
      width: 3,
      height: 3,
      terrain: ['grass', 'grass', 'grass', 'grass', 'dirt', 'grass', 'grass', 'grass', 'grass'],
      terrains: TERRAINS,
    });
    const dirtLayer = layers.find((l) => l.name === 'terrain_dirt');
    expect(dirtLayer).toBeDefined();
    if (!dirtLayer) {
      return;
    }
    const center = dirtLayer.frames[4];
    expect(center).toBe('dirt_15.png');
    expect(dirtLayer.frames[0]).toBe(0); // grass cell — empty in dirt overlay
    expect(dirtLayer.frames[1]).toBe(0);
  });

  test('three-terrain junction — the overlay masks at the junction cell', () => {
    // 3×3 grid:
    //   grass grass grass
    //   grass dirt  water
    //   grass grass grass
    // The dirt cell (1,1) has a water cell directly east at (2,1). The
    // water touches the dirt cell's NE and SE corners (both corner blocks
    // include (2,1)) → NE + SE bits clear → dirt mask 0b1001 = 9 →
    // dirt_9.png. The water cell (2,1) has all corners owned by water
    // (nothing higher) → mask 15 → water_15.png.
    const layers = autotileLayers({
      width: 3,
      height: 3,
      terrain: ['grass', 'grass', 'grass', 'grass', 'dirt', 'water', 'grass', 'grass', 'grass'],
      terrains: TERRAINS,
    });

    const dirtLayer = layers.find((l) => l.name === 'terrain_dirt');
    const waterLayer = layers.find((l) => l.name === 'terrain_water');
    expect(dirtLayer).toBeDefined();
    expect(waterLayer).toBeDefined();
    if (!dirtLayer || !waterLayer) {
      return;
    }

    expect(dirtLayer.frames[4]).toBe('dirt_9.png');
    expect(waterLayer.frames[5]).toBe('water_15.png');
  });

  test('cornerFrameName derives masks 1..15 from frameBase', () => {
    expect(cornerFrameName('dirt_0.png', 0)).toBe('dirt_0.png');
    expect(cornerFrameName('dirt_0.png', 1)).toBe('dirt_1.png');
    expect(cornerFrameName('dirt_0.png', 15)).toBe('dirt_15.png');
    expect(cornerFrameName('water.png', 3)).toBe('water_3.png');
  });

  test('pickFillVariant is deterministic, pinned, and selects variants when present', () => {
    // No variants → always the frameBase (fallback).
    expect(pickFillVariant([], 'grass.png', 3, 7)).toBe('grass.png');
    const variants = ['grass_variant.png', 'grass_dark.png'];
    // Pinned expectation for (3, 7): the Knuth cell hash picks the FIRST
    // variant — a real value, not a self-comparison that always passes.
    expect(pickFillVariant(variants, 'grass.png', 3, 7)).toBe('grass_variant.png');
    // Coordinates that select the SECOND variant (not the frameBase), proving
    // the variant branch is reached rather than always falling back.
    expect(pickFillVariant(variants, 'grass.png', 2, 5)).toBe('grass_dark.png');
  });
});

// ---------------------------------------------------------------------------
// Grid resolution + validation
// ---------------------------------------------------------------------------

describe('resolveTerrainGrid + validateTerrains', () => {
  test('unknown terrain ids resolve to the base (failure recovery)', () => {
    const grid = resolveTerrainGrid({
      width: 2,
      height: 1,
      terrain: ['grass', 'not_a_terrain'],
      terrains: TERRAINS,
    });
    expect(grid.cells[0]).toBe(0);
    expect(grid.cells[1]).toBe(0);
    expect(grid.terrainIds).toEqual(['grass', 'dirt', 'water']);
  });

  test('empty string resolves to the base terrain', () => {
    const grid = resolveTerrainGrid({
      width: 2,
      height: 1,
      terrain: ['', 'dirt'],
      terrains: TERRAINS,
    });
    expect(grid.cells[0]).toBe(0);
    expect(grid.cells[1]).toBe(1);
  });

  test('rejects duplicate precedence values', () => {
    expect(() => validateTerrains([GRASS, { ...DIRT, precedence: 0 }])).toThrow(
      /duplicate terrain precedence/,
    );
  });

  test('rejects a pack with no fill terrain', () => {
    expect(() =>
      validateTerrains([
        { ...DIRT, precedence: 0, wang: 'corner16' },
        { ...WATER, precedence: 1 },
      ]),
    ).toThrow(/exactly one 'fill' terrain/);
  });

  test('rejects an empty terrains list', () => {
    expect(() => validateTerrains([])).toThrow(/declares no terrains/);
  });

  test('CORNER16_MASK_COUNT is 16', () => {
    expect(CORNER16_MASK_COUNT).toBe(16);
  });
});
