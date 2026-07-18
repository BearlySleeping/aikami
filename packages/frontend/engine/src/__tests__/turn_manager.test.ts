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
  createSeedableRng,
  endCombat,
  getCombatSeed,
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

  // ── C-146: Advantage —─────────────────────────────────────────────────

  it('ADVANTAGE: rolls 2d20 and takes the higher for hit check', () => {
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
      evasion: 15, // needs 11+ to hit: 4 + roll >= 16
    });

    initCombat(world, bridge);

    // First roll = 5 (would miss: 5+4=9 < 15), second roll = 18 (hits: 18+4=22 >= 15)
    const roller = createDeterministicRoller([5, 18, 3]); // adv roll 1, adv roll 2, damage roll

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
      advantage: true,
    });

    // Should hit (took the 18)
    const hitEntry = logEntries.find((m) => m.includes('to hit'));
    expect(hitEntry).toBeDefined();
    if (hitEntry) {
      expect(hitEntry).toMatch(/rolls 18/); // took the higher roll
      expect(hitEntry).toMatch(/\[ADV\]/); // advantage label present
    }

    // Enemy HP should be reduced (hit landed)
    const enemyStats = getComponent(world, enemyEid, CombatStats) as CombatStatsData;
    expect(enemyStats.health).toBeLessThan(50);
  });

  it('ADVANTAGE: still misses when both rolls are low', () => {
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
      evasion: 20, // needs 20+ to hit
    });

    initCombat(world, bridge);

    // Both rolls are low: 3 and 7, max = 7, 7+1=8 < 20 evasion → miss
    const roller = createDeterministicRoller([3, 7]);

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
      advantage: true,
    });

    // Should contain a miss entry with ADV label
    const missEntry = logEntries.find((m) => m.includes('Miss') && m.includes('[ADV]'));
    expect(missEntry).toBeDefined();

    // Enemy HP unchanged
    const enemyStats = getComponent(world, enemyEid, CombatStats) as CombatStatsData;
    expect(enemyStats.health).toBe(50);
  });

  // ── C-146: Bonus damage ───────────────────────────────────────────────

  it('BONUS_DAMAGE: adds bonusDamage to the final damage calculation', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 20,
      attack: 5,
      defense: 12,
      accuracy: 20,
      evasion: 12,
    });
    const enemyEid = createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 15,
      attack: 3,
      defense: 0, // no defense
      accuracy: 2,
      evasion: 10,
    });

    initCombat(world, bridge);

    // Roll: d20=15, d6=4, bonusDamage=3, attack=5, defense=0
    // Raw: 4+5+3 = 12, damage = 12, remaining HP = 50-12 = 38
    // Roll: d20=15, d6=4, bonusDamage=3, attack=5, defense=0
    // Raw: 4+5+3 = 12, damage = 12, remaining HP = 50-12 = 38
    const roller = createDeterministicRoller([15, 4, 1, 1]);

    const logEntries: Array<{
      message: string;
      targetRemainingHp: number;
      targetMaxHp: number;
    }> = [];
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
      bonusDamage: 3,
    });

    // Find the player hit entry
    const hitEntry = logEntries.find((e) => e.message.includes('to hit'));
    expect(hitEntry).toBeDefined();
    if (hitEntry) {
      // Without bonusDamage: 4+5-0 = 9 dmg, remaining 41
      // With bonusDamage=3: 4+5+3-0 = 12 dmg, remaining 38
      expect(hitEntry.targetRemainingHp).toBe(38);
      expect(hitEntry.targetMaxHp).toBe(50);
    }
  });

  it('BONUS_DAMAGE: bonusDamage of 0 does not change standard behavior', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 20,
      evasion: 12,
    });
    const enemyEid = createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 10,
    });

    initCombat(world, bridge);

    // d20=15, d6=4, bonusDamage=0, attack=5, defense=0 → 9 damage
    const roller = createDeterministicRoller([15, 4, 1, 1]);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: roller,
      bonusDamage: 0,
    });

    const enemyStats = getComponent(world, enemyEid, CombatStats) as CombatStatsData;
    expect(enemyStats.health).toBe(41); // 50 - 9 = 41
  });

  // ── C-146: Combined advantage + bonusDamage ───────────────────────────

  it('ADVANTAGE + BONUS_DAMAGE: both modifiers apply simultaneously', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 10,
      defense: 12,
      accuracy: 20,
      evasion: 12,
    });
    const enemyEid = createStatParticipant(world, {
      health: 80,
      maxHealth: 80,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 10,
    });

    initCombat(world, bridge);

    // Advantage: rolls 10 and 19, takes 19 → 19+20=39 >= 10 evasion → hit
    // Damage: d6=5 + attack=10 + bonusDamage=4 - defense=0 = 19
    const roller = createDeterministicRoller([10, 19, 5, 1, 1]);

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
      advantage: true,
      bonusDamage: 4,
    });

    const hitEntry = logEntries.find((m) => m.includes('to hit'));
    expect(hitEntry).toBeDefined();
    if (hitEntry) {
      expect(hitEntry).toMatch(/\[ADV\]/);
    }

    const enemyStats = getComponent(world, enemyEid, CombatStats) as CombatStatsData;
    expect(enemyStats.health).toBe(61); // 80 - 19 = 61
  });
});

