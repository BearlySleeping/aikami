// scripts/src/lib/ops/emberwatch_atlas_coverage.test.ts
//
// Rules-level tests for the map GID → atlas frame coverage check (C-548).
//
// The real-pack integration assertion proves the committed maps resolve against
// the committed atlas; the synthetic cases prove each failure class fires.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  atlasFrameNames,
  checkGidAtlasCoverage,
  readAtlasFrameNames,
  scanPackGidAtlasCoverage,
} from './emberwatch_atlas_coverage.ts';
import { packRoot, readJson, repository } from './emberwatch_map_validation_context.ts';

const gameDataRoot = join(repository, 'apps/frontend/client/static/game-data');

describe('atlas frame names', () => {
  test('reads a map-shaped frames block', () => {
    expect([...atlasFrameNames({ frames: { 'grass.png': {}, 'water.png': {} } })].sort()).toEqual([
      'grass.png',
      'water.png',
    ]);
  });

  test('reads an array-shaped frames block', () => {
    expect(
      [
        ...atlasFrameNames({ frames: [{ filename: 'grass.png' }, { filename: 'water.png' }] }),
      ].sort(),
    ).toEqual(['grass.png', 'water.png']);
  });

  test('a missing frames block is empty, never a throw', () => {
    expect(atlasFrameNames({}).size).toBe(0);
  });
});

describe('gid → atlas coverage', () => {
  const manifest = {
    tiles: {
      '1': { frame: 'grass.png' },
      '42': { frame: 'bridge.png' },
      '134': { frame: 'bridge_end_n.png' },
    },
  };

  test('a GID whose frame the atlas carries is accepted', () => {
    const findings = checkGidAtlasCoverage({
      mapId: 'm',
      layers: [{ name: 'ground', data: [1, 42, 0, 134] }],
      manifest,
      atlasFrames: new Set(['grass.png', 'bridge.png', 'bridge_end_n.png']),
    });
    expect(findings).toEqual([]);
  });

  test('a GID beyond the atlas reports the frame by name', () => {
    const findings = checkGidAtlasCoverage({
      mapId: 'm',
      layers: [{ name: 'ground', data: [1, 145] }],
      manifest: {
        tiles: { '1': { frame: 'grass.png' }, '145': { frame: 'bridge_corner_se_ew.png' } },
      },
      atlasFrames: new Set(['grass.png']),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toBe('frame-not-in-atlas');
    expect(findings[0]?.gid).toBe(145);
    expect(findings[0]?.frame).toBe('bridge_corner_se_ew.png');
    expect(findings[0]?.detail).toContain('bridge_corner_se_ew.png');
  });

  test('an undeclared GID is a failure in its own right', () => {
    const findings = checkGidAtlasCoverage({
      mapId: 'm',
      layers: [{ name: 'decor', data: [7] }],
      manifest,
      atlasFrames: new Set(['grass.png']),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toBe('undeclared-gid');
    expect(findings[0]?.gid).toBe(7);
  });

  test('the collision layer is never treated as tile GIDs', () => {
    const findings = checkGidAtlasCoverage({
      mapId: 'm',
      layers: [{ name: 'collision', data: [1, 1, 0, 1] }],
      manifest,
      atlasFrames: new Set(),
    });
    expect(findings).toEqual([]);
  });

  test('a repeated bad GID is reported once per layer, naming its first cell', () => {
    const findings = checkGidAtlasCoverage({
      mapId: 'm',
      layers: [{ name: 'ground', data: [200, 200, 200] }],
      manifest: { tiles: { '200': { frame: 'ghost.png' } } },
      atlasFrames: new Set(),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.cell).toBe(0);
  });

  test('honours a nonzero firstgid by shifting to the 1-based local id', () => {
    // raw GID 100 with firstgid 100 → local tile 1 → manifest "1".
    const findings = checkGidAtlasCoverage({
      mapId: 'm',
      layers: [{ name: 'ground', data: [100] }],
      manifest: { tiles: { '1': { frame: 'grass.png' } }, firstgid: 100 },
      atlasFrames: new Set(['grass.png']),
    });
    expect(findings).toEqual([]);
  });
});

describe('fixture map using a GID beyond the atlas', () => {
  test('a fixture map that paints a GID past the atlas fails the scan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aikami-atlas-fixture-'));
    try {
      const fixturePack = join(dir, 'pack');
      const mapsDir = join(fixturePack, 'maps');
      mkdirSync(mapsDir, { recursive: true });
      const fixtureGameData = join(dir, 'game-data');
      mkdirSync(join(fixtureGameData, 'sprites/tilesets'), { recursive: true });
      // The fixture atlas carries only the ground frame.
      writeFileSync(
        join(fixtureGameData, 'sprites/tilesets/atlas.json'),
        JSON.stringify({ frames: { 'grass.png': {} } }),
      );
      // The fixture crossing paints GID 145 (a C-546 bridge corner frame) at
      // cell 1 — a frame the fixture atlas does not carry.
      writeFileSync(
        join(mapsDir, 'crossing.json'),
        JSON.stringify({
          width: 2,
          height: 1,
          tilesets: [{ firstgid: 1 }],
          layers: [{ name: 'ground', type: 'tilelayer', data: [1, 145] }],
        }),
      );
      const scan = scanPackGidAtlasCoverage({
        packRoot: fixturePack,
        gameDataRoot: fixtureGameData,
        manifest: {
          tiles: {
            '1': { frame: 'grass.png' },
            '145': { frame: 'bridge_corner_se_ew.png' },
          },
        },
      });
      expect(scan.atlasBuilt).toBe(true);
      expect(scan.findings).toHaveLength(1);
      expect(scan.findings[0]?.reason).toBe('frame-not-in-atlas');
      expect(scan.findings[0]?.mapId).toBe('crossing');
      expect(scan.findings[0]?.gid).toBe(145);
      expect(scan.findings[0]?.frame).toBe('bridge_corner_se_ew.png');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('real pack integration', () => {
  test('every committed map GID resolves to a committed atlas frame', () => {
    expect(existsSync(join(gameDataRoot, 'sprites/tilesets/atlas.json'))).toBe(true);
    const manifest = readJson<{ tiles: Record<string, { frame?: string }> }>(
      join(packRoot, 'manifest.json'),
    );
    const scan = scanPackGidAtlasCoverage({ packRoot, gameDataRoot, manifest });
    expect(scan.atlasBuilt).toBe(true);
    expect(scan.findings).toEqual([]);
  });

  test('readAtlasFrameNames returns undefined when the descriptor is absent', () => {
    expect(readAtlasFrameNames(join(repository, 'does-not-exist'))).toBeUndefined();
  });
});
