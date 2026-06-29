// packages/frontend/engine/src/systems/macro_simulation_system.ts
import type { World } from 'bitecs';
import { query } from 'bitecs';
import { GoapAgent } from '../components/goap_agent.ts';
import { MapLocation } from '../components/map_location.ts';
import { ZoneStatus } from '../components/zone_status.ts';
import {
  applyEffects,
  evaluatePreconditions,
  getActionByIndex,
  selectBestAction,
} from '../math/goap/action_registry.ts';

// ---------------------------------------------------------------------------
// MacroSimulationSystem — coarse time-gate simulation for inactive zones
//
// Contract C-194: Entities in inactive zones bypass per-frame physics.
// Instead, their GOAP planners update on low-frequency macro time ticks,
// and their virtual grid positions are updated to represent coarse sector
// movement. This prevents inactive entities from consuming thread budget
// on high-fidelity systems.
//
// Architecture:
//   1. Low-frequency tick loop (macroIntervalMs) runs independently of
//      the per-frame tick.
//   2. For each inactive entity (MapLocation + GoapAgent, zone not active):
//      a. Steps GOAP agent state (one action evaluation per macro tick).
//      b. Updates virtualGridX/Y based on action type and sector layout.
//   3. Macro clock tracks coarse world time in integer ticks — no floating
//      point drift (see Watch Points).
//   4. Zone hydration (AC-3) resolves virtual coords → real pixel coords
//      when the entity's zone becomes active.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Macro clock
// ---------------------------------------------------------------------------

/**
 * Macro time counter — strict integer ticks to avoid floating drift on
 * macro clock boundaries (C-194 Watch Point).
 *
 * Incremented by 1 on each macro tick. Represents coarse world time
 * where 1 macro tick ≈ {@link MACRO_INTERVAL_MS} of real time.
 */
let _macroClock = 0;

/** Interval between macro simulation ticks in milliseconds. */
const MACRO_INTERVAL_MS = 500;

/** Whether the macro tick loop has been started (idempotent guard). */
let _macroIntervalId: ReturnType<typeof setInterval> | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Starts the macro simulation tick loop.
 *
 * Idempotent — subsequent calls are no-ops if already running.
 * Runs independently of the per-frame tick loop at {@link MACRO_INTERVAL_MS}.
 */
export const startMacroSimulation = (): void => {
  if (_macroIntervalId !== undefined) {
    return;
  }
  _macroIntervalId = setInterval(() => {
    _macroTick();
  }, MACRO_INTERVAL_MS);
};

/**
 * Stops the macro simulation tick loop.
 *
 * Clears the interval and resets the macro clock.
 */
export const stopMacroSimulation = (): void => {
  if (_macroIntervalId !== undefined) {
    clearInterval(_macroIntervalId);
    _macroIntervalId = undefined;
  }
  _macroClock = 0;
};

/**
 * Returns the current macro clock value.
 *
 * Represents the number of macro ticks elapsed since simulation start.
 * Always an integer to prevent floating point drift on clock boundaries.
 */
export const getMacroClock = (): number => {
  return _macroClock;
};

/**
 * Returns true if an entity is in an inactive zone and should be
 * processed by the macro scheduler instead of real-time systems.
 *
 * @param eid - The entity ID to check.
 * @returns `true` if the entity is offline (inactive zone or no zone).
 */
export const isEntityOffscreen = (eid: number): boolean => {
  const zoneEid = MapLocation.currentZoneId[eid];
  if (zoneEid === undefined || zoneEid === 0) {
    return false; // No zone assignment = active (legacy compat)
  }
  return ZoneStatus.isActive[zoneEid] !== 1;
};

// ---------------------------------------------------------------------------
// Macro agent stepping
// ---------------------------------------------------------------------------

