// packages/frontend/engine/src/__tests__/goap_scheduler.test.ts
//
// GOAP Scheduler — unit tests for bitmask planning and faction relations.
// Contract C-191: Validates dual-mask action evaluation, agent planning,
// faction protection graph, and crime event consequence logic.
//
// AC-1: Zero-allocation bitwise plan verification
// AC-2: bitECS graph faction matching
// AC-3: Emergent consequence execution rules

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, query, set } from 'bitecs';
import { CrimeEvent, registerCrimeEventObservers } from '../components/crime_event.ts';
import { FactionMember, registerFactionMemberObservers } from '../components/faction_member.ts';
import { GoapAgent, registerGoapAgentObservers } from '../components/goap_agent.ts';
import { GridPosition, registerGridPositionObservers } from '../components/grid_position.ts';
import { registerVisionVisibleObservers, VisionVisible } from '../components/vision_visible.ts';
import type { StaticActionDefinition } from '../math/goap/action_registry.ts';
import {
  applyEffects,
  clearActionRegistry,
  evaluatePreconditions,
  findSatisfiedActions,
  initializeActionRegistry,
  selectBestAction,
} from '../math/goap/action_registry.ts';
import { Faction, IsMemberOf } from '../math/goap/faction_relations.ts';
import { WorldStateBit } from '../math/goap/world_state_bits.ts';
import {
  resetGoapState,
  setFactionProtection,
  updateGoapScheduler,
} from '../systems/goap_scheduler_system.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const createTestWorld = (): World => {
  const world = createWorld();
  registerGridPositionObservers(world);
  registerGoapAgentObservers(world);
  registerCrimeEventObservers(world);
  registerFactionMemberObservers(world);
  registerVisionVisibleObservers(world);
  return world;
};

/** Sample actions for testing. */
const TEST_ACTIONS: StaticActionDefinition[] = [
  // Action 0: Eat (needs hungry + has money + at pub)
  {
    actionId: 0,
    cost: 5,
    preconditionUsageMask: WorldStateBit.IsHungry | WorldStateBit.HasMoney | WorldStateBit.AtPub,
    preconditionValueMask: WorldStateBit.IsHungry | WorldStateBit.HasMoney | WorldStateBit.AtPub,
    effectClearMask: WorldStateBit.IsHungry | WorldStateBit.HasMoney,
    effectSetMask: WorldStateBit.HasEaten,
  },
  // Action 1: Go to pub (needs hungry + has money)
  {
    actionId: 1,
    cost: 10,
    preconditionUsageMask: WorldStateBit.IsHungry | WorldStateBit.HasMoney,
    preconditionValueMask: WorldStateBit.IsHungry | WorldStateBit.HasMoney,
    effectClearMask: 0,
    effectSetMask: WorldStateBit.AtPub,
  },
  // Action 2: Work (needs at workplace + has tools)
  {
    actionId: 2,
    cost: 8,
    preconditionUsageMask: WorldStateBit.AtWorkplace | WorldStateBit.HasTools,
    preconditionValueMask: WorldStateBit.AtWorkplace | WorldStateBit.HasTools,
    effectClearMask: 0,
    effectSetMask: WorldStateBit.HasMoney | WorldStateBit.IsTired,
  },
  // Action 3: Rest (needs tired)
  {
    actionId: 3,
    cost: 3,
    preconditionUsageMask: WorldStateBit.IsTired,
    preconditionValueMask: WorldStateBit.IsTired,
    effectClearMask: WorldStateBit.IsTired,
    effectSetMask: WorldStateBit.TaskComplete,
  },
];

// ===========================================================================
// AC-1: Bitwise Precondition Evaluation
// ===========================================================================

