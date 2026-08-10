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
