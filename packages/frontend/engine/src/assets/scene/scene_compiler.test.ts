// packages/frontend/engine/src/assets/scene/scene_compiler.test.ts
//
// C-505 — AC-1 (compile normalized scenes), AC-2 (emission assertions count
// logical contributions), AC-4 (terrain matching convention preserved via the
// existing autotiler), AC-6 (deterministic, bounded).

import { describe, expect, test } from 'bun:test';
import { compileScene } from './scene_compiler.ts';
import { makeBakedScene, makeTerrainScene, makeTerrains } from './scene_test_utils.ts';

describe('scene_compiler', () => {
  test('compiles a terrain surface through the existing autotiler (AC-4)', () => {
    const doc = makeTerrainScene();
    const compiled = compileScene(doc, { terrains: makeTerrains() });
    // grass base fill + water corner16 overlay
    const groundLayers = compiled.layers.filter((l) => l.band === 'ground');
    expect(groundLayers.length).toBe(2);
    // base fill covers every cell (4) + water overlay covers its cells (1)
    expect(compiled.emission.ground).toBe(5);
    expect(compiled.emission.placements).toBe(0);
    expect(compiled.terrain).toEqual(['grass', 'grass', 'grass', 'water']);
  });

  test('terrain collision derives from isWalkable + overrides', () => {
    const doc = makeTerrainScene();
    const compiled = compileScene(doc, { terrains: makeTerrains() });
    // water (index 3) is not walkable
    expect(compiled.collision[3]).toBe(true);
    expect(compiled.collision[0]).toBe(false);
    // an explicit override can unblock it
    const unblocked = makeTerrainScene({
      navigation: { blockingOverrides: [{ index: 3, blocked: false }] },
    });
    expect(compileScene(unblocked, { terrains: makeTerrains() }).collision[3]).toBe(false);
  });

  test('compiles a baked surface to a single ground layer', () => {
    const doc = makeBakedScene();
    const compiled = compileScene(doc);
    const groundLayers = compiled.layers.filter((l) => l.band === 'ground');
    expect(groundLayers.length).toBe(1);
    expect(compiled.emission.ground).toBe(3); // [1,1,0,1]
    expect(compiled.terrain).toBeUndefined();
    // baked has no inherent collision
    expect(compiled.collision.every((c) => !c)).toBe(true);
  });

  test('emission counts decal/overhead contributions (AC-2)', () => {
    const doc = makeTerrainScene({
      layers: [
        { id: 'decal', role: 'decor', order: 0, palette: ['', 'floor.png'], grid: [0, 1, 0, 1] },
        {
          id: 'canopy',
          role: 'overhead',
          order: 0,
          palette: ['', 'canopy.png'],
          grid: [1, 0, 0, 0],
        },
      ],
    });
    const compiled = compileScene(doc, { terrains: makeTerrains() });
    expect(compiled.emission.decal).toBe(2);
    expect(compiled.emission.overhead).toBe(1);
    expect(compiled.emission.layers).toBe(2 + 2); // 2 ground + decal + overhead
  });

  test('repeated compiles of identical input produce identical output (AC-6)', () => {
    const doc = makeTerrainScene();
    const a = compileScene(doc, { terrains: makeTerrains() });
    const b = compileScene(doc, { terrains: makeTerrains() });
    expect(a.emission).toEqual(b.emission);
    expect(a.collision).toEqual(b.collision);
    expect(a.layers.map((l) => l.frames)).toEqual(b.layers.map((l) => l.frames));
  });

  test('throws when a terrain surface has no pack terrain definitions', () => {
    const doc = makeTerrainScene();
    expect(() => compileScene(doc)).toThrow(/requires pack terrain definitions/);
  });
});
