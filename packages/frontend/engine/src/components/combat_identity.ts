// packages/frontend/engine/src/components/combat_identity.ts
//
// CombatIdentity — stable, non-ECS combat identity.
//
// bitECS recycles entity ids, so a raw `eid` can never be a persistent combat
// identity. This component carries the authored/encounter id
// (`Enemy.spawnId` / `Enemy.encounterId` / `Companion.npcId`, or the
// caller-supplied player combatant id) that the combat adapter maps to the
// current runtime entity id.
//
// Deliberately NOT part of `PERSISTENT_COMPONENTS` (see
// `serialization/ecs_serializer.ts`) — the ECS snapshot wire format and
// `CURRENT_SNAPSHOT_VERSION` are unchanged in Combat-01.
//
// Contract: C-509 AC-3

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// CombatIdentity — SoA component
// ---------------------------------------------------------------------------

/** SoA storage for stable combatant identities. Indexed by entity ID. */
export const CombatIdentity = {
  /** Stable authored/encounter combatant id — never a raw entity id. */
  combatantId: [] as string[],
};

/** Payload shape stored/retrieved via observers. */
export type CombatIdentityData = {
  combatantId: string;
};

/**
 * Registers onSet and onGet observers for the CombatIdentity component on the
 * given world. Must be called once per world before any entity uses it.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerCombatIdentityObservers = (world: World): void => {
  observe(world, onSet(CombatIdentity), (eid: number, params: Partial<CombatIdentityData>) => {
    if (params.combatantId !== undefined) {
      CombatIdentity.combatantId[eid] = params.combatantId;
    }
  });

  observe(
    world,
    onGet(CombatIdentity),
    (eid: number): CombatIdentityData => ({
      combatantId: CombatIdentity.combatantId[eid] ?? '',
    }),
  );
};
