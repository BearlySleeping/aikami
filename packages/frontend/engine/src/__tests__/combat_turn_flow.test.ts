// packages/frontend/engine/src/__tests__/combat_turn_flow.test.ts
//
// C-514 (Combat-02) engine-level turn-flow coverage.
//
// These cases were split out of `turn_manager.test.ts` because that file is on
// the source-file-size guard's grandfathered baseline and the C-514 additions
// pushed it past it. They cover the explicit-turn model end to end on the
// production entry points:
//
//   AC-2  no enemy/companion turn runs inside the player's action; the turn
//         advances only on an explicit end, a forced end, or the auto-end policy
//   AC-3  budgets are real, spendable and observable on the engine path
//   AC-5  AI/companion turns run on their own active turn and stunned
//         combatants are auto-skipped
//
// Contract: C-514 AC-2, AC-3, AC-5

import { beforeEach, describe, expect, it } from 'bun:test';
import { DEFAULT_MOVEMENT_PER_TURN } from '@aikami/utils';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, set } from 'bitecs';
import { spendActiveBudget } from '../combat/combat_turn_driver.ts';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { StatusEffects } from '../components/status_effects.ts';
import type { TurnOrderData } from '../components/turn_order.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { advanceTurn, handleCombatAction, initCombat } from '../systems/turn_manager_system.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A world with the combat component observers registered. */
const createCombatWorld = (): World => {
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  return world;
};

/** Creates a combat participant with explicit combat stats. */
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

/** A predictable dice roller: returns values in sequence, wrapping around. */
const createDeterministicRoller = (rolls: number[]) => {
  let index = 0;
  return (_sides: number): number => {
    const value = rolls[index % rolls.length] ?? 1;
    index++;
    return value;
  };
};

// ---------------------------------------------------------------------------
// C-514 AC-2: the player's action never advances the turn
// ---------------------------------------------------------------------------

describe('C-514 AC-2: player action resolution does not advance the turn', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createCombatWorld();
    bridge = new MockEngineBridge();
  });

  it('DEFEND: emits a log entry and does not trigger an enemy counter-attack', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 4,
      evasion: 5, // low evasion so the enemy hits
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

    const roller = createDeterministicRoller([15, 4]);

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

    const defendEntry = logEntries.find((m) => m.includes('defensive stance'));
    expect(defendEntry).toBeDefined();

    // C-514 AC-2: the enemy does not act inside the player's action.
    expect(logEntries.find((m) => m.includes('Enemy rolls'))).toBeUndefined();

    // The enemy acts on its own turn, after the player ends theirs.
    advanceTurn(world, bridge);
    expect(logEntries.find((m) => m.includes('Enemy rolls'))).toBeDefined();

    // The turn wrapped back to the player.
    const playerTurn = getComponent(world, playerEid, TurnOrder) as TurnOrderData;
    expect(playerTurn.currentTurn).toBe(true);
    const enemyTurn = getComponent(world, enemyEid, TurnOrder) as TurnOrderData;
    expect(enemyTurn.currentTurn).toBe(false);
  });

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

    // Player attacks first; the enemy only acts once the player ends their turn.
    const roller = createDeterministicRoller([20, 6]);

    const downedEvents: Array<{ entityId: number }> = [];
    bridge.on('ENTITY_DOWNED', (event) => {
      downedEvents.push(event);
    });

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      bridge,
      diceRoller: roller,
    });

    // C-514 AC-2: no enemy turn inside the player's action.
    expect(downedEvents.length).toBe(0);

    advanceTurn(world, bridge);

    // Player HP is clamped at 0, never negative (C-338: downed state).
    // The turn wraps back to the player, whose death save may revive them to
    // 1 HP, so the upper bound is asserted rather than an exact 0.
    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    expect(playerStats.health).toBeGreaterThanOrEqual(0);
    expect(playerStats.health).toBeLessThanOrEqual(1);

    // ENTITY_DOWNED emitted (C-338: downed state replaces instant COMBAT_ENDED)
    expect(downedEvents.length).toBe(1);
    expect(downedEvents[0].entityId).toBe(playerEid);
  });
});

