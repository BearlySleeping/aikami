// scripts/src/lib/ops/generate_emberwatch_derivation.test.ts
//
// C-376 AC-6 D5 — generator GID tables derive from manifest.tiles.
//
// The map generator's G table and the atlas generator's FRAMES table must
// match the committed manifest.tiles exactly (single GID↔frame source).
// This guards against hand-declared drift — if a manifest tile is renamed
// or a GID is remapped, this test fails before the generators can emit
// mismatched maps/atlases.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATLAS_COLS,
  buildFrames,
  buildG,
  cornerFrameName,
  readManifestTerrains,
  readManifestTiles,
  resetManifestTilesCache,
  setManifestTilesForTest,
} from './generate_emberwatch_tables.ts';

const REPO_ROOT = join(import.meta.dir, '../../../..');
const MANIFEST_PATH = join(
  REPO_ROOT,
  'apps/frontend/client/static/content-packs/emberwatch/manifest.json',
);

/** Reads the committed emberwatch manifest tiles. */
const readManifestTilesFromDisk = (): Record<string, { name?: string; frame?: string }> => {
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
    tiles?: Record<string, { name?: string; frame?: string }>;
  };
  return raw.tiles ?? {};
};

describe('generate_emberwatch G/FRAMES derivation (C-376 AC-6)', () => {
  test('G semantic keys resolve to the manifest GIDs', () => {
    const g = buildG();
    const tiles = readManifestTilesFromDisk();

    // Spot-check the alias table against the manifest.
    expect(g.GRASS).toBe(Number(Object.keys(tiles).find((gid) => tiles[gid]?.name === 'grass')));
    expect(g.PATH).toBe(
      Number(Object.keys(tiles).find((gid) => tiles[gid]?.name === 'path_tough')),
    );
    expect(g.GATE).toBe(
      Number(Object.keys(tiles).find((gid) => tiles[gid]?.name === 'village_gate')),
    );
    expect(g.DOOR).toBe(Number(Object.keys(tiles).find((gid) => tiles[gid]?.name === 'wood_door')));

    // Every G value must be a declared manifest tile GID.
    const declaredGids = new Set(Object.keys(tiles).map(Number));
    for (const [key, gid] of Object.entries(g)) {
      expect(declaredGids.has(gid), `G.${key} = ${gid} must exist in manifest.tiles`).toBe(true);
    }
  });

  test('FRAMES frame→[col,row] matches manifest.tiles grid positions', () => {
    const frames = buildFrames();
    const tiles = readManifestTilesFromDisk();

    for (const [gid, def] of Object.entries(tiles)) {
      if (!def.frame) {
        continue;
      }
      const numericGid = Number(gid);
      const expectedCol = (numericGid - 1) % ATLAS_COLS;
      const expectedRow = Math.floor((numericGid - 1) / ATLAS_COLS);
      expect(
        frames[def.frame],
        `frame ${def.frame} (GID ${numericGid}) must be derived in FRAMES`,
      ).toEqual([expectedCol, expectedRow]);
    }

    // Only manifest tiles with a declared frame produce a FRAMES entry —
    // buildFrames skips tiles without one (CodeRabbit review, C-376).
    const framesDeclared = Object.values(tiles).filter((def) => !!def.frame).length;
    expect(Object.keys(frames).length).toBe(framesDeclared);
  });

  test('readManifestTiles matches the committed manifest file', () => {
    const fromShared = readManifestTiles();
    const fromDisk = readManifestTilesFromDisk();
    expect(Object.keys(fromShared).length).toBe(Object.keys(fromDisk).length);
    for (const [gid, def] of Object.entries(fromDisk)) {
      expect(fromShared[gid]?.name, `gid ${gid} name`).toBe(def.name ?? gid);
      expect(fromShared[gid]?.frame, `gid ${gid} frame`).toBe(def.frame ?? '');
    }
  });

  // ── Validation guards (CodeRabbit review, C-376 round 2) ──

  test('buildG throws on duplicate manifest tile names', () => {
    try {
      setManifestTilesForTest({
        '1': { name: 'grass', frame: 'grass.png' },
        '2': { name: 'grass', frame: 'grass_variant.png' }, // duplicate name
      });
      expect(() => buildG()).toThrow(/duplicate manifest tile name "grass"/);
    } finally {
      resetManifestTilesCache();
    }
  });

  test('buildG throws when a semantic alias has no matching manifest tile', () => {
    try {
      setManifestTilesForTest({
        '1': { name: 'grass', frame: 'grass.png' },
      });
      // The alias table references many names (path_tough, village_gate, ...)
      // that the seeded manifest lacks.
      expect(() => buildG()).toThrow(/manifest.tiles has no tile named/);
    } finally {
      resetManifestTilesCache();
    }
  });

  test('buildFrames throws on duplicate manifest frames', () => {
    try {
      setManifestTilesForTest({
        '1': { name: 'grass', frame: 'grass.png' },
        '2': { name: 'grass_variant', frame: 'grass.png' }, // duplicate frame
      });
      expect(() => buildFrames()).toThrow(/duplicate manifest frame "grass.png"/);
    } finally {
      resetManifestTilesCache();
    }
  });

  test('buildFrames throws when a GID is outside the atlas grid', () => {
    try {
      setManifestTilesForTest({
        '129': { name: 'out_of_bounds', frame: 'oob.png' }, // > ATLAS_COLS*ATLAS_ROWS
      });
      expect(() => buildFrames()).toThrow(/outside the atlas grid/);
    } finally {
      resetManifestTilesCache();
    }
  });

  test('buildFrames skips tiles without a declared frame', () => {
    try {
      setManifestTilesForTest({
        '1': { name: 'grass', frame: 'grass.png' },
        '2': { name: 'no_frame', frame: '' },
      });
      const frames = buildFrames();
      expect(Object.keys(frames)).toEqual(['grass.png']);
    } finally {
      resetManifestTilesCache();
    }
  });
});

