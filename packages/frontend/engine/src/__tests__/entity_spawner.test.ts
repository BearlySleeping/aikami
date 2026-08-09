// packages/frontend/engine/src/__tests__/entity_spawner.test.ts
//
// C-375 AC-3 — spawner attaches spatial-grid collision components.
//
// Verifies:
//   - NPC spawns get GridPosition + SpatialLink + CollisionData (layer: npc)
//   - Solid prop spawns get GridPosition + SpatialLink + CollisionData (layer: wall)
//   - Walkable props (manifest `isWalkable: true`, e.g. village_gate) get NO
//     collision components — they never enter the spatial grid.
//   - Grid coords are derived from pixel coords ÷ tileSize (32).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { World } from 'bitecs';
import { createWorld } from 'bitecs';
import type { SpawnPoint } from '../assets/map_loader.ts';
import {
  CollisionData,
  CollisionLayer,
  registerCollisionDataObservers,
} from '../components/collision_data.ts';
import { GridPosition, registerGridPositionObservers } from '../components/grid_position.ts';
import { registerNPCDialogObservers } from '../components/npc_dialog.ts';
import { registerPositionObservers } from '../components/position.ts';
import { registerSpatialLinkObservers } from '../components/spatial_link.ts';
import { registerVisualObservers } from '../components/visual.ts';
import { spawnEntities } from '../systems/entity_spawner.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSpawnPoint = (overrides: Partial<SpawnPoint> = {}): SpawnPoint => ({
  id: '1',
  type: 'prop',
  x: 160,
  y: 160, // tile (5,5)
  properties: {},
  ...overrides,
});

const makeWorld = (): World => {
  const world = createWorld();
  registerPositionObservers(world);
  registerVisualObservers(world);
  registerNPCDialogObservers(world);
  registerGridPositionObservers(world);
  registerSpatialLinkObservers(world);
  registerCollisionDataObservers(world);
  return world;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('spawnEntities — spatial collision components (C-375 AC-3)', () => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
  });

  afterEach(() => {
    // Clear SoA slots used by this suite to avoid cross-file pollution.
    for (const eid of [1, 2, 3, 4, 5, 6]) {
      delete GridPosition.x[eid];
      delete GridPosition.y[eid];
      delete CollisionData.layer[eid];
      delete CollisionData.mask[eid];
    }
  });

  test('NPC spawns with layer npc + mask wall|npc|player and grid coords', () => {
    const results = spawnEntities({
      world,
      spawnPoints: [
        makeSpawnPoint({
          id: 'thalia',
          type: 'npc',
          x: 288,
          y: 192, // tile (9,6)
          properties: { npcId: 'village_elder', npcName: 'Elder Thalia' },
        }),
      ],
    });

    expect(results).toHaveLength(1);
    const eid = results[0].eid;
    expect(GridPosition.x[eid]).toBe(9);
    expect(GridPosition.y[eid]).toBe(6);
    expect(CollisionData.layer[eid]).toBe(CollisionLayer.npc);
    expect(CollisionData.mask[eid]).toBe(
      CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.player,
    );
  });

  test('solid prop spawns with layer wall and a blocking mask', () => {
    const results = spawnEntities({
      world,
      spawnPoints: [
        makeSpawnPoint({
          id: 'well',
          type: 'prop',
          x: 160,
          y: 384, // tile (5,12)
          properties: { propId: 'village_well', frame: 'well.png' },
        }),
      ],
    });

    expect(results).toHaveLength(1);
    const eid = results[0].eid;
    expect(GridPosition.x[eid]).toBe(5);
    expect(GridPosition.y[eid]).toBe(12);
    expect(CollisionData.layer[eid]).toBe(CollisionLayer.wall);
    expect(CollisionData.mask[eid]).toBe(
      CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.player | CollisionLayer.enemy,
    );
  });

  test('walkable prop (isWalkable: true) gets NO collision components', () => {
    const results = spawnEntities({
      world,
      spawnPoints: [
        makeSpawnPoint({
          id: 'gate',
          type: 'prop',
          x: 320,
          y: 576, // tile (10,18)
          properties: { propId: 'village_gate', frame: 'village_gate.png', isWalkable: true },
        }),
      ],
    });

    expect(results).toHaveLength(1);
    const eid = results[0].eid;
    expect(GridPosition.x[eid]).toBeUndefined();
    expect(CollisionData.layer[eid]).toBeUndefined();
  });

  test('prop without isWalkable defaults to solid (blocking)', () => {
    const results = spawnEntities({
      world,
      spawnPoints: [
        makeSpawnPoint({
          id: 'crate',
          type: 'prop',
          x: 96,
          y: 96, // tile (3,3)
          properties: { propId: 'inn_crate', frame: 'red_chest.png' },
        }),
      ],
    });

    const eid = results[0].eid;
    expect(CollisionData.layer[eid]).toBe(CollisionLayer.wall);
  });
});
