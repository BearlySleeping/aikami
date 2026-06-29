// packages/frontend/engine/src/components/map_location.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// MapLocation — tracks which zone/sector an entity occupies
//
// Contract C-194: Each entity with MapLocation belongs to a specific
// Map/Zone entity (currentZoneId) and has coarse virtual grid coordinates
// for offline position tracking when the entity is in an inactive zone.
//
// Virtual grid coordinates are updated by MacroSimulationSystem on macro
// time ticks and are NOT pixel-precise — they represent coarse sector
// layout positions for offline agents.
// ---------------------------------------------------------------------------

/** SoA storage for map location tracking. */
export const MapLocation = {
  /** Entity ID of the active Map/Zone entity this entity occupies. */
  currentZoneId: [] as number[],
  /** Coarse target X layout variable for offline tracking. */
  virtualGridX: [] as number[],
  /** Coarse target Y layout variable for offline tracking. */
  virtualGridY: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type MapLocationData = {
  currentZoneId: number;
  virtualGridX: number;
  virtualGridY: number;
};

/**
 * Registers onSet and onGet observers for the MapLocation component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerMapLocationObservers = (world: World): void => {
  observe(world, onSet(MapLocation), (eid: number, params: MapLocationData) => {
    MapLocation.currentZoneId[eid] = params.currentZoneId;
    MapLocation.virtualGridX[eid] = params.virtualGridX;
    MapLocation.virtualGridY[eid] = params.virtualGridY;
  });

  observe(
    world,
    onGet(MapLocation),
    (eid: number): MapLocationData => ({
      currentZoneId: MapLocation.currentZoneId[eid],
      virtualGridX: MapLocation.virtualGridX[eid],
      virtualGridY: MapLocation.virtualGridY[eid],
    }),
  );
};