// ---------------------------------------------------------------------------
// C-514 AC-2: advancement only on explicit end turn / forced end / policy
// ---------------------------------------------------------------------------

describe('C-514 AC-2: no implicit enemy turn inside the player action', () => {
  let world: World;
  let bridge: MockEngineBridge;

  const makeRoster = (): { playerEid: number; enemyEid: number } => {
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
      defense: 0,
      accuracy: 2,
      evasion: 0,
    });
    return { playerEid, enemyEid };
  };

  beforeEach(() => {
    world = createCombatWorld();
    bridge = new MockEngineBridge();
  });

  it('does not change the active turn when an attack resolves', () => {
    const { playerEid, enemyEid } = makeRoster();
    initCombat(world, bridge);

    const turnEvents: Array<{ currentEntityId: number }> = [];
    bridge.on('TURN_CHANGED', (event) => {
      turnEvents.push(event);
    });
    const enemyLogs: string[] = [];
    bridge.on('COMBAT_LOG', (event) => {
      if (event.message.includes('Enemy rolls')) {
        enemyLogs.push(event.message);
      }
    });

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: createDeterministicRoller([20, 6]),
    });

    // The attack resolved…
    const enemyStats = getComponent(world, enemyEid, CombatStats) as CombatStatsData;
    expect(enemyStats.health).toBeLessThan(50);

    // …but the turn never moved and no enemy acted.
    expect(turnEvents).toHaveLength(0);
    expect(enemyLogs).toHaveLength(0);
    const playerTurn = getComponent(world, playerEid, TurnOrder) as TurnOrderData;
    expect(playerTurn.currentTurn).toBe(true);
  });

  it('advances only when the turn is explicitly ended', () => {
    const { playerEid, enemyEid } = makeRoster();
    initCombat(world, bridge);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: createDeterministicRoller([20, 6]),
    });

    const turnEvents: Array<{ currentEntityId: number }> = [];
    bridge.on('TURN_CHANGED', (event) => {
      turnEvents.push(event);
    });

    advanceTurn(world, bridge);

    expect(turnEvents[0]?.currentEntityId).toBe(enemyEid);
  });

  it('rejects a second standard action without spending anything', () => {
    const { playerEid, enemyEid } = makeRoster();
    initCombat(world, bridge);

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: createDeterministicRoller([20, 6]),
    });
    const afterFirst = (getComponent(world, enemyEid, CombatStats) as CombatStatsData).health;

    const logs: string[] = [];
    bridge.on('COMBAT_LOG', (event) => {
      logs.push(event.message);
    });
    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: createDeterministicRoller([20, 6]),
    });

    expect(logs.some((message) => message.includes('No standard action remaining'))).toBe(true);
    expect((getComponent(world, enemyEid, CombatStats) as CombatStatsData).health).toBe(afterFirst);
  });

  it('does not let a non-active combatant act', () => {
    const { playerEid, enemyEid } = makeRoster();
    initCombat(world, bridge);

    // The player is active; a command attributed to the enemy is refused.
    handleCombatAction({
      world,
      playerEntityId: enemyEid,
      action: 'ATTACK',
      targetId: playerEid,
      bridge,
      diceRoller: createDeterministicRoller([20, 6]),
    });

    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    expect(playerStats.health).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// C-514 AC-3: real, spendable budgets on the production path
// ---------------------------------------------------------------------------

describe('C-514 AC-3: budgets are real and observable', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createCombatWorld();
    bridge = new MockEngineBridge();
  });

  it('emits ACTION_ECONOMY_CHANGED with movementRemaining when an action is spent', () => {
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
      evasion: 0,
    });
    initCombat(world, bridge);

    const economyEvents: Array<{
      entityId: number;
      movementRemaining: number;
      actionAvailable: boolean;
      quickActionAvailable: boolean;
      bonusActionAvailable: boolean;
      reactionAvailable: boolean;
    }> = [];
    bridge.on('ACTION_ECONOMY_CHANGED', (event) => {
      economyEvents.push(event);
    });

    handleCombatAction({
      world,
      playerEntityId: playerEid,
      action: 'ATTACK',
      targetId: enemyEid,
      bridge,
      diceRoller: createDeterministicRoller([20, 6]),
    });

    const last = economyEvents.at(-1);
    expect(last).toBeDefined();
    expect(last?.entityId).toBe(playerEid);
    expect(last?.movementRemaining).toBe(DEFAULT_MOVEMENT_PER_TURN);
    expect(last?.actionAvailable).toBe(false);
    expect(last?.quickActionAvailable).toBe(true);
    // Deprecated alias kept for one release (Q3 resolution).
    expect(last?.bonusActionAvailable).toBe(true);
    expect(last?.reactionAvailable).toBe(true);
  });

  it('surfaces the rejection reason from spendActiveBudget', () => {
    const playerEid = createStatParticipant(world, {
      health: 100,
      maxHealth: 100,
      initiative: 15,
      attack: 5,
      defense: 12,
      accuracy: 20,
      evasion: 12,
    });
    createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 0,
    });
    initCombat(world, bridge);

    // Over-spending movement is a typed rejection.
    const overSpend = spendActiveBudget(world, 'movement', DEFAULT_MOVEMENT_PER_TURN + 1);
    expect(overSpend.ok).toBe(false);
    if (!overSpend.ok) {
      expect(overSpend.reason).toBe('movementBudgetExceeded');
    }

    // Reactions stay disabled until Combat-08.
    const reaction = spendActiveBudget(world, 'reaction');
    expect(reaction.ok).toBe(false);
    if (!reaction.ok) {
      expect(reaction.reason).toBe('noActionAvailable');
    }

    // A legal movement spend succeeds and is reported back.
    const movement = spendActiveBudget(world, 'movement', 2, bridge);
    expect(movement.ok).toBe(true);
    if (movement.ok) {
      expect(movement.budget.movementRemaining).toBe(DEFAULT_MOVEMENT_PER_TURN - 2);
    }
    expect(playerEid).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// C-514 AC-5: AI and companion turns run on their own active turn
