// packages/frontend/engine/src/game_world/load_map_message.ts
//
// The LOAD_MAP payload sent to the simulation worker.
//
// Split out of the facade because it is a pure function of a prepared scene
// plus the load options — no engine state, no worker, no clock. That makes
// the two properties that actually bite testable in isolation:
//
// 1. `postMessage` must receive STRUCTURALLY CLONABLE data. Tiled properties
//    read as Proxy objects and the collision grid arrives as a typed array;
//    neither survives a structured clone to the worker intact, so both are
//    normalised here rather than at the transport boundary where the failure
//    is opaque.
// 2. The payload is the worker's whole view of the new map. A field added to
//    `PreparedScene` and forgotten here is a world the worker spawns wrong.

import type { PackConfig } from '@aikami/types';
import type { SpawnPoint, SpawnPointEntity, TransitionZone } from '../assets/map_loader.ts';
import type { InteractableStateMap } from '../components/interactable_state.ts';
import type { CollisionGrid } from '../systems/collision_system.ts';
import type { TerrainGrid } from '../systems/terrain_grid.ts';
import type { LoadMapOptions, PreparedScene } from './scene_transition.ts';

/** The outbound message shape every worker request satisfies. */
export type LoadMapMessage = { type: string } & Record<string, unknown>;

/** The slice of a prepared scene the worker is told about. */
export type LoadMapScene = Pick<
  PreparedScene,
  | 'spawnPoints'
  | 'transitionZones'
  | 'collisionGrid'
  | 'terrainGrid'
  | 'packConfig'
  | 'mapPixelWidth'
  | 'mapPixelHeight'
  | 'spawnPointEntities'
  | 'mapId'
>;

/**
 * Converts a spawn point's Tiled properties into plain JSON.
 *
 * Some Tiled property values (Python exports read through a parser) arrive as
 * Proxy objects that the Worker API refuses to clone.
 */
const toCloneableProperties = (properties: SpawnPoint['properties']): Record<string, unknown> =>
  JSON.parse(JSON.stringify(properties)) as Record<string, unknown>;

/**
 * Copies the boolean-array grid so the worker payload is detached from the
 * main-thread array that render code may still mutate before posting.
 */
const toCloneableCollisionGrid = (
  collisionGrid: CollisionGrid | undefined,
): CollisionGrid | undefined =>
  collisionGrid ? { ...collisionGrid, grid: [...collisionGrid.grid] } : undefined;

/**
 * Builds the `LOAD_MAP` message body for a prepared scene.
 *
 * @param scene - The prepared (parsed, derived) scene.
 * @param options - The load options that chose the spawn and carried forward
 *   cross-scene progress (defeated enemies, collected pickups, interactables).
 */
export const buildLoadMapMessage = (
  scene: LoadMapScene,
  options: LoadMapOptions,
): LoadMapMessage => ({
  type: 'LOAD_MAP',
  spawnPoints: scene.spawnPoints.map((spawnPoint) => ({
    ...spawnPoint,
    properties: toCloneableProperties(spawnPoint.properties),
  })),
  transitionZones: scene.transitionZones,
  collisionGrid: toCloneableCollisionGrid(scene.collisionGrid),
  // C-379 AC-4: the authoritative terrain grid — typed arrays clone
  // structurally, no sanitization needed.
  terrainGrid: scene.terrainGrid,
  packConfig: scene.packConfig,
  mapPixelWidth: scene.mapPixelWidth,
  mapPixelHeight: scene.mapPixelHeight,
  targetX: options.targetX,
  targetY: options.targetY,
  defeatedEnemies: options.defeatedEnemies,
  collectedPickups: options.collectedPickups,
  interactableStates: options.interactableStates,
  targetSpawnHash: options.targetSpawnHash,
  defaultSpawnHash: options.defaultSpawnHash,
  spawnPointEntities: scene.spawnPointEntities,
  disableClamping: options.disableClamping,
  mapId: scene.mapId,
});

/** Explicit re-exports so this module's contract is self-describing. */
export type {
  InteractableStateMap,
  LoadMapOptions,
  PackConfig,
  SpawnPoint,
  SpawnPointEntity,
  TerrainGrid,
  TransitionZone,
};
