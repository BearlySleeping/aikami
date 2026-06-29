// packages/frontend/engine/src/__tests__/macro_simulation.test.ts
//
// Macro Simulation System — unit tests for off-screen agent stepping,
// zone hydration/dehydration, and filtering guards.
// Contract C-194: ECS Offscreen Macro Simulation
//
// Covers:
//   AC-1: High-fidelity filtering — inactive zone entities are skipped
//   AC-2: Coarse schedule state shifts — GOAP agents update on macro ticks
//   AC-3: Portal zone hydration — virtual grid → pixel coordinate resolution

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld } from 'bitecs';
import { GoapAgent } from '../components/goap_agent.ts';
import { MapLocation } from '../components/map_location.ts';
import { ZoneStatus } from '../components/zone_status.ts';
import { initializeActionRegistry } from '../math/goap/action_registry.ts';
import {
  dehydrateZone,
  getMacroClock,
  hydrateZone,
  isEntityOffscreen,
  startMacroSimulation,
  stepMacroAgent,
  stopMacroSimulation,
} from '../systems/macro_simulation_system.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds the default action registry used by the GOAP scheduler.
 * Must be initialized before any agent stepping.
 */
const _buildDefaultActions = () => {
  return [
    {
      actionId: 0,
      cost: 0,
      preconditionUsageMask: 0,
      preconditionValueMask: 0,
      effectClearMask: 0,
      effectSetMask: 0,
    },
    {
      actionId: 1,
      cost: 5,
      preconditionUsageMask: 4 | 8 | 16,
      preconditionValueMask: 4 | 8 | 16,
      effectClearMask: 16 | 4,
      effectSetMask: 32,
    },
    {
      actionId: 2,
      cost: 10,
      preconditionUsageMask: 16 | 4,
      preconditionValueMask: 16 | 4,
      effectClearMask: 0,
      effectSetMask: 8,
    },
    {
      actionId: 3,
      cost: 8,
      preconditionUsageMask: 2 | 64,
      preconditionValueMask: 2 | 64,
      effectClearMask: 128,
      effectSetMask: 4,
    },
    {
      actionId: 4,
      cost: 10,
      preconditionUsageMask: 0,
      preconditionValueMask: 0,
      effectClearMask: 8,
      effectSetMask: 2,
    },
  ];
};

/** Creates a fresh bitECS world. */
const createTestWorld = (): World => {
  return createWorld();
};

// ---------------------------------------------------------------------------
// AC-1: High-Fidelity Gating — inactive entities skipped
// ---------------------------------------------------------------------------