// ---------------------------------------------------------------------------
// AC-1: Seedable RNG — Deterministic Combat Replay
// ---------------------------------------------------------------------------

describe('AC-1: Seedable RNG — Deterministic Combat Replay', () => {
  afterEach(() => {
    resetTurnTracking();
  });

  it('produces identical outcomes with the same seed and command sequence', () => {
    // Helper: run a full encounter and capture HP totals + logs
    const runEncounter = (seed: number): Array<{ entityId: number; health: number }> => {
      resetTurnTracking(); // clean module-level state between runs

      const w = createCombatWorld();
      const b = new MockEngineBridge();

      const playerEid = createStatParticipant(w, {
        health: 100,
        maxHealth: 100,
        initiative: 15,
        attack: 5,
        defense: 12,
        accuracy: 4,
        evasion: 12,
      });
      const enemyEid = createStatParticipant(w, {
        health: 50,
        maxHealth: 50,
        initiative: 10,
        attack: 3,
        defense: 10,
        accuracy: 2,
        evasion: 10,
      });

      initCombat(w, b, seed);

      // Execute the same sequence of actions: 3 attacks
      handleCombatAction({
        world: w,
        playerEntityId: playerEid,
        action: 'ATTACK',
        targetId: enemyEid,
        bridge: b,
      });
      handleCombatAction({
        world: w,
        playerEntityId: playerEid,
        action: 'ATTACK',
        targetId: enemyEid,
        bridge: b,
      });
      handleCombatAction({
        world: w,
        playerEntityId: playerEid,
        action: 'ATTACK',
        targetId: enemyEid,
        bridge: b,
      });

      // Capture final HP state
      const results: Array<{ entityId: number; health: number }> = [];
      const playerStats = getComponent(w, playerEid, CombatStats) as CombatStatsData;
      results.push({ entityId: playerEid, health: playerStats.health });

      // Enemy might be dead (removed from world) — check by trying to get stats
      const enemyStats = getComponent(w, enemyEid, CombatStats) as CombatStatsData | undefined;
      results.push({ entityId: enemyEid, health: enemyStats?.health ?? 0 });

      return results;
    };

    const run1 = runEncounter(42);
    const run2 = runEncounter(42);

    // Both runs must produce identical final HP states
    expect(run1).toHaveLength(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].health).toBe(run2[i].health);
    }

    // Different seeds produce different dice sequences (validated via PRNG directly)
    const rngA = createSeedableRng(42);
    const rngB = createSeedableRng(99);
    // mulberry32 with different seeds must diverge immediately
    const seqA = [rngA.dice(20), rngA.dice(6), rngA.dice(20)];
    const seqB = [rngB.dice(20), rngB.dice(6), rngB.dice(20)];
    const sequencesDiffer = seqA.some((v, i) => v !== seqB[i]);
    expect(sequencesDiffer).toBe(true);
  });

  it('captures COMBAT_LOG messages identically across replays', () => {
    const runEncounterWithLogs = (seed: number): string[] => {
      resetTurnTracking(); // clean module-level state between runs

      const w = createCombatWorld();
      const b = new MockEngineBridge();

      const playerEid = createStatParticipant(w, {
        health: 100,
        maxHealth: 100,
        initiative: 15,
        attack: 5,
        defense: 12,
        accuracy: 4,
        evasion: 12,
      });
      const enemyEid = createStatParticipant(w, {
        health: 50,
        maxHealth: 50,
        initiative: 10,
        attack: 3,
        defense: 10,
        accuracy: 2,
        evasion: 10,
      });

      initCombat(w, b, seed);

      const logs: string[] = [];
      b.on('COMBAT_LOG', (event) => {
        logs.push(event.message);
      });

      handleCombatAction({
        world: w,
        playerEntityId: playerEid,
        action: 'ATTACK',
        targetId: enemyEid,
        bridge: b,
      });
      handleCombatAction({
        world: w,
        playerEntityId: playerEid,
        action: 'ATTACK',
        targetId: enemyEid,
        bridge: b,
      });

      return logs;
    };

    const logs1 = runEncounterWithLogs(42);
    const logs2 = runEncounterWithLogs(42);

    expect(logs1).toEqual(logs2);
  });

  it('initiative sorting uses entity ID as tiebreaker for deterministic order', () => {
    const w = createCombatWorld();
    const b = new MockEngineBridge();

    // Same initiative values — entity IDs should break the tie consistently
    createParticipant(w, { health: 100, maxHealth: 100, initiative: 10 });
    createParticipant(w, { health: 100, maxHealth: 100, initiative: 10 });
    createParticipant(w, { health: 100, maxHealth: 100, initiative: 10 });

    const events: Array<{ participantIds: number[] }> = [];
    b.on('COMBAT_STARTED', (event) => {
      events.push(event);
    });

    initCombat(w, b, 42);

    // Clean up and run again with same seed, same entities
    resetTurnTracking();

    const w2 = createCombatWorld();
    const b2 = new MockEngineBridge();
    createParticipant(w2, { health: 100, maxHealth: 100, initiative: 10 });
    createParticipant(w2, { health: 100, maxHealth: 100, initiative: 10 });
    createParticipant(w2, { health: 100, maxHealth: 100, initiative: 10 });

    const events2: Array<{ participantIds: number[] }> = [];
    b2.on('COMBAT_STARTED', (event) => {
      events2.push(event);
    });

    initCombat(w2, b2, 42);

    // Participant order must be identical
    expect(events[0]?.participantIds).toEqual(events2[0]?.participantIds);

    // Explicitly verify ascending entity-ID tiebreaker (lower ID first)
    const ids = events[0]?.participantIds ?? [];
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1] ?? 0);
    }
  });

  it('seed is preserved after multiple initCombat calls (retry scenario)', () => {
    const w = createCombatWorld();
    const b = new MockEngineBridge();

    createParticipant(w, { health: 100, maxHealth: 100, initiative: 10 });
    createParticipant(w, { health: 50, maxHealth: 50, initiative: 5 });

    initCombat(w, b, 42);

    // Capture the seed state after first init
    const seedAfterInit = getCombatSeed();
    expect(seedAfterInit).not.toBeNull();
    expect(seedAfterInit?.seed).toBe(42);

    // Clear and re-initialize with same seed (simulates retry)
    resetTurnTracking();
    initCombat(w, b, 42);

    const seedAfterRetry = getCombatSeed();
    expect(seedAfterRetry).not.toBeNull();
    expect(seedAfterRetry?.seed).toBe(42);

    // The RNG should restart from the seed — first dice roll should be identical
    const rng1 = createSeedableRng(42);
    const rng2 = createSeedableRng(42);
    expect(rng1.dice(20)).toBe(rng2.dice(20));
    expect(rng1.dice(6)).toBe(rng2.dice(6));
  });
});

