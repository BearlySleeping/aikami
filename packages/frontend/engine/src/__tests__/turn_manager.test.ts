// packages/frontend/engine/src/__tests__/turn_manager.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import {
  addComponent,
  addEntity,
  createWorld,
  getAllEntities,
  getComponent,
  query,
  set,
} from 'bitecs';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import type { TurnOrderData } from '../components/turn_order.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import {
  advanceTurn,
  endCombat,
  handleCombatAction,
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
      attack: 5,
      defense: 12,
      accuracy: 4,
      evasion: 12,
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

// ---------------------------------------------------------------------------
// handleCombatAction tests (C-145)
// ---------------------------------------------------------------------------

/**
 * Creates a participant with a given role and custom combat stats.
 * Used for combat action tests where specific attack/defense/accuracy/evasion
 * values are needed.
 */
const createStatParticipant = (
  world: World,
  options: {
    health: number;
    maxHealth: number;
    initiative: number;
    attack: number;
    defense: number;
    accuracy: number;
    evasion: number;
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
      attack: options.attack,
      defense: options.defense,
      accuracy: options.accuracy,
      evasion: options.evasion,
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

/**
 * Creates a predictable dice roller for deterministic tests.
 * Returns values in sequence from the provided array, wrapping around.
 */
const createDeterministicRoller = (rolls: number[]) => {
  let index = 0;
  return (_sides: number): number => {
    const value = rolls[index % rolls.length] ?? 1;
    index++;
    return value;
  };
};

describe('handleCombatAction', () => {
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

  // ── ATTACK — hit ──

  it('ATTACK: hits enemy and deals damage when d20 + accuracy >= evasion', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 4,
      evasion: 12,
    });
    const enemyEid = createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 3,
      defense: 10,
      accuracy: 2,
      evasion: 10,
    });

    initCombat(world, bridge);

    // d20 roll = 10, d6 damage = 3
    // Hit: 10 + 4 = 14 >= 10 (evasion) → hits
    // Damage: 3 + 5 - 10 = -2, clamped to min 1
    const roller = createDeterministicRoller([10, 3, 1, 1]); // player attack, damage, enemy attack, enemy damage

    const logEntries: Array<{ message: string }> = [];
    bridge.on('COMBAT_LOG', (event) => {
      logEntries.push(event);
    });

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: roller,
    });

    expect(logEntries.length).toBeGreaterThanOrEqual(1);

    // Verify enemy HP was reduced
    const enemyStats = getComponent(world, enemyEid, CombatStats) as CombatStatsData;
    expect(enemyStats.health).toBeLessThan(50);
    expect(enemyStats.health).toBeGreaterThanOrEqual(0);

    // Player HP should be unchanged (enemy misses with roll=1, 1+2=3 < 12 evasion)
    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    expect(playerStats.health).toBe(100);
  });

  // ── ATTACK — miss ──

  it('ATTACK: misses when d20 + accuracy < evasion', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 1,
      evasion: 12,
    });
    const enemyEid = createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 3,
      defense: 10,
      accuracy: 2,
      evasion: 20,
    });

    initCombat(world, bridge);

    // d20 roll = 3, but 3 + 1 = 4 < 20 (evasion) → miss
    const roller = createDeterministicRoller([3, 1, 1, 1]);

    const logEntries: string[] = [];
    bridge.on('COMBAT_LOG', (event) => {
      logEntries.push(event.message);
    });

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: roller,
    });

    // Enemy HP unchanged — attack missed
    const enemyStats = getComponent(world, enemyEid, CombatStats) as CombatStatsData;
    expect(enemyStats.health).toBe(50);

    // Should contain a "Miss" log entry
    const missEntry = logEntries.find((m) => m.includes('Miss'));
    expect(missEntry).toBeDefined();
  });

  // ── ATTACK — kills enemy ──

  it('ATTACK: kills enemy when HP drops to 0, destroys entity, grants loot, emits victory', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 50, // massive attack to guarantee kill
      defense: 12,
      accuracy: 20, // always hits
      evasion: 12,
    });
    const enemyEid = createStatParticipant(world, {
      health: 10,
      maxHealth: 10,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 5,
    });

    initCombat(world, bridge);

    const roller = createDeterministicRoller([20, 6]); // crit hit, max damage

    const endEvents: Array<{ victory: boolean }> = [];
    bridge.on('COMBAT_ENDED', (event) => {
      endEvents.push(event);
    });

    const inventoryEvents: Array<{ inventory: unknown[] }> = [];
    bridge.on('INVENTORY_UPDATED', (event) => {
      inventoryEvents.push(event);
    });

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: roller,
    });

    // Enemy entity should be destroyed (removed from the world)
    const allEids = getAllEntities(world);
    expect(allEids).not.toContain(enemyEid);

    // COMBAT_ENDED with victory emitted
    expect(endEvents.length).toBe(1);
    expect(endEvents[0].victory).toBe(true);

    // INVENTORY_UPDATED (loot) emitted
    expect(inventoryEvents.length).toBe(1);
  });

  // ── HP floor check ──

  it('HP does not drop below 0', () => {
    const playerEid = createStatParticipant(world, {
      health: 5,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 0,
      accuracy: 20,
      evasion: 0,
    });
    createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 100, // massive enemy attack
      defense: 0,
      accuracy: 20,
      evasion: 0,
    });

    initCombat(world, bridge);

    // Player attacks first, enemy counter-attacks with massive damage
    const roller = createDeterministicRoller([20, 6, 20, 6]);

    const endEvents: Array<{ victory: boolean }> = [];
    bridge.on('COMBAT_ENDED', (event) => {
      endEvents.push(event);
    });

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      bridge,
      diceRoller: roller,
    });

    // Player HP should be exactly 0, not negative
    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    expect(playerStats.health).toBe(0);

    // COMBAT_ENDED with defeat emitted
    expect(endEvents.length).toBe(1);
    expect(endEvents[0].victory).toBe(false);
  });

  // ── FLEE ──

  it('FLEE: ends combat with victory=false', () => {
    createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 4,
      evasion: 12,
    });
    createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 3,
      defense: 10,
      accuracy: 2,
      evasion: 10,
    });

    initCombat(world, bridge);

    const endEvents: Array<{ victory: boolean }> = [];
    bridge.on('COMBAT_ENDED', (event) => {
      endEvents.push(event);
    });

    handleCombatAction({
      world,
      playerEntityId: 1,
      action: 'FLEE',
      bridge,
    });

    expect(endEvents.length).toBe(1);
    expect(endEvents[0].victory).toBe(false);
  });

  // ── DEFEND ──

  it('DEFEND: emits log entry and allows enemy counter-attack', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 4,
      evasion: 5, // low evasion so enemy hits
    });
    createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 3,
      defense: 10,
      accuracy: 2,
      evasion: 10,
    });

    initCombat(world, bridge);

    const roller = createDeterministicRoller([15, 4]); // enemy hit roll = 15, enemy damage = 4

    const logEntries: string[] = [];
    bridge.on('COMBAT_LOG', (event) => {
      logEntries.push(event.message);
    });

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'DEFEND',
      bridge,
      diceRoller: roller,
    });

    // Should have "defensive stance" and enemy attack log entries
    const defendEntry = logEntries.find((m) => m.includes('defensive stance'));
    expect(defendEntry).toBeDefined();

    // Enemy counter-attack should have happened
    const enemyEntry = logEntries.find((m) => m.includes('Enemy rolls'));
    expect(enemyEntry).toBeDefined();
  });

  // ── No-op when combat not initialized ──

  it('does nothing when combat is not initialized', () => {
    const logEntries: string[] = [];
    bridge.on('COMBAT_LOG', () => {
      logEntries.push('log');
    });

    handleCombatAction({
      world,
      playerEntityId: 1,
      action: 'ATTACK',
      bridge,
    });

    expect(logEntries.length).toBe(0);
  });

  // ── No-op when world/bridge undefined ──

  it('does nothing when world is undefined', () => {
    expect(() => {
      handleCombatAction({
        world: undefined as unknown as World,
        playerEntityId: 1,
        action: 'ATTACK',
        bridge,
      });
    }).not.toThrow();
  });

  it('does nothing when bridge is undefined', () => {
    createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 4,
      evasion: 12,
    });
    initCombat(world, bridge);

    expect(() => {
      handleCombatAction({
        world,
        playerEntityId: 1,
        action: 'ATTACK',
        bridge: undefined as unknown as MockEngineBridge,
      });
    }).not.toThrow();
  });

  // ── COMBAT_STATE_UPDATE emission ──

  it('emits COMBAT_STATE_UPDATE after each action', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 20, // always hits
      evasion: 12,
    });
    const enemyEid = createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 3,
      defense: 10,
      accuracy: 2,
      evasion: 10,
    });

    initCombat(world, bridge);

    const stateUpdates: Array<{ entityHpMap: Record<number, number> }> = [];
    bridge.on('COMBAT_STATE_UPDATE', (event) => {
      stateUpdates.push(event);
    });

    const roller = createDeterministicRoller([20, 4, 1, 1]);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: roller,
    });

    // At least one COMBAT_STATE_UPDATE should be emitted (after player attack)
    expect(stateUpdates.length).toBeGreaterThanOrEqual(1);

    // Should contain both player and enemy HP
    const update = stateUpdates[0];
    expect(update).toBeDefined();
    if (update) {
      expect(update.entityHpMap[playerEid]).toBeDefined();
      expect(update.entityHpMap[enemyEid]).toBeDefined();
    }
  });

  // ── COMBAT_LOG contains expected message format ──

  it('COMBAT_LOG entries contain dice roll details', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 4,
      evasion: 12,
    });
    const enemyEid = createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 3,
      defense: 10,
      accuracy: 2,
      evasion: 10,
    });

    initCombat(world, bridge);

    const logEntries: Array<{
      message: string;
      sourceId: number;
      targetId: number;
      targetRemainingHp: number;
      targetMaxHp: number;
    }> = [];
    bridge.on('COMBAT_LOG', (event) => {
      logEntries.push(event);
    });

    const roller = createDeterministicRoller([14, 4, 1, 1]);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: roller,
    });

    // Player attack log entry: should mention dice roll
    const playerAttackEntry = logEntries.find(
      (e) => e.sourceId === playerEid && e.targetId === enemyEid,
    );
    expect(playerAttackEntry).toBeDefined();
    if (playerAttackEntry) {
      expect(playerAttackEntry.message).toMatch(/rolls \d+/);
      expect(playerAttackEntry.targetRemainingHp).toBeGreaterThanOrEqual(0);
      expect(playerAttackEntry.targetMaxHp).toBe(50);
    }
  });
});