// ---------------------------------------------------------------------------
// C-378 AC-5 — extruded atlas determinism + corner-16 terrain frames
// ---------------------------------------------------------------------------

describe('C-378 — corner-16 terrain frame derivation', () => {
  test('readManifestTerrains reads the committed terrains block', () => {
    const terrains = readManifestTerrains();
    expect(terrains.length).toBeGreaterThanOrEqual(3);
    const names = terrains.map((t) => t.name);
    expect(names).toContain('grass');
    expect(names).toContain('dirt');
    expect(names).toContain('water');
  });

  test('cornerFrameName derives masks 0..15 from frameBase', () => {
    expect(cornerFrameName('dirt_0.png', 0)).toBe('dirt_0.png');
    expect(cornerFrameName('dirt_0.png', 1)).toBe('dirt_1.png');
    expect(cornerFrameName('dirt_0.png', 15)).toBe('dirt_15.png');
    expect(cornerFrameName('water_0.png', 7)).toBe('water_7.png');
  });
});

describe('C-378 AC-5 — atlas packer determinism', () => {
  test('all 32 corner-16 frame rects exist at 32×32 with 1px margin and distinct cells', () => {
    const atlas = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'apps/frontend/client/static/game-data/sprites/tilesets/atlas.json'),
        'utf-8',
      ),
    ) as { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> };
    const CELL = 34; // extruded cell pitch (32 content + 1px margin each side)
    const seenRects = new Set<string>();
    let checked = 0;
    // Both corner16 runs: dirt_* (row 3, after the 48 baked frames fill
    // rows 0-2) and water_* (row 4).
    for (const [terrain, firstCell] of [
      ['dirt', 48],
      ['water', 64],
    ] as const) {
      for (let mask = 0; mask < 16; mask++) {
        const name = mask === 0 ? `${terrain}_0.png` : `${terrain}_${mask}.png`;
        const entry = atlas.frames[name];
        expect(entry, `${terrain}_${mask} frame exists`).toBeDefined();
        if (!entry) {
          continue;
        }
        checked += 1;
        // 32×32 content with the 1px margin: x = col*34 + 1, y = row*34 + 1.
        const cell = firstCell + mask;
        const col = cell % 16;
        const row = Math.floor(cell / 16);
        expect(entry.frame.w, `${name} width`).toBe(32);
        expect(entry.frame.h, `${name} height`).toBe(32);
        expect(entry.frame.x, `${name} x`).toBe(col * CELL + 1);
        expect(entry.frame.y, `${name} y`).toBe(row * CELL + 1);
        // Distinct rectangle — a cell collision would overwrite a frame and
        // two entries would share a rect.
        const key = `${entry.frame.x},${entry.frame.y},${entry.frame.w},${entry.frame.h}`;
        expect(seenRects.has(key), `${name} occupies a distinct cell`).toBe(false);
        seenRects.add(key);
      }
    }
    expect(checked).toBe(32);
  });

  test('the committed atlas is 544×272 (extruded)', () => {
    const atlas = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'apps/frontend/client/static/game-data/sprites/tilesets/atlas.json'),
        'utf-8',
      ),
    ) as { meta: { size: { w: number; h: number } } };
    expect(atlas.meta.size).toEqual({ w: 544, h: 272 });
  });
});
