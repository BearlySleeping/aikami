// packages/frontend/engine/src/systems/goap_scheduler_system.ts

import type { World } from 'bitecs';
import { query, removeEntity } from 'bitecs';
import { CrimeEvent } from '../components/crime_event.ts';
import { FactionMember } from '../components/faction_member.ts';
import { GoapAgent } from '../components/goap_agent.ts';
import { GridPosition } from '../components/grid_position.ts';
import { VisionVisible } from '../components/vision_visible.ts';
import {
  applyEffects,
  evaluatePreconditions,
  getActionByIndex,
  initializeActionRegistry,
  type StaticActionDefinition,
  selectBestAction,
} from '../math/goap/action_registry.ts';
import { IsMemberOf } from '../math/goap/faction_relations.ts';
import { WorldStateBit } from '../math/goap/world_state_bits.ts';

// ---------------------------------------------------------------------------
// GoapSchedulerSystem — bitmask-driven GOAP planning + emergent consequences
//
// Contract C-191: Runs each tick inside the bitECS Web Worker. For each agent
// with a GoapAgent component:
//   1. Validates or clears stale actions (preconditions changed / goal met).
//   2. Selects the best action toward the current goal via bitwise evaluation.
//   3. Applies action effects to the agent's world state.
//
// Additionally processes CrimeEvent entities:
//   - Finds witnesses within vision range.
//   - Checks faction relations (IsProtectorOf).
//   - Triggers emergent hostility reactions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Default action registry
//
// Built once on first tick. Defines basic agent behaviors for townsfolk.
// ---------------------------------------------------------------------------

