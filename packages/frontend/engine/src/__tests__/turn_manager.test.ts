// packages/frontend/engine/src/__tests__/turn_manager.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, query, set } from 'bitecs';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import type { TurnOrderData } from '../components/turn_order.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import {
  advanceTurn,
  endCombat,
  initCombat,
  resetTurnTracking,
} from '../systems/turn_manager_system.ts';

// ---------------------------------------------------------------------------
// Helper: set up a world with combat observers registered
// ---------------------------------------------------------------------------

const createCombatWorld = (): World => {
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  return world;
};

/**
 * Creates a combat participant entity with the given stats and initiative.
 * Returns the entity ID.
 */
const createParticipant = (
  world: World,
  options: {
    health: number;
    maxHealth: number;
    initiative: number;
  },
): number => {
  const eid = addEntity(world);
  addComponent(world, eid, CombatStats);
  addComponent(
    world,
    eid,
    set(CombatStats, {
      health: options.health,
      maxHealth: options.maxHealth,
      initiative: options.initiative,
    }),
  );
  addComponent(world, eid, TurnOrder);
  addComponent(
    world,
    eid,
    set(TurnOrder, {
      currentTurn: false,
      initiativeValue: options.initiative,
      isActive: true,
    }),
  );
  return eid;
};

// ---------------------------------------------------------------------------
// initCombat tests
// ---------------------------------------------------------------------------