// ---------------------------------------------------------------------------

describe('C-514 AC-5: AI turns run on their own active turn', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createCombatWorld();
    bridge = new MockEngineBridge();
  });

  it('resolves each enemy exactly once per round, in initiative order', () => {
    const playerEid = createStatParticipant(world, {
      health: 200,
      maxHealth: 200,
      initiative: 30,
      attack: 5,
      defense: 12,
      accuracy: 4,
      evasion: 12,
    });
    const firstEnemy = createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 20,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 0,
    });
    const secondEnemy = createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 10,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 0,
    });

    initCombat(world, bridge);

    const turnEvents: Array<{ currentEntityId: number }> = [];
    bridge.on('TURN_CHANGED', (event) => {
      turnEvents.push(event);
    });

    advanceTurn(world, bridge);

    expect(turnEvents.map((event) => event.currentEntityId)).toEqual([
      firstEnemy,
      secondEnemy,
      playerEid,
    ]);
  });

  it('auto-skips a stunned combatant with exactly one TURN_CHANGED for it', () => {
    const playerEid = createStatParticipant(world, {
      health: 200,
      maxHealth: 200,
      initiative: 30,
      attack: 5,
      defense: 12,
      accuracy: 4,
      evasion: 12,
    });
    const stunnedEnemy = createStatParticipant(world, {
      health: 50,
      maxHealth: 50,
      initiative: 20,
      attack: 3,
      defense: 0,
      accuracy: 2,
      evasion: 0,
    });

    initCombat(world, bridge);
    StatusEffects.isStunned[stunnedEnemy] = 1;

    const turnEvents: Array<{ currentEntityId: number }> = [];
    bridge.on('TURN_CHANGED', (event) => {
      turnEvents.push(event);
    });

    advanceTurn(world, bridge);

    expect(turnEvents.map((event) => event.currentEntityId)).toEqual([stunnedEnemy, playerEid]);
    // The stunned combatant took no action.
    const playerStats = getComponent(world, playerEid, CombatStats) as CombatStatsData;
    expect(playerStats.health).toBe(200);
  });
});
