// packages/frontend/engine/src/components/spawn_point.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// SpawnPoint — SoA component for map spawn location markers
//
// Contract C-172: Spawn points decouple transition targets from raw X/Y
// coordinates. Each spawn entity carries a string-hash identifier
// (`spawnHash`) that the zoning system looks up when the player enters
// a portal. Coordinates are stored on the Position component.
//
// Entities with SpawnPoint + Position define valid player entry points
// on a map. When a portal triggers, the engine resolves the target
// `spawnHash` → Position coordinates from these entities.
// ---------------------------------------------------------------------------

/** SoA storage for spawn point identifiers. */
export const SpawnPoint = {
  /** Numeric hash of the spawn point's string identifier (e.g., hash('town_spawn')). */
  spawnHash: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type SpawnPointData = {
  spawnHash: number;
};

/**
 * Registers onSet and onGet observers for the SpawnPoint component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerSpawnPointObservers = (world: World): void => {
  observe(world, onSet(SpawnPoint), (eid: number, params: SpawnPointData) => {
    SpawnPoint.spawnHash[eid] = params.spawnHash;
  });

  observe(
    world,
    onGet(SpawnPoint),
    (eid: number): SpawnPointData => ({
      spawnHash: SpawnPoint.spawnHash[eid],
    }),
  );
};