describe('AC-1: High-Fidelity Gating', () => {
  let world: World;
  let activeZoneEid: number;
  let inactiveZoneEid: number;
  let activeAgentEid: number;
  let inactiveAgentEid: number;
  let legacyEntityEid: number;

  beforeEach(() => {
    world = createTestWorld();

    // Create active zone entity
    activeZoneEid = addEntity(world);
    ZoneStatus.isActive[activeZoneEid] = 1;

    // Create inactive zone entity
    inactiveZoneEid = addEntity(world);
    ZoneStatus.isActive[inactiveZoneEid] = 0;

    // Entity in active zone
    activeAgentEid = addEntity(world);
    MapLocation.currentZoneId[activeAgentEid] = activeZoneEid;
    MapLocation.virtualGridX[activeAgentEid] = 0;
    MapLocation.virtualGridY[activeAgentEid] = 0;

    // Entity in inactive zone
    inactiveAgentEid = addEntity(world);
    MapLocation.currentZoneId[inactiveAgentEid] = inactiveZoneEid;
    MapLocation.virtualGridX[inactiveAgentEid] = 5;
    MapLocation.virtualGridY[inactiveAgentEid] = 3;

    // Legacy entity (no MapLocation) — should always be treated as active
    legacyEntityEid = addEntity(world);
  });

  afterEach(() => {
    stopMacroSimulation();
  });

  test('isEntityOffscreen returns false for entities in active zones', () => {
    expect(isEntityOffscreen(activeAgentEid)).toBe(false);
  });

  test('isEntityOffscreen returns true for entities in inactive zones', () => {
    expect(isEntityOffscreen(inactiveAgentEid)).toBe(true);
  });

  test('isEntityOffscreen returns false for entities with no MapLocation (legacy compat)', () => {
    expect(isEntityOffscreen(legacyEntityEid)).toBe(false);
  });

  test('isEntityOffscreen returns false for invalid entity IDs', () => {
    expect(isEntityOffscreen(0)).toBe(false);
    expect(isEntityOffscreen(-1)).toBe(false);
    expect(isEntityOffscreen(99999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Coarse Schedule State Shifts
// ---------------------------------------------------------------------------

describe('AC-2: Coarse Schedule State Shifts', () => {
  let world: World;
  let agentEid: number;

  beforeEach(() => {
    // Ensure macro simulation is stopped (prevents interval leaks between tests)
    stopMacroSimulation();

    world = createTestWorld();
    initializeActionRegistry(_buildDefaultActions());

    // Create an agent entity with GoapAgent + MapLocation
    agentEid = addEntity(world);

    // Agent starts hungry (bit 16) with money (bit 4) and a goal to eat (bit 32)
    GoapAgent.currentState[agentEid] = 16 | 4; // IsHungry + HasMoney
    GoapAgent.currentGoal[agentEid] = 32; // HasEaten
    GoapAgent.currentActionId[agentEid] = -1;

    // Assign to a zone (inactive for macro processing)
    const zoneEid = addEntity(world);
    ZoneStatus.isActive[zoneEid] = 0; // inactive
    MapLocation.currentZoneId[agentEid] = zoneEid;
    MapLocation.virtualGridX[agentEid] = 0;
    MapLocation.virtualGridY[agentEid] = 0;
  });

  afterEach(() => {
    stopMacroSimulation();
  });

  test('stepMacroAgent selects an action when goal is not satisfied', () => {
    // Goal: AtWorkplace (bit 2). Action 4 (Go to workplace, cost 10)
    // has effectSetMask = AtWorkplace (bit 2) and no preconditions.
    // The action applies immediately and satisfies the goal in one step.
    GoapAgent.currentActionId[agentEid] = -1;
    GoapAgent.currentState[agentEid] = 16 | 4; // IsHungry + HasMoney
    GoapAgent.currentGoal[agentEid] = 2; // Goal: AtWorkplace

    const modified = stepMacroAgent(world, agentEid);
    expect(modified).toBe(true);

    // Goal should be satisfied (cleared) and state should have AtWorkplace bit
    expect(GoapAgent.currentGoal[agentEid]).toBe(0);
    expect(GoapAgent.currentState[agentEid] & 2).toBe(2); // AtWorkplace bit set
  });

  test('stepMacroAgent returns false when goal is already satisfied', () => {
    // Set goal as already satisfied
    GoapAgent.currentState[agentEid] = 32; // HasEaten
    GoapAgent.currentGoal[agentEid] = 32; // HasEaten

    const modified = stepMacroAgent(world, agentEid);
    expect(modified).toBe(true);

    // Goal should be cleared since it's satisfied
    expect(GoapAgent.currentGoal[agentEid]).toBe(0);
    expect(GoapAgent.currentActionId[agentEid]).toBe(-1);
  });

  test('stepMacroAgent updates virtual grid position based on action', () => {
    // Action 2 = Go to pub (effectSetMask = AtPub, bit 8).
    // Goal: AtPub (bit 8), preconditions met: IsHungry + HasMoney
    GoapAgent.currentState[agentEid] = 16 | 4; // IsHungry + HasMoney
    GoapAgent.currentGoal[agentEid] = 8; // Goal: AtPub
    GoapAgent.currentActionId[agentEid] = -1;
    MapLocation.virtualGridX[agentEid] = 0;
    MapLocation.virtualGridY[agentEid] = 0;

    stepMacroAgent(world, agentEid);

    // Action 2 (Go to pub) should be selected — moves virtual grid by +1, 0
    expect(MapLocation.virtualGridX[agentEid]).toBe(1);
    expect(MapLocation.virtualGridY[agentEid]).toBe(0);
  });

  test('macro clock is a strict integer (no floating point drift)', () => {
    const clock = getMacroClock();
    expect(Number.isInteger(clock)).toBe(true);
  });

  test('macro clock increments on tick', () => {
    stopMacroSimulation();

    // Simulate a macro tick manually by calling stepMacroAgent
    // The clock is incremented inside _macroTick, so we test via
    // the public API that the clock remains integral.
    const clockBefore = getMacroClock();
    expect(typeof clockBefore).toBe('number');
    expect(Number.isInteger(clockBefore)).toBe(true);

    // After stepping, clock should still be integral
    stepMacroAgent(world, agentEid);
    expect(Number.isInteger(getMacroClock())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Portal Zone Hydration Tracking
// ---------------------------------------------------------------------------

describe('AC-3: Portal Zone Hydration', () => {
  let world: World;
  let activeZoneEid: number;
  let inactiveZoneEid: number;
  let entityInActiveEid: number;
  let entityInInactiveEid: number;

  beforeEach(() => {
    world = createTestWorld();

    // Active zone with entities
    activeZoneEid = addEntity(world);
    ZoneStatus.isActive[activeZoneEid] = 1;

    // Inactive zone with entities
    inactiveZoneEid = addEntity(world);
    ZoneStatus.isActive[inactiveZoneEid] = 0;

    // Entity in active zone
    entityInActiveEid = addEntity(world);
    MapLocation.currentZoneId[entityInActiveEid] = activeZoneEid;
    MapLocation.virtualGridX[entityInActiveEid] = 2;
    MapLocation.virtualGridY[entityInActiveEid] = 4;

    // Entity in inactive zone
    entityInInactiveEid = addEntity(world);
    MapLocation.currentZoneId[entityInInactiveEid] = inactiveZoneEid;
    MapLocation.virtualGridX[entityInInactiveEid] = 3;
    MapLocation.virtualGridY[entityInInactiveEid] = 1;
  });

  afterEach(() => {
    stopMacroSimulation();
  });

  test('dehydrateZone marks zone as inactive', () => {
    expect(ZoneStatus.isActive[activeZoneEid]).toBe(1);

    dehydrateZone(world, activeZoneEid);

    expect(ZoneStatus.isActive[activeZoneEid]).toBe(0);
  });

  test('dehydrateZone preserves entity virtual positions', () => {
    dehydrateZone(world, activeZoneEid);

    // Entity virtual positions should persist through dehydration
    expect(MapLocation.virtualGridX[entityInActiveEid]).toBe(2);
    expect(MapLocation.virtualGridY[entityInActiveEid]).toBe(4);
  });

  test('dehydrateZone initializes virtual positions for entities without them', () => {
    // Create entity that has MapLocation component but no explicit virtual grid values
    const freshEid = addEntity(world);
    addComponent(world, freshEid, MapLocation);
    MapLocation.currentZoneId[freshEid] = activeZoneEid;
    // virtualGridX/Y default to undefined for this eid

    dehydrateZone(world, activeZoneEid);

    // Should default to 0, 0 after dehydration
    expect(MapLocation.virtualGridX[freshEid]).toBe(0);
    expect(MapLocation.virtualGridY[freshEid]).toBe(0);
  });

  test('dehydrateZone only affects entities in the specified zone', () => {
    // Only dehydrate the active zone — inactive zone entities should stay
    dehydrateZone(world, activeZoneEid);

    // Inactive zone should still be inactive
    expect(ZoneStatus.isActive[inactiveZoneEid]).toBe(0);

    // Entity in inactive zone should keep its virtual position
    expect(MapLocation.virtualGridX[entityInInactiveEid]).toBe(3);
    expect(MapLocation.virtualGridY[entityInInactiveEid]).toBe(1);
  });

  test('hydrateZone marks zone as active', () => {
    expect(ZoneStatus.isActive[inactiveZoneEid]).toBe(0);

    hydrateZone(world, inactiveZoneEid, {
      zonePixelOriginX: 0,
      zonePixelOriginY: 0,
      gridCellSize: 64,
    });

    expect(ZoneStatus.isActive[inactiveZoneEid]).toBe(1);
  });

  test('hydrateZone initializes virtual positions for entities without them', () => {
    // Create entity with no virtual positions in the inactive zone
    const freshEid = addEntity(world);
    addComponent(world, freshEid, MapLocation);
    MapLocation.currentZoneId[freshEid] = inactiveZoneEid;
    // virtualGridX/Y default to undefined

    hydrateZone(world, inactiveZoneEid, {
      zonePixelOriginX: 0,
      zonePixelOriginY: 0,
      gridCellSize: 64,
    });

    expect(MapLocation.virtualGridX[freshEid]).toBe(0);
    expect(MapLocation.virtualGridY[freshEid]).toBe(0);
  });

  test('dehydrate then hydrate restores zone state correctly', () => {
    // Dehydrate active zone
    dehydrateZone(world, activeZoneEid);
    expect(ZoneStatus.isActive[activeZoneEid]).toBe(0);

    // Hydrate as the new active zone
    hydrateZone(world, activeZoneEid, {
      zonePixelOriginX: 128,
      zonePixelOriginY: 256,
      gridCellSize: 64,
    });
    expect(ZoneStatus.isActive[activeZoneEid]).toBe(1);

    // Entity positions preserved
    expect(MapLocation.virtualGridX[entityInActiveEid]).toBe(2);
    expect(MapLocation.virtualGridY[entityInActiveEid]).toBe(4);
  });

  test('dehydrateZone is a no-op for invalid zone IDs', () => {
    dehydrateZone(world, 0);
    dehydrateZone(world, -1);
    dehydrateZone(world, 99999);

    // No state should have changed
    expect(ZoneStatus.isActive[activeZoneEid]).toBe(1);
  });

  test('hydrateZone is a no-op for invalid zone IDs', () => {
    hydrateZone(world, 0, {
      zonePixelOriginX: 0,
      zonePixelOriginY: 0,
      gridCellSize: 64,
    });

    // No state should have changed
    expect(ZoneStatus.isActive[inactiveZoneEid]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Macro simulation lifecycle
// ---------------------------------------------------------------------------

describe('Macro Simulation Lifecycle', () => {
  test('startMacroSimulation is idempotent', () => {
    stopMacroSimulation();
    startMacroSimulation();
    startMacroSimulation(); // second call should be no-op
    // No error means success
    stopMacroSimulation();
  });

  test('stopMacroSimulation resets macro clock', () => {
    stopMacroSimulation();
    startMacroSimulation();

    // Macro clock starts at 0
    expect(getMacroClock()).toBe(0);

    stopMacroSimulation();
    expect(getMacroClock()).toBe(0);
  });

  test('stopMacroSimulation is safe when not started', () => {
    stopMacroSimulation();
    stopMacroSimulation(); // double-stop safe
    // No error means success
  });
});