const _buildDefaultActions = (): StaticActionDefinition[] => {
  return [
    // ── Idle ────────────────────────────────────────────────
    {
      actionId: 0,
      cost: 0,
      preconditionUsageMask: 0,
      preconditionValueMask: 0,
      effectClearMask: 0,
      effectSetMask: 0,
    },

    // ── Eat at pub (requires money + at pub + hungry) ────────
    {
      actionId: 1,
      cost: 5,
      preconditionUsageMask: WorldStateBit.HasMoney | WorldStateBit.AtPub | WorldStateBit.IsHungry,
      preconditionValueMask: WorldStateBit.HasMoney | WorldStateBit.AtPub | WorldStateBit.IsHungry,
      effectClearMask: WorldStateBit.IsHungry | WorldStateBit.HasMoney,
      effectSetMask: WorldStateBit.HasEaten,
    },

    // ── Go to pub (when hungry and has money) ────────────────
    {
      actionId: 2,
      cost: 10,
      preconditionUsageMask: WorldStateBit.IsHungry | WorldStateBit.HasMoney,
      preconditionValueMask: WorldStateBit.IsHungry | WorldStateBit.HasMoney,
      effectClearMask: 0,
      effectSetMask: WorldStateBit.AtPub,
    },

    // ── Work (earn money when at workplace + has tools) ──────
    {
      actionId: 3,
      cost: 8,
      preconditionUsageMask: WorldStateBit.AtWorkplace | WorldStateBit.HasTools,
      preconditionValueMask: WorldStateBit.AtWorkplace | WorldStateBit.HasTools,
      effectClearMask: WorldStateBit.IsTired,
      effectSetMask: WorldStateBit.HasMoney,
    },

    // ── Go to workplace ──────────────────────────────────────
    {
      actionId: 4,
      cost: 10,
      preconditionUsageMask: 0,
      preconditionValueMask: 0,
      effectClearMask: WorldStateBit.AtPub,
      effectSetMask: WorldStateBit.AtWorkplace,
    },

    // ── Rest (when tired) ────────────────────────────────────
    {
      actionId: 5,
      cost: 3,
      preconditionUsageMask: WorldStateBit.IsTired,
      preconditionValueMask: WorldStateBit.IsTired,
      effectClearMask: WorldStateBit.IsTired,
      effectSetMask: WorldStateBit.TaskComplete,
    },

    // ── Flee (when hostile and has target) ───────────────────
    {
      actionId: 6,
      cost: 2,
      preconditionUsageMask:
        WorldStateBit.IsHostile | WorldStateBit.HasTarget | WorldStateBit.NeedsHealing,
      preconditionValueMask:
        WorldStateBit.IsHostile | WorldStateBit.HasTarget | WorldStateBit.NeedsHealing,
      effectClearMask: WorldStateBit.IsHostile | WorldStateBit.HasTarget,
      effectSetMask: WorldStateBit.IsFleeing,
    },

    // ── Pursue target (when hostile + has target) ────────────
    {
      actionId: 7,
      cost: 5,
      preconditionUsageMask: WorldStateBit.IsHostile | WorldStateBit.HasTarget,
      preconditionValueMask: WorldStateBit.IsHostile | WorldStateBit.HasTarget,
      effectClearMask: 0,
      effectSetMask: 0, // No state change — action is continuous (movement system handles it)
    },

    // ── Report crime (when witnessed crime) ──────────────────
    {
      actionId: 8,
      cost: 3,
      preconditionUsageMask: WorldStateBit.HasWitnessedCrime,
      preconditionValueMask: WorldStateBit.HasWitnessedCrime,
      effectClearMask: WorldStateBit.HasWitnessedCrime,
      effectSetMask: WorldStateBit.TaskComplete,
    },
  ];
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Whether the default action registry has been initialized. */
let _registryInitialized = false;

/**
 * Faction protection graph: maps protector faction → array of protected factions.
 *
 * Populated via {@link setFactionProtection}. Used by crime consequence logic
 * to determine if a witness should react to a crime against a protected faction.
 */
const _factionProtections = new Map<number, number[]>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ticks the GOAP scheduler for one frame.
 *
 * Phase 1: Ensure the default action registry is built.
 * Phase 2: For each GoapAgent, validate/select/apply actions.
 * Phase 3: Process CrimeEvent entities for emergent consequences.
 *
 * @param world - The bitECS world.
 */
export const updateGoapScheduler = (world: World): void => {
  // ── Phase 1: Initialize registry ──
  if (!_registryInitialized) {
    initializeActionRegistry(_buildDefaultActions());
    _registryInitialized = true;
  }

  // ── Phase 2: Process each agent ──
  for (const agentEid of query(world, [GoapAgent])) {
    _processAgent(agentEid);
  }

  // ── Phase 3: Process crime events ──
  _processCrimeEvents(world);
};

/**
 * Resets the action registry initialization flag.
 *
 * Useful for testing — forces the default registry to be rebuilt on next tick.
 */
export const resetGoapState = (): void => {
  _registryInitialized = false;
  _factionProtections.clear();
};

/**
 * Declares a protection relationship between two factions.
 *
 * When a member of `protectorFaction` witnesses a crime against a member of
 * `protectedFaction`, they will become hostile to the perpetrator.
 *
 * @param protectorFaction - The faction that protects.
 * @param protectedFaction - The faction being protected.
 */
export const setFactionProtection = (protectorFaction: number, protectedFaction: number): void => {
  const existing = _factionProtections.get(protectorFaction);
  if (existing) {
    if (!existing.includes(protectedFaction)) {
      existing.push(protectedFaction);
    }
  } else {
    _factionProtections.set(protectorFaction, [protectedFaction]);
  }
};

// ---------------------------------------------------------------------------
// Internal: Agent processing
// ---------------------------------------------------------------------------

/**
 * Processes a single agent: validates current action, selects new action
 * if needed, and applies effects.
 *
 * @param agentEid - The entity ID of the agent.
 */
const _processAgent = (agentEid: number): void => {
  const currentState = GoapAgent.currentState[agentEid] ?? 0;
  const currentGoal = GoapAgent.currentGoal[agentEid] ?? 0;
  let currentActionId = GoapAgent.currentActionId[agentEid] ?? -1;

  // ── Check if current action is still valid ──
  if (currentActionId >= 0) {
    const currentAction = getActionByIndex(currentActionId);

    // Invalidate if: action no longer exists, preconditions not met, or goal achieved
    if (!currentAction || !evaluatePreconditions(currentState, currentAction)) {
      currentActionId = -1;
    }
  }

  // ── Check if goal is already satisfied (independent of action) ──
  if (currentGoal !== 0 && (currentState & currentGoal) === currentGoal) {
    GoapAgent.currentGoal[agentEid] = 0;
    GoapAgent.currentActionId[agentEid] = -1;
    return;
  }

  // ── Select new action ──
  if (currentActionId < 0 && currentGoal !== 0) {
    currentActionId = selectBestAction(currentState, currentGoal);
    // If the best action makes zero progress (score 0), don't bother — stay idle
    if (currentActionId >= 0) {
      const selectedAction = getActionByIndex(currentActionId);
      if (selectedAction) {
        const goalBitsSet = selectedAction.effectSetMask & currentGoal;
        const alreadySet = currentState & goalBitsSet;
        const newBits = goalBitsSet & ~alreadySet;
        if (newBits === 0) {
          currentActionId = -1; // Zero progress — stay idle
        }
      }
    }
  }

  // ── Apply effects ──
  if (currentActionId >= 0) {
    const selectedAction = getActionByIndex(currentActionId);
    if (selectedAction) {
      const newState = applyEffects(currentState, selectedAction);

      GoapAgent.currentState[agentEid] = newState;
      GoapAgent.currentActionId[agentEid] = currentActionId;

      // If goal is now satisfied, clear it
      if ((newState & currentGoal) === currentGoal && currentGoal !== 0) {
        GoapAgent.currentGoal[agentEid] = 0;
        GoapAgent.currentActionId[agentEid] = -1;
      }
    }
  } else {
    GoapAgent.currentActionId[agentEid] = -1;
  }
};

// ---------------------------------------------------------------------------
// Internal: Crime event processing (AC-3)
// ---------------------------------------------------------------------------

/**
 * Processes all CrimeEvent entities for emergent consequence reactions.
 *
 * For each crime event:
 * 1. Finds witnesses — entities with VisionVisible that saw the event location.
 * 2. For each witness, checks if they are a protector of the victim's faction.
 * 3. If protector: marks witness as hostile, caches perpetrator as target,
 *    clears old behavioral loops.
 * 4. Removes the CrimeEvent entity after processing.
 *
 * @param world - The bitECS world.
 */
const _processCrimeEvents = (world: World): void => {
  // Collect crime events first (removing while iterating is unsafe)
  const crimeEids = [...query(world, [CrimeEvent])];
  if (crimeEids.length === 0) {
    return;
  }

  for (const crimeEid of crimeEids) {
    const victimEid = CrimeEvent.victimEid[crimeEid] ?? 0;
    const perpetratorEid = CrimeEvent.perpetratorEid[crimeEid] ?? 0;
    const crimeGx = CrimeEvent.gridX[crimeEid] ?? 0;
    const crimeGy = CrimeEvent.gridY[crimeEid] ?? 0;

    if (victimEid === 0 || perpetratorEid === 0) {
      removeEntity(world, crimeEid);
      continue;
    }

    // ── Find witnesses at the crime location ──
    //
    // A witness is any entity with GoapAgent whose VisionVisible includes
    // the crime grid cell. We check via GridPosition proximity to the crime.
    const witnesses = _findWitnesses(crimeGx, crimeGy);

    for (const witnessEid of witnesses) {
      // Skip if witness is the perpetrator or victim
      if (witnessEid === perpetratorEid || witnessEid === victimEid) {
        continue;
      }

      // ── Check protector relationship ──
      //
      // Query: is there an IsProtectorOf(factionEid) on the witness such that
      // the victim IsMemberOf(factionEid)?
      const protectorFactions = _getProtectorFactions(world, witnessEid);
      const victimFactions = _getMemberFactions(world, victimEid);

      const isProtector = protectorFactions.some((pf) => victimFactions.includes(pf));

      if (!isProtector) {
        continue;
      }

      // ── Emergent reaction: witness becomes hostile ──
      //
      // The witness (protector) sees a crime against their protected faction.
      // Immediate response: set IsHostile, cache perpetrator as target.
      const currentState = GoapAgent.currentState[witnessEid] ?? 0;
      const newState =
        currentState |
        WorldStateBit.IsHostile |
        WorldStateBit.HasWitnessedCrime |
        WorldStateBit.HasTarget;

      GoapAgent.currentState[witnessEid] = newState;
      GoapAgent.targetEntityId[witnessEid] = perpetratorEid;

      // Drop old behavioral loops — clear any stale action
      GoapAgent.currentActionId[witnessEid] = -1;

      // Set new goal: pursue/confront the perpetrator
      GoapAgent.currentGoal[witnessEid] = WorldStateBit.IsHostile | WorldStateBit.HasTarget;
    }

    // Crime event consumed — remove after processing
    removeEntity(world, crimeEid);
  }
};

// ---------------------------------------------------------------------------
// Internal: Witness detection
// ---------------------------------------------------------------------------

/**
 * Finds all witness entities at the given grid location.
 *
 * A witness must have GoapAgent, GridPosition, and VisionVisible.
 * Only entities whose VisionVisible.visibleByMask is non-zero (seen by someone)
 * and whose grid position matches are considered witnesses.
 *
 * @param gx - Grid X of the crime.
 * @param gy - Grid Y of the crime.
 * @returns Array of witness entity IDs.
 */
const _findWitnesses = (gx: number, gy: number): number[] => {
  const witnesses: number[] = [];

  // Scan GoapAgent as the sparse marker — only agents can be witnesses
  const count = GoapAgent.currentState.length;
  for (let eid = 0; eid < count; eid++) {
    if (GoapAgent.currentState[eid] === undefined) {
      continue;
    }

    const gridX = GridPosition.x[eid];
    const gridY = GridPosition.y[eid];
    if (gridX === undefined || gridY === undefined) {
      continue;
    }

    // Witness must be at or adjacent to the crime location
    const dx = Math.abs(gridX - gx);
    const dy = Math.abs(gridY - gy);
    if (dx > 1 || dy > 1) {
      continue;
    }

    // Must have vision (visibleByMask registered)
    if (VisionVisible.visibleByMask[eid] === undefined) {
      continue;
    }

    witnesses.push(eid);
  }

  return witnesses;
};

// ---------------------------------------------------------------------------
// Internal: Faction relation queries
// ---------------------------------------------------------------------------

/**
 * Gets all faction IDs that the witness protects.
 *
 * Checks the faction protection graph for matches with the witness's
 * own faction memberships.
 *
 * @param world - The bitECS world.
 * @param eid - The witness entity ID.
 * @returns Array of faction enum IDs that this entity protects.
 */
const _getProtectorFactions = (world: World, eid: number): number[] => {
  // Get the witness's own faction memberships (as Faction enum IDs)
  const memberFactionIds = _getMemberFactionIds(world, eid);
  const protectedFactionIds: number[] = [];

  for (const factionId of memberFactionIds) {
    const protections = _factionProtections.get(factionId);
    if (protections) {
      protectedFactionIds.push(...protections);
    }
  }

  return protectedFactionIds;
};

/**
 * Gets all faction enum IDs that the given entity belongs to.
 *
 * Queries all FactionMember entities, checks IsMemberOf relations,
 * and returns their FactionMember.factionId values.
 *
 * @param world - The bitECS world.
 * @param eid - The entity to check.
 * @returns Array of Faction enum IDs (e.g., Faction.Guard = 1).
 */
const _getMemberFactionIds = (world: World, eid: number): number[] => {
  const factionIds: number[] = [];

  // Find all faction entities
  for (const factionEid of query(world, [FactionMember])) {
    if (_hasIsMemberOfRelation(world, eid, factionEid)) {
      const fid = FactionMember.factionId[factionEid];
      if (fid !== undefined) {
        factionIds.push(fid);
      }
    }
  }

  return factionIds;
};

/**
 * Gets all faction entity IDs that the victim belongs to (for legacy API).
 *
 * @param world - The bitECS world.
 * @param eid - The victim entity ID.
 * @returns Array of faction enum IDs.
 */
const _getMemberFactions = (world: World, eid: number): number[] => {
  return _getMemberFactionIds(world, eid);
};

/**
 * Checks if an entity has an IsMemberOf relation to a specific faction.
 *
 * Uses bitECS query to find all entities with the relation to the target.
 *
 * @param world - The bitECS world.
 * @param eid - The entity to check.
 * @param factionEid - The faction entity ID.
 * @returns `true` if the entity is a member of the faction.
 */
const _hasIsMemberOfRelation = (world: World, eid: number, factionEid: number): boolean => {
  // Query all entities that have IsMemberOf(factionEid)
  for (const memberEid of query(world, [IsMemberOf(factionEid)])) {
    if (memberEid === eid) {
      return true;
    }
  }
  return false;
};
