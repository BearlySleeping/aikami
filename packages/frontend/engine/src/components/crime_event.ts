// packages/frontend/engine/src/components/crime_event.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// CrimeEvent — transient crime event entity for emergent consequence logic
//
// Contract C-191 AC-3: When a crime occurs (theft, assault, etc.), a short-lived
// CrimeEvent entity is spawned at the location. The GoapSchedulerSystem scans
// for witnesses (observers whose vision cones overlap the event) and triggers
// emergent reactions — protectors become hostile, civilians flee, guards pursue.
//
// CrimeEvent entities are auto-removed after one tick (processed and consumed).
// ---------------------------------------------------------------------------

/** SoA storage for crime event data. */
export const CrimeEvent = {
  /** Entity ID of the victim. */
  victimEid: [] as number[],
  /** Entity ID of the perpetrator. */
  perpetratorEid: [] as number[],
  /** Grid X coordinate where the crime occurred. */
  gridX: [] as number[],
  /** Grid Y coordinate where the crime occurred. */
  gridY: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type CrimeEventData = {
  victimEid: number;
  perpetratorEid: number;
  gridX: number;
  gridY: number;
};

/**
 * Registers onSet and onGet observers for the CrimeEvent component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerCrimeEventObservers = (world: World): void => {
  observe(world, onSet(CrimeEvent), (eid: number, params: CrimeEventData) => {
    CrimeEvent.victimEid[eid] = params.victimEid;
    CrimeEvent.perpetratorEid[eid] = params.perpetratorEid;
    CrimeEvent.gridX[eid] = params.gridX;
    CrimeEvent.gridY[eid] = params.gridY;
  });

  observe(
    world,
    onGet(CrimeEvent),
    (eid: number): CrimeEventData => ({
      victimEid: CrimeEvent.victimEid[eid],
      perpetratorEid: CrimeEvent.perpetratorEid[eid],
      gridX: CrimeEvent.gridX[eid],
      gridY: CrimeEvent.gridY[eid],
    }),
  );
};