describe('initCombat', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createCombatWorld();
    bridge = new MockEngineBridge();
    resetTurnTracking();
  });

  afterEach(() => {
    resetTurnTracking();
  });

  it('emits COMBAT_STARTED with participant IDs sorted by initiative', () => {
    const highInit = createParticipant(world, { health: 100, maxHealth: 100, initiative: 15 });
    const lowInit = createParticipant(world, { health: 50, maxHealth: 50, initiative: 5 });
    const midInit = createParticipant(world, { health: 80, maxHealth: 80, initiative: 10 });

    const events: Array<{ type: string } & Record<string, unknown>> = [];
    bridge.on('COMBAT_STARTED', (event) => {
      events.push(event);
    });

    initCombat(world, bridge);

    expect(events).toHaveLength(1);
    const started = events[0] as unknown as { participantIds: number[]; firstTurnEntityId: number };
    expect(started.participantIds).toHaveLength(3);
    expect(started.participantIds[0]).toBe(highInit);
    expect(started.participantIds[1]).toBe(midInit);
    expect(started.participantIds[2]).toBe(lowInit);
    expect(started.firstTurnEntityId).toBe(highInit);
  });

  it('marks the first participant with currentTurn = true', () => {
    createParticipant(world, { health: 100, maxHealth: 100, initiative: 10 });
    createParticipant(world, { health: 50, maxHealth: 50, initiative: 5 });

    initCombat(world, bridge);

    const entities = query(world, [TurnOrder]);
    const firstEid = entities[0];
    if (firstEid === undefined) {
      throw new Error('Expected at least one entity');
    }
    const turnData = getComponent(world, firstEid, TurnOrder) as TurnOrderData;
    expect(turnData.currentTurn).toBe(true);
  });

  it('is idempotent — does not reinitialize when combat is already active', () => {
    createParticipant(world, { health: 100, maxHealth: 100, initiative: 10 });

    const events: Array<{ type: string }> = [];
    bridge.on('COMBAT_STARTED', () => {
      events.push({ type: 'COMBAT_STARTED' });
    });

    initCombat(world, bridge);
    expect(events).toHaveLength(1);

    initCombat(world, bridge);
    expect(events).toHaveLength(1);
  });

  it('does nothing when world is undefined', () => {
    expect(() => {
      initCombat(undefined as unknown as World, bridge);
    }).not.toThrow();
  });

  it('does nothing when bridge is undefined', () => {
    createParticipant(world, { health: 100, maxHealth: 100, initiative: 10 });
    expect(() => {
      initCombat(world, undefined as unknown as MockEngineBridge);
    }).not.toThrow();
  });

  it('does nothing with no combat participants', () => {
    const events: Array<{ type: string }> = [];
    bridge.on('COMBAT_STARTED', () => {
      events.push({ type: 'COMBAT_STARTED' });
    });

    initCombat(world, bridge);
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// advanceTurn tests (AC-2: Reactive Turn Updates)
// ---------------------------------------------------------------------------

describe('advanceTurn', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createCombatWorld();
    bridge = new MockEngineBridge();
    resetTurnTracking();
  });

  afterEach(() => {
    resetTurnTracking();
  });

  it('advances turn from first to second participant', () => {
    const eid1 = createParticipant(world, { health: 100, maxHealth: 100, initiative: 15 });
    const eid2 = createParticipant(world, { health: 80, maxHealth: 80, initiative: 10 });

    initCombat(world, bridge);

    const turnEvents: Array<{ currentEntityId: number; activeEntities: number[] }> = [];
    bridge.on('TURN_CHANGED', (event) => {
      turnEvents.push(event);
    });

    advanceTurn(world, bridge);

    expect(turnEvents).toHaveLength(1);
    expect(turnEvents[0].currentEntityId).toBe(eid2);
    expect(turnEvents[0].activeEntities).toContain(eid1);
    expect(turnEvents[0].activeEntities).toContain(eid2);

    // Verify first entity no longer has currentTurn
    const turn1 = getComponent(world, eid1, TurnOrder) as TurnOrderData;
    expect(turn1.currentTurn).toBe(false);

    // Verify second entity has currentTurn
    const turn2 = getComponent(world, eid2, TurnOrder) as TurnOrderData;
    expect(turn2.currentTurn).toBe(true);
  });

  it('wraps around to first participant after last', () => {
    const eid1 = createParticipant(world, { health: 100, maxHealth: 100, initiative: 15 });
    const eid2 = createParticipant(world, { health: 80, maxHealth: 80, initiative: 10 });

    initCombat(world, bridge);

    // Advance past eid2 back to eid1
    advanceTurn(world, bridge); // eid1 → eid2
    advanceTurn(world, bridge); // eid2 → eid1

    const turn1 = getComponent(world, eid1, TurnOrder) as TurnOrderData;
    expect(turn1.currentTurn).toBe(true);

    const turn2 = getComponent(world, eid2, TurnOrder) as TurnOrderData;
    expect(turn2.currentTurn).toBe(false);
  });

  it('skips dead entities (health <= 0)', () => {
    createParticipant(world, { health: 100, maxHealth: 100, initiative: 15 });
    const deadEid = createParticipant(world, { health: 100, maxHealth: 100, initiative: 10 });
    const aliveEid = createParticipant(world, { health: 50, maxHealth: 50, initiative: 5 });

    // Kill the middle entity
    CombatStats.health[deadEid] = 0;

    initCombat(world, bridge);

    // First advance should skip the dead entity and go to the alive one
    const turnEvents: Array<{ currentEntityId: number }> = [];
    bridge.on('TURN_CHANGED', (event) => {
      turnEvents.push(event);
    });

    advanceTurn(world, bridge);

    expect(turnEvents).toHaveLength(1);
    expect(turnEvents[0].currentEntityId).toBe(aliveEid);
  });

  it('emits COMBAT_ENDED when all entities are dead', () => {
    const eid1 = createParticipant(world, { health: 100, maxHealth: 100, initiative: 15 });
    const eid2 = createParticipant(world, { health: 100, maxHealth: 100, initiative: 10 });

    initCombat(world, bridge);

    // Kill both entities
    CombatStats.health[eid1] = 0;
    CombatStats.health[eid2] = 0;

    const endEvents: Array<{ type: string; victory: boolean }> = [];
    bridge.on('COMBAT_ENDED', (event) => {
      endEvents.push(event);
    });

    advanceTurn(world, bridge);

    expect(endEvents).toHaveLength(1);
    expect(endEvents[0].victory).toBe(false);
  });

  it('does nothing when combat is not initialized', () => {
    createParticipant(world, { health: 100, maxHealth: 100, initiative: 10 });

    const events: Array<{ type: string }> = [];
    bridge.on('TURN_CHANGED', () => {
      events.push({ type: 'TURN_CHANGED' });
    });

    advanceTurn(world, bridge);

    expect(events).toHaveLength(0);
  });

  it('does nothing when world is undefined', () => {
    expect(() => {
      advanceTurn(undefined as unknown as World, bridge);
    }).not.toThrow();
  });

  it('does nothing when bridge is undefined', () => {
    createParticipant(world, { health: 100, maxHealth: 100, initiative: 10 });
    initCombat(world, bridge);

    expect(() => {
      advanceTurn(world, undefined as unknown as MockEngineBridge);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// endCombat tests
// ---------------------------------------------------------------------------

describe('endCombat', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createCombatWorld();
    bridge = new MockEngineBridge();
    resetTurnTracking();
  });

  afterEach(() => {
    resetTurnTracking();
  });

  it('emits COMBAT_ENDED with victory flag', () => {
    createParticipant(world, { health: 100, maxHealth: 100, initiative: 10 });
    initCombat(world, bridge);

    const endEvents: Array<{ type: string; victory: boolean }> = [];
    bridge.on('COMBAT_ENDED', (event) => {
      endEvents.push(event);
    });

    endCombat(bridge, true);

    expect(endEvents).toHaveLength(1);
    expect(endEvents[0].victory).toBe(true);
  });

  it('clears current turn flag on active entity', () => {
    const eid = createParticipant(world, { health: 100, maxHealth: 100, initiative: 10 });
    initCombat(world, bridge);

    endCombat(bridge, false);

    const turn = getComponent(world, eid, TurnOrder) as TurnOrderData;
    expect(turn.currentTurn).toBe(false);
  });

  it('does nothing when bridge is undefined', () => {
    expect(() => {
      endCombat(undefined as unknown as MockEngineBridge, false);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resetTurnTracking tests
// ---------------------------------------------------------------------------

describe('resetTurnTracking', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createCombatWorld();
    bridge = new MockEngineBridge();
  });

  afterEach(() => {
    resetTurnTracking();
  });

  it('resets tracking state so initCombat can be called again', () => {
    createParticipant(world, { health: 100, maxHealth: 100, initiative: 10 });
    initCombat(world, bridge);

    resetTurnTracking();

    const events: Array<{ type: string }> = [];
    bridge.on('COMBAT_STARTED', () => {
      events.push({ type: 'COMBAT_STARTED' });
    });

    initCombat(world, bridge);
    expect(events).toHaveLength(1);
  });
});
