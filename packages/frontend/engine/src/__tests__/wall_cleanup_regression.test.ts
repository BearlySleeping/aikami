// packages/frontend/engine/src/__tests__/wall_cleanup_regression.test.ts
//
// C-378 regression: portal transitions after a map with solid walls.
//
// A merchant → village portal transition used to break the village's
// transition-zone triggers (zones=0, portals dead). Root cause: bitECS
// recycles freed EIDs, so the next map's freshly spawned entities reused
// EIDs that the PREVIOUS map's wall entities held. setCollisionGrid's
// self-cleaning loop removed "old walls" by raw EID — deleting the NEW
// map's live entities that had recycled those EIDs. The village's zone
// triggers happened to be the victims.
//
// This test drives the real worker flow (parse → teardown → spawn zones →
// spawn points → setCollisionGrid → hydrate) twice, exactly like LOAD_MAP,
// and asserts the zone-trigger query survives both loads.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addComponent,
  addEntity,
  createWorld,
  getAllEntities,
  query,
  removeEntity,
  set,
} from 'bitecs';
import {
  clearMapCache,
  djb2Hash,
  extractCollisionGrid,
  extractSpawnPointEntities,
  extractTransitionZones,
  loadTilemap,
  type TilemapData,
} from '../assets/map_loader.ts';
import { registerCollisionDataObservers } from '../components/collision_data.ts';
import {
  registerEngineStateObservers,
  SimulationState,
  setSimulationState,
} from '../components/engine_state.ts';
import { registerGridPositionObservers } from '../components/grid_position.ts';
import { registerMapLocationObservers } from '../components/map_location.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerSpatialLinkObservers } from '../components/spatial_link.ts';
import { registerTransitionObservers, Transition } from '../components/transition.ts';
import { registerZoneStatusObservers } from '../components/zone_status.ts';
import { MAX_ENTITIES } from '../config/memory_config.ts';
import { incrementEntityGeneration } from '../core/entity_reference.ts';
import { isWalkable, resetCollisionGrid, setCollisionGrid } from '../systems/collision_system.ts';
import { spawnSpawnPointEntities, spawnTransitionEntities } from '../systems/entity_spawner.ts';
import { hydrateZone } from '../systems/macro_simulation_system.ts';

const ZONE_TERMS = [Position, Transition];

const parseMap = async (name: string): Promise<TilemapData> => {
  clearMapCache();
  const rel = `apps/frontend/client/static/content-packs/emberwatch/maps/${name}.json`;
  const candidates = [
    resolve(process.cwd(), rel),
    resolve(import.meta.dir, `../../../../../${rel}`),
    resolve(import.meta.dir, `../../../../${rel}`),
  ];
  let raw: unknown;
  for (const p of candidates) {
    try {
      raw = JSON.parse(readFileSync(p, 'utf8'));
      break;
    } catch {
      // try next
    }
  }
  if (!raw) {
    throw new Error(`cannot find map ${name}.json — tried ${candidates.join(', ')}`);
  }
  return loadTilemap({
    url: `file://maps/${name}.json`,
    fetch: (async () => ({
      ok: true,
      json: async () => raw,
    })) as unknown as typeof fetch,
  });
};