/**
 * Runs one macro simulation step for a single inactive agent.
 *
 * Steps the GOAP scheduler (one action evaluation), applies effects,
 * and updates the entity's virtual grid position based on the action.
 *
 * Operates directly on SoA arrays — the `world` parameter is accepted
 * for interface consistency but the macro scheduler scans global arrays
 * since the worker owns a single world instance.
 *
 * @param _world - The bitECS world (unused, for interface consistency).
 * @param eid - The entity ID of the inactive agent.
 * @returns `true` if the agent's state was modified.
 */
export const stepMacroAgent = (_world: World, eid: number): boolean => {
  const currentState = GoapAgent.currentState[eid] ?? 0;
  const currentGoal = GoapAgent.currentGoal[eid] ?? 0;
  let currentActionId = GoapAgent.currentActionId[eid] ?? -1;

  // ── Validate or clear stale action ──
  if (currentActionId >= 0) {
    const currentAction = getActionByIndex(currentActionId);
    if (!currentAction || !evaluatePreconditions(currentState, currentAction)) {
      currentActionId = -1;
    }
  }

  // ── Check if goal is already satisfied ──
  if (currentGoal !== 0 && (currentState & currentGoal) === currentGoal) {
    GoapAgent.currentGoal[eid] = 0;
    GoapAgent.currentActionId[eid] = -1;
    return true;
  }

  // ── Select new action ──
  if (currentActionId < 0 && currentGoal !== 0) {
    currentActionId = selectBestAction(currentState, currentGoal);
    if (currentActionId >= 0) {
      const selectedAction = getActionByIndex(currentActionId);
      if (selectedAction) {
        const goalBitsSet = selectedAction.effectSetMask & currentGoal;
        const alreadySet = currentState & goalBitsSet;
        const newBits = goalBitsSet & ~alreadySet;
        if (newBits === 0) {
          currentActionId = -1;
        }
      }
    }
  }

  // ── Apply effects and update virtual position ──
  if (currentActionId >= 0) {
    const selectedAction = getActionByIndex(currentActionId);
    if (selectedAction) {
      const newState = applyEffects(currentState, selectedAction);

      GoapAgent.currentState[eid] = newState;
      GoapAgent.currentActionId[eid] = currentActionId;

      // Update virtual grid position based on action type
      _updateVirtualPosition(eid, currentActionId);

      // If goal satisfied, clear it
      if ((newState & currentGoal) === currentGoal && currentGoal !== 0) {
        GoapAgent.currentGoal[eid] = 0;
        GoapAgent.currentActionId[eid] = -1;
      }
      return true;
    }
  }

  return false;
};

// ---------------------------------------------------------------------------
// Hydration pipeline (AC-3)
// ---------------------------------------------------------------------------

/**
 * Dehydrates all entities in the currently active zone.
 *
 * Called BEFORE the active zone ID changes during a map transition.
 * Marks the zone as inactive in ZoneStatus and preserves virtual grid
 * positions for all entities in the departing zone.
 *
 * Note: Full GridPosition→virtual sync is deferred to C-195
 * (string registry + persistence). For now, preserves existing values.
 *
 * @param world - The bitECS world.
 * @param zoneEid - The entity ID of the zone being deactivated.
 */
export const dehydrateZone = (world: World, zoneEid: number): void => {
  if (zoneEid <= 0) {
    return;
  }

  // Mark zone as inactive
  ZoneStatus.isActive[zoneEid] = 0;

  // Save virtual grid positions for all entities in this zone
  for (const eid of query(world, [MapLocation])) {
    if (MapLocation.currentZoneId[eid] === zoneEid) {
      // Preserve existing virtual positions or default to origin
      if (MapLocation.virtualGridX[eid] === undefined) {
        MapLocation.virtualGridX[eid] = 0;
      }
      if (MapLocation.virtualGridY[eid] === undefined) {
        MapLocation.virtualGridY[eid] = 0;
      }
    }
  }
};

