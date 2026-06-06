// packages/frontend/engine/src/systems/turn_manager_system.ts
import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import type { TurnOrderData } from '../components/turn_order.ts';
import { TurnOrder } from '../components/turn_order.ts';
import type { EngineBridge } from '../engine_bridge.ts';

// ---------------------------------------------------------------------------
// TurnManagerSystem — turn-based combat sequencing
//
// Manages turn progression for combat encounters. Sorts participants by
// initiative, advances turns on demand, and emits TURN_CHANGED / COMBAT_ENDED
// events through the EngineBridge.
//
// Designed to run in the Web Worker alongside other game systems. Uses
// direct SoA array mutation for performance — no observer overhead per frame.
// ---------------------------------------------------------------------------

/** Cached query terms for active combat participants. */
const COMBAT_QUERY_TERMS = [CombatStats, TurnOrder];

/**
 * Ordered list of entity IDs sorted by initiative (highest first).
 * Populated during initCombat and maintained across turn advances.
 * Package-private — exposed only for test resets.
 */
let turnOrderList: number[] = [];

/**
 * Index into turnOrderList pointing at the current active entity.
 * Package-private — exposed only for test resets.
 */
let currentTurnIndex = -1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initializes a combat encounter.
 *
 * Sorts all entities that have both CombatStats and TurnOrder components
 * by initiative (highest first), marks the first entity as having the
 * current turn, and emits COMBAT_STARTED through the bridge.
 *
 * Idempotent — if combat is already initialized (turnOrderList is non-empty),
 * this is a no-op.
 *
 * @param world - The bitECS world.
 * @param bridge - The EngineBridge for emitting events.
 */
const initCombat = (world: World, bridge: EngineBridge): void => {
  if (!world || !bridge) {
    return;
  }

  if (turnOrderList.length > 0) {
    return;
  }

  // Gather all combat-capable entities
  const participantIds: number[] = [];
  for (const eid of query(world, COMBAT_QUERY_TERMS)) {
    const turnOrder = getComponent(world, eid, TurnOrder) as TurnOrderData | undefined;
    if (!turnOrder?.isActive) {
      continue;
    }
    participantIds.push(eid);
  }

  if (participantIds.length === 0) {
    return;
  }

  // Sort by initiative — highest first
  const sorted = [...participantIds].sort((a, b) => {
    const aData = getComponent(world, a, TurnOrder) as TurnOrderData | undefined;
    const bData = getComponent(world, b, TurnOrder) as TurnOrderData | undefined;
    return (bData?.initiativeValue ?? 0) - (aData?.initiativeValue ?? 0);
  });

  turnOrderList = sorted;
  currentTurnIndex = 0;

  // Mark the first entity as having the current turn
  const firstId = turnOrderList[0];
  if (firstId !== undefined && firstId > 0) {
    TurnOrder.currentTurn[firstId] = true;
  }

  bridge.emit({
    type: 'COMBAT_STARTED',
    participantIds: [...turnOrderList],
    firstTurnEntityId: firstId ?? 0,
  });
};

/**
 * Advances the turn to the next active combat participant.
 *
 * Clears the current turn flag on the current entity, finds the next
 * active (alive) entity in initiative order, and marks it as the current
 * turn. Emits TURN_CHANGED through the bridge.
 *
 * If no more active entities remain (all dead), emits COMBAT_ENDED with
 * victory = false and resets tracking state.
 *
 * Must be called after initCombat. Safe to call when combat is not
 * initialized — returns silently.
 *
 * @param world - The bitECS world.
 * @param bridge - The EngineBridge for emitting events.
 */
const advanceTurn = (world: World, bridge: EngineBridge): void => {
  if (!world || !bridge) {
    return;
  }

  if (turnOrderList.length === 0 || currentTurnIndex < 0) {
    return;
  }

  // Clear current turn on the outgoing entity
  const outgoingId = turnOrderList[currentTurnIndex];
  if (outgoingId !== undefined && outgoingId > 0) {
    TurnOrder.currentTurn[outgoingId] = false;
  }

  // Find next active entity — wrap around if needed
  const startIndex = currentTurnIndex;
  let found = false;
  for (let attempt = 0; attempt < turnOrderList.length; attempt++) {
    currentTurnIndex = (currentTurnIndex + 1) % turnOrderList.length;
    const candidateId = turnOrderList[currentTurnIndex];
    if (candidateId === undefined || candidateId <= 0) {
      continue;
    }

    // Check if this entity is still alive (health > 0)
    const stats = getComponent(world, candidateId, CombatStats) as CombatStatsData | undefined;
    if (stats && stats.health > 0) {
      TurnOrder.currentTurn[candidateId] = true;
      found = true;
      break;
    }

    // If we've wrapped around to where we started and found nothing,
    // all entities are dead.
    if (currentTurnIndex === startIndex) {
      break;
    }
  }

  if (!found) {
    // All entities are dead — combat ends
    bridge.emit({ type: 'COMBAT_ENDED', victory: false });
    turnOrderList = [];
    currentTurnIndex = -1;
    return;
  }

  // Emit the turn change event
  const activeIds = getActiveParticipantIds(world);
  const currentId = turnOrderList[currentTurnIndex];
  bridge.emit({
    type: 'TURN_CHANGED',
    currentEntityId: currentId ?? 0,
    activeEntities: activeIds,
  });
};

/**
 * Ends the current combat encounter.
 *
 * Clears all turn state and emits COMBAT_ENDED through the bridge.
 * Safe to call when no combat is active — returns silently.
 *
 * @param bridge - The EngineBridge for emitting events.
 * @param victory - Whether the player's party won (default: false).
 */
const endCombat = (bridge: EngineBridge, victory: boolean = false): void => {
  if (!bridge) {
    return;
  }

  // Clear current turn flag on the active entity
  if (currentTurnIndex >= 0 && currentTurnIndex < turnOrderList.length) {
    const currentId = turnOrderList[currentTurnIndex];
    if (currentId !== undefined && currentId > 0) {
      TurnOrder.currentTurn[currentId] = false;
    }
  }

  bridge.emit({ type: 'COMBAT_ENDED', victory });
  turnOrderList = [];
  currentTurnIndex = -1;
};

/**
 * Resets all module-level turn tracking state.
 *
 * Use in test teardown (afterEach) to ensure clean state between tests.
 * Does NOT emit any bridge events — purely resets internal tracking arrays.
 */
const resetTurnTracking = (): void => {
  turnOrderList = [];
  currentTurnIndex = -1;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the list of entity IDs currently alive and participating in combat.
 *
 * Filters the full turnOrderList to only entities with health > 0.
 *
 * @param world - The bitECS world.
 * @returns Array of active entity IDs.
 */
const getActiveParticipantIds = (world: World): number[] => {
  const active: number[] = [];
  for (const eid of turnOrderList) {
    const stats = getComponent(world, eid, CombatStats) as CombatStatsData | undefined;
    if (stats && stats.health > 0) {
      active.push(eid);
    }
  }
  return active;
};

export { advanceTurn, endCombat, initCombat, resetTurnTracking };
