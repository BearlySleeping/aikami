// apps/frontend/hub/src/lib/views/map_studio/__tests__/map_editor_utils.test.ts
//
// C-507 — pure editor helpers: canvas→cell mapping, palettes and hit-testing.
// These are the parts of the hub editor that need no engine runtime, so they
// are unit-tested here; the edit operations themselves are covered by the
// engine's `scene_editor.test.ts`.

import { describe, expect, test } from 'bun:test';
import type { SceneDocument } from '@aikami/types';
import {
  cellFromCanvasPoint,
  groundFrames,
  hitTestSelection,
  isCellInBounds,
  placementFrames,
  sceneExtentLabel,
  terrainIds,
} from '../map_editor_utils.ts';

const baked = (): SceneDocument =>
  ({
    kind: 'aikami.scene',
    schemaVersion: 1,
    id: 'baked',
    assetLock: 'pack:test',
    extent: { width: 4, height: 3, tileSize: 32 },
    surface: { mode: 'baked', palette: ['', 'floor.png', 'road.png'], grid: [1, 0, 2, 1] },
    layers: [
      {
        id: 'decor',
        role: 'decor',
        order: 0,
        palette: ['', 'flower.png'],
        grid: [0, 1, 0, 0],
      },
    ],
    placements: [{ id: 'oak_1', component: 'prop', frame: 'oak.png', x: 64, y: 32 }],
    navigation: { blockingOverrides: [{ index: 1, blocked: true }] },
    transitions: [
      {
        id: 'to_inn',
        x: 96,
        y: 64,
        width: 32,
        height: 32,
        targetMap: 'inn',
        targetX: 0,
        targetY: 0,
      },
    ],
  }) as SceneDocument;

const terrain = (): SceneDocument =>
  ({
    ...baked(),
    surface: {
      mode: 'terrain',
      defaultTerrain: 'grass',
      cells: ['grass', 'water', 'grass', 'grass'],
      matchingMode: 'corner16',
    },
  }) as unknown as SceneDocument;

describe('cellFromCanvasPoint', () => {
  test('maps pixels to cells by tile size', () => {
    expect(cellFromCanvasPoint(0, 0, 32)).toEqual({ x: 0, y: 0 });
    expect(cellFromCanvasPoint(31, 31, 32)).toEqual({ x: 0, y: 0 });
    expect(cellFromCanvasPoint(32, 64, 32)).toEqual({ x: 1, y: 2 });
    expect(cellFromCanvasPoint(95, 10, 32)).toEqual({ x: 2, y: 0 });
  });
});

describe('isCellInBounds', () => {
  test('accepts in-range integer cells only', () => {
    const doc = baked();
    expect(isCellInBounds(doc, 0, 0)).toBe(true);
    expect(isCellInBounds(doc, 3, 2)).toBe(true);
    expect(isCellInBounds(doc, 4, 0)).toBe(false);
    expect(isCellInBounds(doc, -1, 0)).toBe(false);
    expect(isCellInBounds(doc, 1.5, 0)).toBe(false);
  });
});

describe('palettes', () => {
  test('groundFrames drops the reserved empty entry', () => {
    expect(groundFrames(baked())).toEqual(['floor.png', 'road.png']);
    expect(groundFrames(terrain())).toEqual([]);
  });

  test('terrainIds lists distinct surface terrain ids', () => {
    expect(terrainIds(terrain()).sort()).toEqual(['grass', 'water']);
    expect(terrainIds(baked())).toEqual([]);
  });

  test('placementFrames unions placement and layer frames', () => {
    expect(placementFrames(baked()).sort()).toEqual(['flower.png', 'oak.png']);
  });
});

describe('hitTestSelection', () => {
  test('finds a placement by its anchor cell', () => {
    // oak_1 is at pixel (64, 32) → cell (2, 1)
    expect(hitTestSelection(baked(), 2, 1)).toEqual({ kind: 'placement', id: 'oak_1' });
  });

  test('finds a transition by its rectangle', () => {
    // to_inn covers (96,64)-(128,96) → cell (3, 2)
    expect(hitTestSelection(baked(), 3, 2)).toEqual({ kind: 'transition', id: 'to_inn' });
  });

  test('returns undefined on an empty cell', () => {
    expect(hitTestSelection(baked(), 0, 0)).toBeUndefined();
  });
});

describe('sceneExtentLabel', () => {
  test('formats the extent', () => {
    expect(sceneExtentLabel(baked())).toBe('4 × 3 cells');
  });
});