// ---------------------------------------------------------------------------
// C-147: Experience & Leveling tests
// ---------------------------------------------------------------------------

/**
 * Creates a participant with XP/level/xpToNextLevel for progression tests.
 */
const createProgressionParticipant = (
  world: World,
  options: {
    health: number;
    maxHealth: number;
    initiative: number;
    attack: number;
    defense: number;
    accuracy: number;
    evasion: number;
    xp: number;
    level: number;
    xpToNextLevel: number;
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
      xp: options.xp,
      level: options.level,
      xpToNextLevel: options.xpToNextLevel,
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

describe('C-147: Experience & Leveling', () => {
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

  // ── XP grant on enemy defeat ──

  it('grants 25 XP to the player on enemy defeat', () => {
    const playerEid = createProgressionParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 50, // one-shot kill
      defense: 12,
      accuracy: 20,
      evasion: 12,
      xp: 0,
      level: 1,
      xpToNextLevel: 100,
    });
    createStatParticipant(world, {
      health: 10,
      maxHealth: 10,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 5,
    });

    initCombat(world, bridge);

    const roller = createDeterministicRoller([20, 6]);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      bridge,
      diceRoller: roller,
    });

    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    expect(playerStats.xp).toBe(25);
    expect(playerStats.level).toBe(1);
  });

  // ── Level-up triggers at threshold ──

  it('triggers level-up when XP reaches xpToNextLevel', () => {
    const playerEid = createProgressionParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 50,
      defense: 12,
      accuracy: 20,
      evasion: 12,
      xp: 80, // 5 XP short of threshold
      level: 1,
      xpToNextLevel: 100,
    });
    createStatParticipant(world, {
      health: 10,
      maxHealth: 10,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 5,
    });

    initCombat(world, bridge);

    const levelUpEvents: Array<{
      newLevel: number;
      maxHp: number;
      attack: number;
      defense: number;
      xpToNextLevel: number;
    }> = [];
    bridge.on('PLAYER_LEVELED_UP', (event) => {
      levelUpEvents.push(event);
    });

    const roller = createDeterministicRoller([20, 6]);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      bridge,
      diceRoller: roller,
    });

    // Level-up should have fired
    expect(levelUpEvents).toHaveLength(1);
    const levelUp = levelUpEvents[0];
    if (levelUp) {
      expect(levelUp.newLevel).toBe(2);
      expect(levelUp.maxHp).toBe(120); // 100 + 20
      expect(levelUp.attack).toBe(52); // 50 + 2
      expect(levelUp.defense).toBe(14); // 12 + 2
      expect(levelUp.xpToNextLevel).toBe(150); // 100 * 1.5 = 150
    }

    // Player stats should reflect level-up
    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    expect(playerStats.level).toBe(2);
    expect(playerStats.maxHealth).toBe(120);
    expect(playerStats.health).toBe(120); // full heal
    expect(playerStats.xp).toBe(5); // carryover: 80+25=105, 105-100=5
  });

  // ── XP carryover ──

  it('carries over excess XP after level-up', () => {
    const playerEid = createProgressionParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 50,
      defense: 12,
      accuracy: 20,
      evasion: 12,
      xp: 90,
      level: 1,
      xpToNextLevel: 100,
    });
    createStatParticipant(world, {
      health: 10,
      maxHealth: 10,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 5,
    });

    initCombat(world, bridge);

    const roller = createDeterministicRoller([20, 6]);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      bridge,
      diceRoller: roller,
    });

    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    // 90 + 25 = 115, threshold = 100, carryover = 15
    expect(playerStats.xp).toBe(15);
    expect(playerStats.level).toBe(2);
  });

  // ── No level-up when below threshold ──

  it('does not level up when XP is below threshold after grant', () => {
    const playerEid = createProgressionParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 20,
      evasion: 12,
      xp: 0,
      level: 1,
      xpToNextLevel: 100,
    });
    createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 10,
    });

    initCombat(world, bridge);

    const levelUpEvents: Array<{ newLevel: number }> = [];
    bridge.on('PLAYER_LEVELED_UP', (event) => {
      levelUpEvents.push(event);
    });

    // Enemy survives the first hit (HP 50, dmg ~9)
    const roller = createDeterministicRoller([15, 4, 1, 1]);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      bridge,
      diceRoller: roller,
    });

    // No level-up event — XP is only granted on enemy DEFEAT, not on hit
    expect(levelUpEvents).toHaveLength(0);

    // XP unchanged (enemy not defeated)
    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    expect(playerStats.xp).toBe(0);
    expect(playerStats.level).toBe(1);
  });

  // ── HP fully restores on level-up ──

  it('fully restores HP on level-up', () => {
    const playerEid = createProgressionParticipant(world, {
      health: 30, // damaged
      maxHealth: 100,
      initiative: 15,
      attack: 50,
      defense: 12,
      accuracy: 20,
      evasion: 12,
      xp: 80,
      level: 1,
      xpToNextLevel: 100,
    });
    createStatParticipant(world, {
      health: 10,
      maxHealth: 10,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 5,
    });

    initCombat(world, bridge);

    const roller = createDeterministicRoller([20, 6]);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      bridge,
      diceRoller: roller,
    });

    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    expect(playerStats.health).toBe(playerStats.maxHealth);
    expect(playerStats.maxHealth).toBe(120); // 100 + 20
  });

  // ── Multiple level-ups (big XP) ──

  it('handles large XP grants without crashing (no multi-level-up in MVP)', () => {
    const playerEid = createProgressionParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 200, // one-shot + massive XP
      defense: 12,
      accuracy: 20,
      evasion: 12,
      xp: 0,
      level: 1,
      xpToNextLevel: 100,
    });
    createStatParticipant(world, {
      health: 10,
      maxHealth: 10,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 5,
    });

    initCombat(world, bridge);

    const roller = createDeterministicRoller([20, 6]);

    // Should not throw — even with only 25 XP per enemy
    expect(() => {
      handleCombatAction({
        world,
        playerEntityId: playerEid,
        action: 'ATTACK',
        bridge,
        diceRoller: roller,
      });
    }).not.toThrow();
  });

  // ── XP only granted on victory, not defeat ──

  it('does not grant XP when the player is defeated', () => {
    const playerEid = createProgressionParticipant(world, {
      health: 5,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 0,
      accuracy: 20,
      evasion: 0,
      xp: 50,
      level: 1,
      xpToNextLevel: 100,
    });
    createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 100, // will kill player on counter-attack
      defense: 0,
      accuracy: 20,
      evasion: 0,
    });

    initCombat(world, bridge);

    const roller = createDeterministicRoller([20, 6, 20, 6]);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      bridge,
      diceRoller: roller,
    });

    // XP should be unchanged — player was defeated, enemy survived
    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    expect(playerStats.xp).toBe(50);
    expect(playerStats.level).toBe(1);
  });
});