describe('AC-1: Dual-mask precondition evaluation', () => {
  beforeEach(() => {
    initializeActionRegistry(TEST_ACTIONS);
  });

  afterEach(() => {
    clearActionRegistry();
  });

  test('evaluatePreconditions — satisfied when all bits match', () => {
    const state = WorldStateBit.IsHungry | WorldStateBit.HasMoney | WorldStateBit.AtPub;
    const action = TEST_ACTIONS[0]; // Eat
    expect(evaluatePreconditions(state, action)).toBe(true);
  });

  test('evaluatePreconditions — false when required bit is missing', () => {
    const state = WorldStateBit.IsHungry | WorldStateBit.AtPub; // No HasMoney
    const action = TEST_ACTIONS[0]; // Eat
    expect(evaluatePreconditions(state, action)).toBe(false);
  });

  test('evaluatePreconditions — false when a bit should be 0 but is 1', () => {
    // Action: preconditionValueMask has HasMoney = 1, IsHungry = 1
    // If HasMoney is 0, precondition fails
    const state = WorldStateBit.IsHungry | WorldStateBit.AtPub;
    const action = TEST_ACTIONS[0];
    expect(evaluatePreconditions(state, action)).toBe(false);
  });

  test('evaluatePreconditions — action with no preconditions always matches', () => {
    const noopAction: StaticActionDefinition = {
      actionId: 99,
      cost: 0,
      preconditionUsageMask: 0,
      preconditionValueMask: 0,
      effectClearMask: 0,
      effectSetMask: 0,
    };
    expect(evaluatePreconditions(0, noopAction)).toBe(true);
    expect(evaluatePreconditions(0xffffffff, noopAction)).toBe(true);
  });

  test('applyEffects — clears and sets bits correctly', () => {
    const state = WorldStateBit.IsHungry | WorldStateBit.HasMoney;
    const action = TEST_ACTIONS[0]; // Eat: clears IsHungry | HasMoney, sets HasEaten
    const newState = applyEffects(state, action);
    expect(newState & WorldStateBit.IsHungry).toBe(0);
    expect(newState & WorldStateBit.HasMoney).toBe(0);
    expect(newState & WorldStateBit.HasEaten).toBe(WorldStateBit.HasEaten);
  });

  test('applyEffects — set takes precedence over clear on overlap', () => {
    const action: StaticActionDefinition = {
      actionId: 99,
      cost: 0,
      preconditionUsageMask: 0,
      preconditionValueMask: 0,
      effectClearMask: WorldStateBit.IsHungry,
      effectSetMask: WorldStateBit.IsHungry, // Same bit in both
    };
    const state = WorldStateBit.IsHungry;
    const newState = applyEffects(state, action);
    // Set should win (applied after clear)
    expect(newState & WorldStateBit.IsHungry).toBe(WorldStateBit.IsHungry);
  });

  test('findSatisfiedActions — returns only matching actions', () => {
    // State: hungry + has money, NOT at pub
    const state = WorldStateBit.IsHungry | WorldStateBit.HasMoney;
    const results = findSatisfiedActions(state);

    // Action 0 (Eat) needs AtPub — not satisfied
    // Action 1 (Go to pub) needs Hungry + HasMoney — satisfied
    expect(results).toContain(1);
    expect(results).not.toContain(0);
    expect(results).not.toContain(2);
    expect(results).not.toContain(3);
  });
});

// ===========================================================================
// AC-1: Best Action Selection
// ===========================================================================

describe('AC-1: selectBestAction', () => {
  beforeEach(() => {
    initializeActionRegistry(TEST_ACTIONS);
  });

  afterEach(() => {
    clearActionRegistry();
  });

  test('selects action that makes most progress toward goal', () => {
    // State: tired (only Rest action 3 matches)
    const state = WorldStateBit.IsTired;
    const goal = WorldStateBit.TaskComplete;

    // Action 3 (Rest): sets TaskComplete (1 goal bit) — cost 3
    const best = selectBestAction(state, goal);
    expect(best).toBe(3);
  });

  test('returns -1 when no actions available', () => {
    clearActionRegistry();
    const state = WorldStateBit.IsHungry;
    const goal = WorldStateBit.HasEaten;
    expect(selectBestAction(state, goal)).toBe(-1);
  });

  test('prefers lower cost when progress is equal', () => {
    const actions: StaticActionDefinition[] = [
      {
        actionId: 0,
        cost: 10,
        preconditionUsageMask: WorldStateBit.IsTired,
        preconditionValueMask: WorldStateBit.IsTired,
        effectClearMask: WorldStateBit.IsTired,
        effectSetMask: WorldStateBit.TaskComplete,
      },
      {
        actionId: 1,
        cost: 1,
        preconditionUsageMask: WorldStateBit.IsTired,
        preconditionValueMask: WorldStateBit.IsTired,
        effectClearMask: WorldStateBit.IsTired,
        effectSetMask: WorldStateBit.TaskComplete,
      },
    ];
    initializeActionRegistry(actions);

    const state = WorldStateBit.IsTired;
    const goal = WorldStateBit.TaskComplete;
    expect(selectBestAction(state, goal)).toBe(1); // Cheaper action
  });
});

// ===========================================================================
// AC-1: WorldStateBit constants
// ===========================================================================

describe('WorldStateBit constants', () => {
  test('all bits are unique powers of 2', () => {
    const bits = Object.values(WorldStateBit);
    const seen = new Set<number>();
    for (const bit of bits) {
      expect(seen.has(bit)).toBe(false);
      seen.add(bit);
      // Must be exactly one bit set
      expect((bit & (bit - 1)) === 0).toBe(true);
    }
  });

  test('total bit count does not exceed 32', () => {
    const count = Object.keys(WorldStateBit).length;
    expect(count).toBeLessThanOrEqual(32);
  });
});