describe('setCollisionGrid wall cleanup (C-378 regression)', () => {
  it('transition zones survive a merchant → village LOAD_MAP cycle', async () => {
    const world = createWorld();
    registerPositionObservers(world);
    registerTransitionObservers(world);
    registerGridPositionObservers(world);
    registerSpatialLinkObservers(world);
    registerCollisionDataObservers(world);
    registerMapLocationObservers(world);
    registerZoneStatusObservers(world);
    registerEngineStateObservers(world);

    // Player entity (preserved across loads)
    const player = addEntity(world);
    addComponent(world, player, Position);
    addComponent(world, player, set(Position, { x: 224, y: 273 }));

    const loadMapLike = async (mapName: string): Promise<void> => {
      const tilemap = await parseMap(mapName);

      // LOAD_MAP teardown: remove every non-player entity (walls included)
      // with a generation bump — bitECS then recycles those EIDs.
      for (const eid of getAllEntities(world)) {
        if (eid !== player) {
          incrementEntityGeneration(eid);
          removeEntity(world, eid);
        }
      }

      // spawn transition zone trigger entities
      const zones = extractTransitionZones(tilemap);
      spawnTransitionEntities({ world, transitionZones: zones });

      // spawn point marker entities
      const sps = extractSpawnPointEntities(tilemap);
      if (sps.length > 0) {
        spawnSpawnPointEntities({ world, spawnPointEntities: sps });
      }

      // collision grid + wall entities (the C-376 self-cleaning path)
      const collisionGrid = extractCollisionGrid(tilemap, { layerName: 'collision' });
      if (collisionGrid) {
        setCollisionGrid(
          { width: tilemap.width, height: tilemap.height, tileSize: 32, grid: collisionGrid },
          world,
        );
      }

      // C-194 zone hydration
      const zoneEid = djb2Hash(mapName) % MAX_ENTITIES || 1;
      hydrateZone(world, zoneEid, { zonePixelOriginX: 0, zonePixelOriginY: 0, gridCellSize: 64 });

      setSimulationState(world, SimulationState.active);
    };

    // LOAD_MAP #1: merchant_shop (1 transition zone)
    await loadMapLike('merchant_shop');
    expect(query(world, ZONE_TERMS).length).toBe(1);

    // LOAD_MAP #2: village (2 transition zones) — the regression case
    await loadMapLike('village');
    expect(query(world, ZONE_TERMS).length).toBe(2);
  });

  it('no wall entities are created — recycled EIDs always belong to the new map', () => {
    const world = createWorld();
    registerPositionObservers(world);
    registerTransitionObservers(world);
    registerGridPositionObservers(world);
    registerSpatialLinkObservers(world);
    registerCollisionDataObservers(world);

    const player = addEntity(world);
    addComponent(world, player, Position);
    addComponent(world, player, set(Position, { x: 10, y: 10 }));

    // Grid #1: single solid cell at (0,0). C-379 AC-4: terrain solidity
    // lives in the cost grid — NO wall entity is created for the solid cell.
    const grid1: { width: number; height: number; tileSize: number; grid: boolean[] } = {
      width: 2,
      height: 2,
      tileSize: 32,
      grid: [true, false, false, false],
    };
    setCollisionGrid(grid1, world);

    expect(getAllEntities(world)).toEqual([player]);
    expect(isWalkable(0, 0)).toBe(false); // terrain cost blocks, not an entity

    // Simulate a map teardown the way LOAD_MAP does: bump the generation
    // FIRST so stale safe refs die, then remove the entity.
    for (const eid of getAllEntities(world)) {
      if (eid !== player) {
        incrementEntityGeneration(eid);
        removeEntity(world, eid);
      }
    }

    // A NON-wall entity (transition-zone trigger stand-in) claims the
    // lowest freed slot.
    const occupant = addEntity(world);
    addComponent(world, occupant, Position);
    addComponent(world, occupant, set(Position, { x: 64, y: 64 }));

    // Grid #2: a new solid cell at (1,1). The old wall-entity cleanup path
    // is GONE (C-379 deletes wall entities entirely), so the occupant can
    // never be misidentified as a stale wall and deleted.
    const grid2: { width: number; height: number; tileSize: number; grid: boolean[] } = {
      width: 2,
      height: 2,
      tileSize: 32,
      grid: [false, false, false, true],
    };
    setCollisionGrid(grid2, world);

    // The intervening entity SURVIVES the grid update — nothing removes it.
    expect(getAllEntities(world)).toContain(occupant);
    expect(getAllEntities(world).length).toBe(2); // player + occupant only
    // grid2 solidity: only (1,1) is solid; (0,0) is now walkable.
    expect(isWalkable(0, 0)).toBe(true); // grid2 replaced grid1
    expect(isWalkable(1 * 32 + 16, 1 * 32 + 16)).toBe(false); // (1,1) solid

    resetCollisionGrid();
  });
});
