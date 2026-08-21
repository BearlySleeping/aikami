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
import type { PackConfig } from '@aikami/types';
import type { World } from 'bitecs';
import { createWorld, hasComponent } from 'bitecs';
import type { SpawnPoint } from '../assets/map_loader.ts';
import { Appearance } from '../components/appearance.ts';
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

/** Pack config declaring village_gate walkable, everything else solid. */
const makePackConfig = (): PackConfig => ({
  tiles: {},
  props: {
    // biome-ignore lint/style/useNamingConvention: manifest prop IDs use snake_case
    village_gate: { name: 'Gate', frame: 'village_gate.png', isWalkable: true },
    // biome-ignore lint/style/useNamingConvention: manifest prop IDs use snake_case
    village_well: { name: 'Well', frame: 'well.png', isWalkable: false },
  },
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

  test('NPC spawns with layer npc + mask wall|npc (C-402: no player layer)', () => {
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
    // C-402: the NPC mask no longer blocks the player — the two-way
    // symmetric block was the deadlock root cause. NPCs still block walls
    // and other NPCs; the halt rule stops NPCs at interactionRadius.
    expect(CollisionData.mask[eid]).toBe(CollisionLayer.wall | CollisionLayer.npc);
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

  test('walkable prop (packConfig isWalkable: true) gets NO collision components', () => {
    // C-376 AC-2: walkability comes from the resolved pack config, not the
    // spawn-point properties side channel.
    const results = spawnEntities({
      world,
      spawnPoints: [
        makeSpawnPoint({
          id: 'gate',
          type: 'prop',
          x: 320,
          y: 576, // tile (10,18)
          properties: { propId: 'village_gate', frame: 'village_gate.png' },
        }),
      ],
      packConfig: makePackConfig(),
    });

    expect(results).toHaveLength(1);
    const eid = results[0].eid;
    expect(GridPosition.x[eid]).toBeUndefined();
    expect(CollisionData.layer[eid]).toBeUndefined();
  });

  test('solid prop from packConfig (isWalkable: false) blocks', () => {
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
      packConfig: makePackConfig(),
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

  test('prop without packConfig defaults to solid (graceful degradation)', () => {
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

  test('prop with packConfig that lacks the propId defaults to solid (false-default path)', () => {
    // C-376 AC-2 false-default path: packConfig exists but has no entry for
    // the spawned propId — the prop must stay solid, never silently walkable.
    const results = spawnEntities({
      world,
      spawnPoints: [
        makeSpawnPoint({
          id: 'mystery_crate',
          type: 'prop',
          x: 96,
          y: 96, // tile (3,3)
          properties: { propId: 'not_in_pack', frame: 'red_chest.png' },
        }),
      ],
      packConfig: makePackConfig(), // declares village_gate + village_well only
    });

    expect(results).toHaveLength(1);
    const eid = results[0].eid;
    expect(GridPosition.x[eid]).toBe(3);
    expect(GridPosition.y[eid]).toBe(3);
    expect(CollisionData.layer[eid]).toBe(CollisionLayer.wall);
    expect(CollisionData.mask[eid]).toBe(
      CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.player | CollisionLayer.enemy,
    );
  });

  test('manifest prop entry omitting isWalkable defaults to solid (false-default path)', () => {
    // C-376 AC-2 false-default path: the manifest prop entry exists but omits
    // isWalkable (schema-optional) — the prop must stay solid.
    const packConfigNoWalkability: PackConfig = {
      tiles: {},
      props: {
        // biome-ignore lint/style/useNamingConvention: manifest prop IDs use snake_case
        village_gate: { name: 'Gate', frame: 'village_gate.png', isWalkable: true },
        // biome-ignore lint/style/useNamingConvention: manifest prop IDs use snake_case
        silent_crate: { name: 'Crate', frame: 'red_chest.png' }, // no isWalkable
      },
    };

    const results = spawnEntities({
      world,
      spawnPoints: [
        makeSpawnPoint({
          id: 'crate',
          type: 'prop',
          x: 96,
          y: 96, // tile (3,3)
          properties: { propId: 'silent_crate', frame: 'red_chest.png' },
        }),
      ],
      packConfig: packConfigNoWalkability,
    });

    expect(results).toHaveLength(1);
    const eid = results[0].eid;
    expect(GridPosition.x[eid]).toBe(3);
    expect(GridPosition.y[eid]).toBe(3);
    expect(CollisionData.layer[eid]).toBe(CollisionLayer.wall);
    expect(CollisionData.mask[eid]).toBe(
      CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.player | CollisionLayer.enemy,
    );
  });

  // ── Render-race regression (emberwatch inn_barrel showing an NPC) ──
  // The worker emits APPEARANCE_CHANGED only for entities carrying the
  // Appearance component. getAppearanceLayers() ALWAYS returns a 6-element
  // array, so gating on `length > 0` leaks a default-NPC appearance onto
  // props, which never have Appearance — painting an NPC over the barrel on
  // every map transition. This test pins the invariant the fix relies on:
  // NPCs carry Appearance, props do NOT.
  test('NPC spawns with an Appearance component; props do NOT (render-race regression)', () => {
    const results = spawnEntities({
      world,
      spawnPoints: [
        makeSpawnPoint({
          id: 'rollo',
          type: 'npc',
          x: 256,
          y: 160,
          properties: { npcId: 'rollo_grasper', npcName: 'Rollo the Grasper' },
        }),
        makeSpawnPoint({
          id: 'barrel',
          type: 'prop',
          x: 96,
          y: 96,
          properties: { propId: 'inn_barrel', frame: 'barrel.png' },
        }),
      ],
    });

    const npcResult = results.find((r) => r.type === 'npc');
    const propResult = results.find((r) => r.type === 'prop');
    expect(npcResult).toBeDefined();
    expect(propResult).toBeDefined();
    if (!npcResult || !propResult) {
      throw new Error('Expected both an NPC and a prop spawn result');
    }
    const npcEid = npcResult.eid;
    const propEid = propResult.eid;

    // NPC: carries the Appearance component (spawner sets 6 layers → the
    // worker emits APPEARANCE_CHANGED for it).
    expect(hasComponent(world, npcEid, Appearance)).toBe(true);
    // Prop: must NOT carry Appearance — otherwise the worker's appearance
    // emission paints LPC NPC layers over the barrel sprite. (Checked via
    // hasComponent — world-scoped, unlike the module-global SoA arrays which
    // are polluted across test files.)
    expect(hasComponent(world, propEid, Appearance)).toBe(false);
  });
});