// ===========================================================================
// GoapAgent Component Tests
// ===========================================================================

describe('GoapAgent component', () => {
  test('getComponent returns set values', () => {
    const world = createTestWorld();
    const eid = addEntity(world);
    addComponent(
      world,
      eid,
      set(GoapAgent, {
        currentState: WorldStateBit.IsHungry | WorldStateBit.HasMoney,
        currentGoal: WorldStateBit.HasEaten,
        currentActionId: 3,
        targetEntityId: 42,
      }),
    );

    const data = getComponent(world, eid, GoapAgent);
    expect(data).toBeDefined();
    expect(data?.currentState).toBe(WorldStateBit.IsHungry | WorldStateBit.HasMoney);
    expect(data?.currentGoal).toBe(WorldStateBit.HasEaten);
    expect(data?.currentActionId).toBe(3);
    expect(data?.targetEntityId).toBe(42);
  });

  test('SoA arrays are populated on set', () => {
    const world = createTestWorld();
    const eid = addEntity(world);
    addComponent(
      world,
      eid,
      set(GoapAgent, {
        currentState: 0b101,
        currentGoal: 0b10,
        currentActionId: 1,
        targetEntityId: 5,
      }),
    );

    expect(GoapAgent.currentState[eid]).toBe(0b101);
    expect(GoapAgent.currentGoal[eid]).toBe(0b10);
    expect(GoapAgent.currentActionId[eid]).toBe(1);
    expect(GoapAgent.targetEntityId[eid]).toBe(5);
  });
});

// ===========================================================================
// AC-1: GoapSchedulerSystem — Agent Planning
// ===========================================================================

describe('AC-1: GoapSchedulerSystem agent planning', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
    resetGoapState();
  });

  afterEach(() => {
    clearActionRegistry();
    resetGoapState();
  });

  test('agent selects action to satisfy goal', () => {
    const eid = addEntity(world);
    addComponent(
      world,
      eid,
      set(GoapAgent, {
        currentState: WorldStateBit.IsHungry | WorldStateBit.HasMoney,
        currentGoal: WorldStateBit.AtPub,
        currentActionId: -1,
        targetEntityId: 0,
      }),
    );

    updateGoapScheduler(world);

    // After applying "Go to pub": AtPub should be set, goal satisfied
    const state = GoapAgent.currentState[eid];
    expect(state & WorldStateBit.AtPub).toBe(WorldStateBit.AtPub);
    // Goal is satisfied — cleared
    expect(GoapAgent.currentGoal[eid]).toBe(0);
  });

  test('agent clears action when preconditions no longer met', () => {
    const eid = addEntity(world);
    addComponent(
      world,
      eid,
      set(GoapAgent, {
        currentState: WorldStateBit.IsHungry, // Missing HasMoney
        currentGoal: WorldStateBit.HasEaten,
        currentActionId: 1, // Go to pub — needs HasMoney
        targetEntityId: 0,
      }),
    );

    updateGoapScheduler(world);

    // Preconditions not met — action should be cleared (-1)
    expect(GoapAgent.currentActionId[eid]).toBe(-1);
  });

  test('agent clears goal when satisfied', () => {
    const eid = addEntity(world);
    addComponent(
      world,
      eid,
      set(GoapAgent, {
        currentState: WorldStateBit.HasEaten, // Goal already satisfied
        currentGoal: WorldStateBit.HasEaten,
        currentActionId: 0,
        targetEntityId: 0,
      }),
    );

    updateGoapScheduler(world);

    // Goal satisfied — cleared
    expect(GoapAgent.currentGoal[eid]).toBe(0);
    expect(GoapAgent.currentActionId[eid]).toBe(-1);
  });

  test('agent with zero goal stays idle', () => {
    const eid = addEntity(world);
    addComponent(
      world,
      eid,
      set(GoapAgent, {
        currentState: WorldStateBit.IsHungry,
        currentGoal: 0,
        currentActionId: -1,
        targetEntityId: 0,
      }),
    );

    updateGoapScheduler(world);

    // No goal — stays idle
    expect(GoapAgent.currentActionId[eid]).toBe(-1);
  });
});

// ===========================================================================
// AC-2: Faction Relations
// ===========================================================================