/**
 * Hydrates entities from an inactive zone into the active world.
 *
 * Called AFTER the new zone becomes active. Marks the zone as active in
 * ZoneStatus. Virtual grid→pixel coordinate conversion is handled by the
 * caller (ecs_worker.ts LOAD_MAP) during entity spawn, since entities are
 * re-created during map transitions.
 *
 * @param world - The bitECS world.
 * @param zoneEid - The entity ID of the zone being activated.
 * @param _options - Hydration options (pixel origin + cell size).
 *   Reserved for future coordinate conversion (C-195).
 */
export const hydrateZone = (
  world: World,
  zoneEid: number,
  _options: {
    zonePixelOriginX: number;
    zonePixelOriginY: number;
    gridCellSize: number;
  },
): void => {
  if (zoneEid <= 0) {
    return;
  }

  // Mark zone as active — entities in this zone now run real-time systems
  ZoneStatus.isActive[zoneEid] = 1;

  // Verify all entities in this zone have valid virtual grid positions
  for (const eid of query(world, [MapLocation])) {
    if (MapLocation.currentZoneId[eid] === zoneEid) {
      if (MapLocation.virtualGridX[eid] === undefined) {
        MapLocation.virtualGridX[eid] = 0;
      }
      if (MapLocation.virtualGridY[eid] === undefined) {
        MapLocation.virtualGridY[eid] = 0;
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Internal: macro tick
// ---------------------------------------------------------------------------

/**
 * Runs one macro simulation tick — processes all inactive agents.
 *
 * Increments the macro clock (strict integer — no floating drift).
 * For each entity with MapLocation + GoapAgent whose zone is inactive,
 * steps the agent through one GOAP evaluation.
 */
const _macroTick = (): void => {
  _macroClock++;

  // Scan global SoA arrays directly — ecs_worker.ts owns the
  // single world instance. The GoapAgent component arrays serve
  // as the sparse marker for agent entities.
  const count = GoapAgent.currentState.length;
  for (let eid = 0; eid < count; eid++) {
    // Sparse check: only process entities that actually have GoapAgent
    if (GoapAgent.currentState[eid] === undefined) {
      continue;
    }

    // Only process entities in inactive zones
    const zoneEid = MapLocation.currentZoneId[eid];
    if (zoneEid === undefined || zoneEid === 0) {
      continue;
    }
    if (ZoneStatus.isActive[zoneEid] === 1) {
      continue; // Active zone — skip macro processing
    }

    // Step the agent (world param unused — we operate on global SoA arrays)
    stepMacroAgent(null as unknown as World, eid);
  }
};

// ---------------------------------------------------------------------------
// Internal: virtual position update
// ---------------------------------------------------------------------------

/**
 * Updates an entity's virtual grid position based on the current action.
 *
 * Different action types move the entity to different coarse sectors:
 *   - Action 2 (Go to pub) → moves toward pub sector (grid +1, +0)
 *   - Action 4 (Go to workplace) → moves toward work sector (grid -1, +0)
 *   - Action 6 (Flee) → moves away from center (grid ±1, ±1)
 *
 * This is a simplified sector movement model — full pathfinding across
 * sectors is deferred to C-195.
 *
 * @param eid - The entity ID.
 * @param actionId - The current action index from the action registry.
 */
const _updateVirtualPosition = (eid: number, actionId: number): void => {
  const currentX = MapLocation.virtualGridX[eid] ?? 0;
  const currentY = MapLocation.virtualGridY[eid] ?? 0;

  let dx = 0;
  let dy = 0;

  switch (actionId) {
    case 2: {
      // "Go to pub" — move east toward pub sector
      dx = 1;
      dy = 0;
      break;
    }
    case 4: {
      // "Go to workplace" — move west toward work sector
      dx = -1;
      dy = 0;
      break;
    }
    case 6: {
      // "Flee" — random diagonal movement away from threat
      dx = _macroClock % 2 === 0 ? 1 : -1;
      dy = _macroClock % 3 === 0 ? 1 : -1;
      break;
    }
    default: {
      // Idle / other actions — no movement
      break;
    }
  }

  MapLocation.virtualGridX[eid] = currentX + dx;
  MapLocation.virtualGridY[eid] = currentY + dy;
};
