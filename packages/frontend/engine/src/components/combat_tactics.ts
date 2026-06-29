// packages/frontend/engine/src/components/combat_tactics.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// CombatTactics — SoA component for tactical combat decision state
//
// Contract C-197: Stores the enemy combat AI's active target selection,
// tactical action plan, and operational range preferences. Used by the
// GoapCombatTacticsSystem to drive adaptive combat behavior without
// per-frame object allocations.
//
// All arrays are Uint32Arrays for monomorphic access patterns that keep
// TurboFan optimizations intact.
// ---------------------------------------------------------------------------

/** SoA storage for tactical combat state. Indexed by entity ID. */
export const CombatTactics = {
  /** Active target entity ID (0 = no target). */
  threatTargetEid: [] as number[],
  /** Currently selected tactical action bitmask (references CombatStateBit). */
  tacticalActionMask: [] as number[],
  /** Ideal operational grid spacing in cells for this combatant. */
  preferredRange: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type CombatTacticsData = {
  threatTargetEid: number;
  tacticalActionMask: number;
  preferredRange: number;
};

/**
 * Registers onSet and onGet observers for the CombatTactics component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerCombatTacticsObservers = (world: World): void => {
  observe(world, onSet(CombatTactics), (eid: number, params: CombatTacticsData) => {
    CombatTactics.threatTargetEid[eid] = params.threatTargetEid;
    CombatTactics.tacticalActionMask[eid] = params.tacticalActionMask;
    CombatTactics.preferredRange[eid] = params.preferredRange;
  });

  observe(
    world,
    onGet(CombatTactics),
    (eid: number): CombatTacticsData => ({
      threatTargetEid: CombatTactics.threatTargetEid[eid],
      tacticalActionMask: CombatTactics.tacticalActionMask[eid],
      preferredRange: CombatTactics.preferredRange[eid],
    }),
  );
};