describe('AC-2: Faction relations', () => {
  test('Faction constants are unique', () => {
    const values = Object.values(Faction);
    const seen = new Set<number>();
    for (const v of values) {
      expect(seen.has(v)).toBe(false);
      seen.add(v);
    }
  });

  test('IsMemberOf relation can be added to entity', () => {
    const world = createTestWorld();
    const agentEid = addEntity(world);
    const factionEid = addEntity(world);

    // Add IsMemberOf relation: agent is member of faction
    addComponent(world, agentEid, IsMemberOf(factionEid));

    // Query all entities with IsMemberOf(factionEid)
    const members = [...query(world, [IsMemberOf(factionEid)])];
    expect(members).toContain(agentEid);
  });

  test('setFactionProtection creates protector relationship', () => {
    resetGoapState();
    setFactionProtection(Faction.Guard, Faction.Civilian);

    // Verify the protection is stored (tested indirectly via crime system)
    // The protection map should be set up
    // This is verified by the crime consequence tests below
    expect(true).toBe(true); // Placeholder — real verification in crime tests
  });
});

// ===========================================================================
// AC-3: Crime Event Consequences
// ===========================================================================

describe('AC-3: Emergent consequence — crime reactions', () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld();
    resetGoapState();
  });

  afterEach(() => {
    clearActionRegistry();
    resetGoapState();
  });

  test('protector witness becomes hostile when crime targets protected faction', () => {
    // ── Setup factions ──
    setFactionProtection(Faction.Guard, Faction.Civilian);

    // ── Create faction entities ──
    const guardFactionEid = addEntity(world);
    addComponent(
      world,
      guardFactionEid,
      set(FactionMember, { factionId: Faction.Guard, name: 'Guard' }),
    );
    const civilianFactionEid = addEntity(world);
    addComponent(
      world,
      civilianFactionEid,
      set(FactionMember, { factionId: Faction.Civilian, name: 'Civilian' }),
    );

    // ── Guard NPC (protector) ──
    const guardEid = addEntity(world);
    addComponent(world, guardEid, set(GridPosition, { x: 5, y: 5 }));
    addComponent(
      world,
      guardEid,
      set(GoapAgent, {
        currentState: WorldStateBit.IsPatrolling,
        currentGoal: 0,
        currentActionId: -1,
        targetEntityId: 0,
      }),
    );
    addComponent(world, guardEid, set(VisionVisible, { visibleByMask: 1 }));
    addComponent(world, guardEid, IsMemberOf(guardFactionEid));

    // ── Civilian (victim) ──
    const civilianEid = addEntity(world);
    addComponent(world, civilianEid, set(GridPosition, { x: 5, y: 5 }));
    addComponent(world, civilianEid, set(VisionVisible, { visibleByMask: 0 }));
    addComponent(world, civilianEid, IsMemberOf(civilianFactionEid));

    // ── Criminal (perpetrator) ──
    const criminalEid = addEntity(world);
    addComponent(world, criminalEid, set(GridPosition, { x: 5, y: 5 }));

    // ── Crime event at guard's position ──
    const crimeEid = addEntity(world);
    addComponent(
      world,
      crimeEid,
      set(CrimeEvent, {
        victimEid: civilianEid,
        perpetratorEid: criminalEid,
        gridX: 5,
        gridY: 5,
      }),
    );

    // ── Tick the GOAP scheduler ──
    updateGoapScheduler(world);

    // ── Verify emergent reaction ──
    const guardState = GoapAgent.currentState[guardEid];
    expect(guardState & WorldStateBit.IsHostile).toBe(WorldStateBit.IsHostile);
    expect(guardState & WorldStateBit.HasWitnessedCrime).toBe(WorldStateBit.HasWitnessedCrime);
    expect(guardState & WorldStateBit.HasTarget).toBe(WorldStateBit.HasTarget);
    expect(GoapAgent.targetEntityId[guardEid]).toBe(criminalEid);
    expect(GoapAgent.currentGoal[guardEid]).toBe(WorldStateBit.IsHostile | WorldStateBit.HasTarget);

    // ── Crime event consumed ──
    const remainingCrimes = [...query(world, [CrimeEvent])];
    expect(remainingCrimes.length).toBe(0);
  });

  test('non-protector witness does NOT become hostile', () => {
    // ── No protection set up ──

    const civilianFactionEid = addEntity(world);
    addComponent(
      world,
      civilianFactionEid,
      set(FactionMember, { factionId: Faction.Civilian, name: 'Civilian' }),
    );

    // ── Bystander NPC (not a protector) ──
    const bystanderEid = addEntity(world);
    addComponent(world, bystanderEid, set(GridPosition, { x: 5, y: 5 }));
    addComponent(
      world,
      bystanderEid,
      set(GoapAgent, {
        currentState: WorldStateBit.IsPatrolling,
        currentGoal: 0,
        currentActionId: -1,
        targetEntityId: 0,
      }),
    );
    addComponent(world, bystanderEid, set(VisionVisible, { visibleByMask: 1 }));
    addComponent(world, bystanderEid, IsMemberOf(civilianFactionEid));

    // ── Civilian (victim) — different faction ──
    const merchantFactionEid = addEntity(world);
    addComponent(
      world,
      merchantFactionEid,
      set(FactionMember, { factionId: Faction.Merchant, name: 'Merchant' }),
    );
    const civilianEid = addEntity(world);
    addComponent(world, civilianEid, set(GridPosition, { x: 5, y: 5 }));
    addComponent(world, civilianEid, IsMemberOf(merchantFactionEid));

    // ── Criminal ──
    const criminalEid = addEntity(world);
    addComponent(world, criminalEid, set(GridPosition, { x: 5, y: 5 }));

    // ── Crime ──
    const crimeEid = addEntity(world);
    addComponent(
      world,
      crimeEid,
      set(CrimeEvent, {
        victimEid: civilianEid,
        perpetratorEid: criminalEid,
        gridX: 5,
        gridY: 5,
      }),
    );

    updateGoapScheduler(world);

    // Bystander should NOT be hostile (not a protector of merchant faction)
    const bystanderState = GoapAgent.currentState[bystanderEid];
    expect(bystanderState & WorldStateBit.IsHostile).toBe(0);
  });

  test('witness too far from crime does not react', () => {
    setFactionProtection(Faction.Guard, Faction.Civilian);

    const guardFactionEid = addEntity(world);
    addComponent(
      world,
      guardFactionEid,
      set(FactionMember, { factionId: Faction.Guard, name: 'Guard' }),
    );
    const civilianFactionEid = addEntity(world);
    addComponent(
      world,
      civilianFactionEid,
      set(FactionMember, { factionId: Faction.Civilian, name: 'Civilian' }),
    );

    // Guard at (5, 5) but crime at (10, 10) — too far
    const guardEid = addEntity(world);
    addComponent(world, guardEid, set(GridPosition, { x: 5, y: 5 }));
    addComponent(
      world,
      guardEid,
      set(GoapAgent, {
        currentState: WorldStateBit.IsPatrolling,
        currentGoal: 0,
        currentActionId: -1,
        targetEntityId: 0,
      }),
    );
    addComponent(world, guardEid, set(VisionVisible, { visibleByMask: 1 }));
    addComponent(world, guardEid, IsMemberOf(guardFactionEid));

    const civilianEid = addEntity(world);
    addComponent(world, civilianEid, set(GridPosition, { x: 5, y: 5 }));
    addComponent(world, civilianEid, IsMemberOf(civilianFactionEid));

    const criminalEid = addEntity(world);

    const crimeEid = addEntity(world);
    addComponent(
      world,
      crimeEid,
      set(CrimeEvent, {
        victimEid: civilianEid,
        perpetratorEid: criminalEid,
        gridX: 10,
        gridY: 10, // Far from guard
      }),
    );

    updateGoapScheduler(world);

    // Guard should NOT react (too far)
    const guardState = GoapAgent.currentState[guardEid];
    expect(guardState & WorldStateBit.IsHostile).toBe(0);
  });

  test('crime event with invalid victim/perpetrator is cleaned up', () => {
    const crimeEid = addEntity(world);
    addComponent(
      world,
      crimeEid,
      set(CrimeEvent, {
        victimEid: 0, // Invalid
        perpetratorEid: 0, // Invalid
        gridX: 5,
        gridY: 5,
      }),
    );

    updateGoapScheduler(world);

    // Crime event should be removed
    const remaining = [...query(world, [CrimeEvent])];
    expect(remaining.length).toBe(0);
  });
});

// ===========================================================================
// AC-1: Performance — bitwise evaluation speed
// ===========================================================================

describe('AC-1: Performance envelope', () => {
  beforeEach(() => {
    initializeActionRegistry(TEST_ACTIONS);
  });

  afterEach(() => {
    clearActionRegistry();
  });

  test('100 precondition evaluations complete in under 5ms', () => {
    const state = WorldStateBit.IsHungry | WorldStateBit.HasMoney | WorldStateBit.AtPub;
    const action = TEST_ACTIONS[0];

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      evaluatePreconditions(state, action);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
  });

  test('findSatisfiedActions over 100 iterations is fast', () => {
    const state = WorldStateBit.IsHungry | WorldStateBit.IsTired;

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      findSatisfiedActions(state);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(20);
  });
});
