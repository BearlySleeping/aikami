// packages/frontend/engine/src/components/zone_status.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';
import { MapLocation } from './map_location.ts';

// ---------------------------------------------------------------------------
// ZoneStatus — marks whether a Map/Zone entity is the active sector
//
// Contract C-194: Each map zone entity carries a ZoneStatus component.
// isActive === 1 when the zone matches the player's current location,
// 0 otherwise. Real-time high-fidelity systems (movement, collision,
// vision) use this to gate computation on inactive entities.
//
// An entity is "active" when its MapLocation.currentZoneId points to
// a zone entity whose ZoneStatus.isActive === 1.
// ---------------------------------------------------------------------------

/** SoA storage for zone activation status. */
export const ZoneStatus = {
  /**
   * 1 if this zone matches the player's current location, 0 otherwise.
   * Zone entities are tagged with this component on creation.
   */
  isActive: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type ZoneStatusData = {
  isActive: number;
};

/**
 * Registers onSet and onGet observers for the ZoneStatus component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerZoneStatusObservers = (world: World): void => {
  observe(world, onSet(ZoneStatus), (eid: number, params: ZoneStatusData) => {
    ZoneStatus.isActive[eid] = params.isActive;
  });

  observe(
    world,
    onGet(ZoneStatus),
    (eid: number): ZoneStatusData => ({
      isActive: ZoneStatus.isActive[eid],
    }),
  );
};

// ---------------------------------------------------------------------------
// Helper: determine if an entity should participate in real-time systems
// ---------------------------------------------------------------------------

/**
 * Returns true if the entity with the given MapLocation component is in
 * the active zone (and therefore should run in real-time systems).
 *
 * Walk: MapLocation.currentZoneId[eid] → ZoneStatus.isActive[zoneEid]
 *
 * @param eid - The entity ID to check.
 * @returns `true` if the entity is in the active zone.
 */
export const isEntityInActiveZone = (eid: number): boolean => {
  const zoneEid = MapLocation.currentZoneId[eid];
  if (zoneEid === undefined || zoneEid === 0) {
    // No zone assignment — treat as active (backward compat: entities
    // without MapLocation always run in real-time systems).
    return true;
  }
  return ZoneStatus.isActive[zoneEid] === 1;
};

/**
 * Returns the entity ID of the currently active zone, or 0 if none.
 *
 * Scans ZoneStatus.isActive for the first entity with isActive === 1.
 */
export const getActiveZoneId = (): number => {
  const count = ZoneStatus.isActive.length;
  for (let eid = 0; eid < count; eid++) {
    if (ZoneStatus.isActive[eid] === 1) {
      return eid;
    }
  }
  return 0;
};
