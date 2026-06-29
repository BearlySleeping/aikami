// packages/frontend/engine/src/components/faction_member.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// FactionMember — marks an entity as a faction group leader
//
// Contract C-191 AC-2: Faction entities are simple tags with a factionId.
// Other entities join factions via the IsMemberOf(factionEid) bitECS relation.
// This component marks the faction entity itself with metadata.
//
// Faction entities are lightweight — they exist primarily as targets for
// IsMemberOf, IsHostileTo, and IsProtectorOf relation components.
// ---------------------------------------------------------------------------

/** SoA storage for faction metadata. */
export const FactionMember = {
  /** Faction identifier (matches Faction enum values). */
  factionId: [] as number[],
  /** Display name of the faction. */
  name: [] as string[],
};

/** Payload shape stored/retrieved via observers. */
export type FactionMemberData = {
  factionId: number;
  name: string;
};

/**
 * Registers onSet and onGet observers for the FactionMember component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerFactionMemberObservers = (world: World): void => {
  observe(world, onSet(FactionMember), (eid: number, params: FactionMemberData) => {
    FactionMember.factionId[eid] = params.factionId;
    FactionMember.name[eid] = params.name;
  });

  observe(
    world,
    onGet(FactionMember),
    (eid: number): FactionMemberData => ({
      factionId: FactionMember.factionId[eid],
      name: FactionMember.name[eid],
    }),
  );
};
