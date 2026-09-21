// packages/frontend/engine/src/assets/scene/scene_test_utils.ts
//
// C-505 — Shared test fixtures for the canonical scene module.

import type { SceneDocument } from '@aikami/types';

/** Builds a minimal valid terrain-surface scene for tests. */
export const makeTerrainScene = (overrides?: Partial<SceneDocument>): SceneDocument => {
  const doc: SceneDocument = {
    kind: 'aikami.scene',
    schemaVersion: 1,
    id: 'test-scene',
    assetLock: 'pack:emberwatch@1.0.0',
    extent: { width: 2, height: 2, tileSize: 32 },
    surface: {
      mode: 'terrain',
      defaultTerrain: 'grass',
      cells: ['grass', 'grass', 'grass', 'water'],
      matchingMode: 'corner16',
    },
    layers: [],
    placements: [],
    navigation: {},
    transitions: undefined,
    elevation: undefined,
    provenance: undefined,
    ...overrides,
  };
  return doc;
};

/** Builds a minimal valid baked-surface scene for tests. */
export const makeBakedScene = (overrides?: Partial<SceneDocument>): SceneDocument => {
  const doc: SceneDocument = {
    kind: 'aikami.scene',
    schemaVersion: 1,
    id: 'baked-scene',
    assetLock: 'pack:emberwatch@1.0.0',
    extent: { width: 2, height: 2, tileSize: 32 },
    surface: {
      mode: 'baked',
      palette: ['', 'floor.png'],
      grid: [1, 1, 0, 1],
    },
    layers: [],
    placements: [],
    navigation: {},
    transitions: undefined,
    elevation: undefined,
    provenance: undefined,
    ...overrides,
  };
  return doc;
};

/** Two pack terrains (grass base + water corner16) for autotile/compile. */
export const makeTerrains = () => [
  {
    name: 'grass',
    precedence: 0,
    wang: 'fill' as const,
    frameBase: 'grass_0.png',
    variants: ['grass_1.png'],
    isWalkable: true,
    movementCost: 1,
    blocksSight: false,
  },
  {
    name: 'water',
    precedence: 1,
    wang: 'corner16' as const,
    frameBase: 'water_0.png',
    isWalkable: false,
    movementCost: 4,
    blocksSight: false,
  },
];
