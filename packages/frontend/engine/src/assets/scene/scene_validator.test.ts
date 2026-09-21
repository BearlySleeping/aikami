// packages/frontend/engine/src/assets/scene/scene_validator.test.ts
//
// C-505 — AC-2 (duplicate source ownership rejected, legitimate layering
// survives), AC-4 (unknown terrain / matching modes fail explicitly), AC-6
// (invalid budgets fail before allocation).

import { describe, expect, test } from 'bun:test';
import { SCENE_MAX_TRANSITIONS } from '@aikami/constants';
import type { SceneDocument, SceneTerrainMatchingMode } from '@aikami/types';
import { makeBakedScene, makeTerrainScene } from './scene_test_utils.ts';
import { collectSceneErrors, SceneValidationError, validateScene } from './scene_validator.ts';

const PACK = {
  terrainIds: ['grass', 'water'],
  frameNames: new Set(['floor.png', 'wall.png', 'canopy.png']),
};

describe('scene_validator', () => {
  test('accepts a valid terrain scene', () => {
    const doc = makeTerrainScene();
    expect(validateScene(doc)).toBe(doc);
  });

  test('accepts a valid baked scene', () => {
    const doc = makeBakedScene();
    expect(validateScene(doc)).toBe(doc);
  });

  test('rejects duplicate layer ids (AC-2)', () => {
    const doc = makeTerrainScene({
      layers: [
        { id: 'decal_a', role: 'decor', order: 0, palette: ['', 'floor.png'], grid: [0, 0, 0, 1] },
        { id: 'decal_a', role: 'decor', order: 1, palette: ['', 'floor.png'], grid: [0, 0, 0, 1] },
      ],
    });
    expect(() => validateScene(doc)).toThrow(SceneValidationError);
  });

  test('rejects duplicate placement ids (AC-2)', () => {
    const doc = makeTerrainScene({
      placements: [
        { id: 'p1', component: 'npc', frame: 'villager.png', x: 0, y: 0 },
        { id: 'p1', component: 'npc', frame: 'villager.png', x: 32, y: 32 },
      ],
    });
    expect(() => validateScene(doc)).toThrow(/duplicate placement id/);
  });

  test('rejects a visual layer with a ground role (second ground authority)', () => {
    const doc = makeTerrainScene({
      layers: [
        { id: 'bad', role: 'ground', order: 0, palette: ['', 'floor.png'], grid: [0, 0, 0, 0] },
      ],
    });
    expect(() => validateScene(doc)).toThrow(/ground is owned by the surface/);
  });

  test('rejects a grid whose length is not width×height', () => {
    const doc = makeTerrainScene({
      surface: {
        mode: 'baked',
        palette: ['', 'floor.png'],
        grid: [1, 1], // 2 cells, expected 4
      },
    });
    expect(() => validateScene(doc)).toThrow(/does not equal width×height/);
  });

  test('rejects a palette index out of range', () => {
    const doc = makeBakedScene({
      surface: { mode: 'baked', palette: ['', 'floor.png'], grid: [1, 5, 0, 1] },
    });
    expect(() => validateScene(doc)).toThrow(/palette index 5 out of range/);
  });

  test('rejects a nonzero empty baked-surface palette entry', () => {
    const doc = makeBakedScene({
      surface: { mode: 'baked', palette: ['', ''], grid: [1, 0, 0, 0] },
    });
    expect(() => validateScene(doc)).toThrow(/palette\[1\] is empty/);
  });

  test('rejects a nonzero empty visual-layer palette entry', () => {
    const doc = makeBakedScene({
      layers: [{ id: 'decor', role: 'decor', order: 0, palette: ['', ''], grid: [0, 1, 0, 0] }],
    });
    expect(() => validateScene(doc)).toThrow(/palette\[1\] is empty/);
  });

  test('rejects an elevation channel of the wrong length', () => {
    const doc = makeTerrainScene({ elevation: [0, 1] }); // expected 4
    expect(() => validateScene(doc)).toThrow(/does not equal width×height/);
  });

  test('rejects a navigation override index out of range', () => {
    const doc = makeTerrainScene({
      navigation: { blockingOverrides: [{ index: 99, blocked: true }] },
    });
    expect(() => validateScene(doc)).toThrow(/out of range/);
  });

  test('rejects a scene exceeding the cell budget before allocation (AC-6)', () => {
    // 1025×1025 = 1,050,625 > 1,048,576
    const doc = makeTerrainScene({
      extent: { width: 1025, height: 1025, tileSize: 32 },
    });
    expect(() => validateScene(doc)).toThrow(/SCENE_MAX_CELLS/);
  });

  test('rejects a scene exceeding the transition budget', () => {
    const doc = makeTerrainScene();
    const transitions: NonNullable<SceneDocument['transitions']> = [];
    transitions.length = SCENE_MAX_TRANSITIONS + 1;
    doc.transitions = transitions;
    expect(() => validateScene(doc)).toThrow(/too many transitions/);
  });

  test('rejects unknown terrain ids when a pack is supplied (AC-4)', () => {
    const doc = makeTerrainScene({
      surface: {
        mode: 'terrain',
        defaultTerrain: 'grass',
        cells: ['grass', 'lava', 'grass', 'water'],
        matchingMode: 'corner16',
      },
    });
    expect(() => validateScene(doc, { pack: PACK })).toThrow(/unknown terrain id\(s\): lava/);
  });

  test('rejects an unsupported terrain matching mode (AC-4)', () => {
    const doc = makeTerrainScene({
      surface: {
        mode: 'terrain',
        defaultTerrain: 'grass',
        cells: ['grass', 'grass', 'grass', 'grass'],
        // guard-ignore lint/type-safety/casting: intentional malformed fixture exercises runtime validation
        matchingMode: 'smooth' as unknown as SceneTerrainMatchingMode,
      },
    });
    expect(() => validateScene(doc, { pack: PACK })).toThrow(
      /unsupported terrain matching mode "smooth"/,
    );
  });

  test('rejects placements referencing unknown frames with a pack (AC-4)', () => {
    const doc = makeTerrainScene({
      placements: [{ id: 'p1', component: 'npc', frame: 'does_not_exist.png', x: 0, y: 0 }],
    });
    expect(() => validateScene(doc, { pack: PACK })).toThrow(/unknown frame "does_not_exist.png"/);
  });

  test('collectSceneErrors returns a list instead of throwing', () => {
    const doc = makeTerrainScene({
      placements: [
        { id: 'p1', component: 'npc', frame: 'a.png', x: 0, y: 0 },
        { id: 'p1', component: 'npc', frame: 'b.png', x: 32, y: 32 },
      ],
      navigation: { blockingOverrides: [{ index: 99, blocked: true }] },
      elevation: [0],
    });
    const errors = collectSceneErrors(doc);
    expect(errors).toHaveLength(3);
    expect(errors.some((error) => /duplicate placement id/.test(error))).toBe(true);
    expect(errors.some((error) => /blocking override index 99 out of range/.test(error))).toBe(
      true,
    );
    expect(errors.some((error) => /elevation length/.test(error))).toBe(true);
  });
});
