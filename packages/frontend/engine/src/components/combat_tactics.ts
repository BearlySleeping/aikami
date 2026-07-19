// packages/frontend/engine/src/components/combat_tactics.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// CombatRole — enemy combat AI archetype
// Contract: C-338 Deepen Turn-Based Combat (AC-4 enemy AI roles)
// ---------------------------------------------------------------------------

/**
 * Enemy combat role determining tactical AI behavior.
 * - rusher: closes distance aggressively, high threat, melee-focused
 * - sniper: maintains range, ranged attacks, avoids melee
 * - support: heals/buffs allies, debuffs enemies, stays at mid-range
 * - boss: varied pattern, higher stats, multi-phase behavior
 * - generic: default behavior, no role-specific AI
 */
export type CombatRole = 'rusher' | 'sniper' | 'support' | 'boss' | 'generic';

/** CombatRole indexed by entity ID. */
export const combatRoleToIndex: Record<CombatRole, number> = {
  rusher: 0,
  sniper: 1,
  support: 2,
  boss: 3,
  generic: 4,
};

/** Reverse index: number → CombatRole string. */
export const combatRoleFromIndex: CombatRole[] = ['rusher', 'sniper', 'support', 'boss', 'generic'];

// ---------------------------------------------------------------------------
// CombatTactics — SoA component for tactical combat decision state
//
// Contract C-197: Stores the enemy combat AI's active target selection,
// tactical action plan, and operational range preferences. Used by the
// GoapCombatTacticsSystem to drive adaptive combat behavior without
// per-frame object allocations.
//
// Contract C-338: Extended with combatRole for role-based enemy AI.
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
  /** Combat role index (0–4, default = 4 = generic). C-338. */
  combatRole: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type CombatTacticsData = {
  threatTargetEid: number;
  tacticalActionMask: number;
  preferredRange: number;
  combatRole?: CombatRole;
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
    CombatTactics.combatRole[eid] =
      params.combatRole !== undefined ? combatRoleToIndex[params.combatRole] : 4;
  });

  observe(world, onGet(CombatTactics), (eid: number): CombatTacticsData => {
    const roleIdx = CombatTactics.combatRole[eid] ?? 4;
    return {
      threatTargetEid: CombatTactics.threatTargetEid[eid],
      tacticalActionMask: CombatTactics.tacticalActionMask[eid],
      preferredRange: CombatTactics.preferredRange[eid],
      combatRole: combatRoleFromIndex[roleIdx] ?? 'generic',
    };
  });
};
