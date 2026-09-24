// scripts/src/lib/ops/emberwatch_map_authoring_helpers.ts
//
// Small cell-level predicates shared by Emberwatch authoring primitives. They
// deliberately operate on the authoring `MapData` rather than the runtime
// tilemap so author-time assertions use the same collision and water rules as
// the builders.

import type { MapData } from './emberwatch_map_shared.ts';
import { buildG, readManifestTerrains } from './generate_emberwatch_tables.ts';

const G = buildG();
const TERRAIN_WALKABILITY = new Map(
  readManifestTerrains().map((terrain) => [terrain.name, terrain.isWalkable]),
);

/** True when a coordinate is an integer cell inside the authored map. */
export const isMapCell = (map: MapData, c: number, r: number): boolean =>
  Number.isInteger(c) && Number.isInteger(r) && c >= 0 && c < map.width && r >= 0 && r < map.height;

const terrainOverrideAt = (map: MapData, c: number, r: number): string | undefined => {
  const overrides = map.terrainOverrides;
  if (!overrides) {
    return undefined;
  }
  for (let index = overrides.length - 1; index >= 0; index--) {
    const entry = overrides[index];
    if (entry && entry[0] === c && entry[1] === r) {
      return entry[2];
    }
  }
  return undefined;
};

/** True when a cell is dry and explicitly walkable after terrain overrides. */
export const isWalkableLand = (map: MapData, c: number, r: number): boolean => {
  if (!isMapCell(map, c, r)) {
    return false;
  }
  const index = r * map.width + c;
  const terrain = terrainOverrideAt(map, c, r);
  if (terrain !== undefined && TERRAIN_WALKABILITY.get(terrain) === false) {
    return false;
  }
  return map.collision[index] === 0 && map.ground[index] !== G.WATER;
};

/** Format a cell list for author-time error messages. */
export const formatCells = (cells: ReadonlyArray<[number, number]>): string =>
  cells.map(([c, r]) => `(${c},${r})`).join(', ');
