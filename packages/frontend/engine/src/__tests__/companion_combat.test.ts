// packages/frontend/engine/src/__tests__/companion_combat.test.ts
//
// Companion combat participation — unit tests for the turn manager's
// C-340 AC-4 integration: recruited companions join the turn order and
// take AI-controlled actions (attack nearest enemy / heal damaged ally).
//
// Contract: C-340 Build Party and Companion Gameplay (AC-4)

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { Companion, registerCompanionObservers } from '../components/companion.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { advanceTurn, initCombat, resetTurnTracking } from '../systems/turn_manager_system.ts';
import type { GameEvent } from '../types.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const createCombatWorld = (): World => {
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  registerCompanionObservers(world);
  registerPositionObservers(world);
  return world;
};

/** Registers listeners for every GameEvent type and records them in order. */
const recordEvents = (bridge: MockEngineBridge): GameEvent[] => {
  const events: GameEvent[] = [];
  const eventTypes: GameEvent['type'][] = [
    'COMBAT_STARTED',
    'COMBAT_LOG',
    'TURN_CHANGED',
    'ACTION_ECONOMY_CHANGED',
    'COMBAT_STATE_UPDATE',
    'COMBAT_ENDED',
  ];
  for (const type of eventTypes) {
    bridge.on(type, (event) => events.push(event));
  }
  return events;
};

/** Spawns a plain combat participant (player or enemy) with TurnOrder active. */
const spawnParticipant = (
  world: World,
  options: { health: number; maxHealth: number; initiative: number },
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

/**
 * Entity IDs given a Companion component this test file has touched.
 * `Companion`'s SoA arrays are module-level state shared across every test
 * file in the process (bitECS entity IDs restart from 1 per `createWorld()`
 * call) — leaving `recruited: true` set on a low entity ID would leak into
 * unrelated tests in other files that happen to reuse that same ID. Cleared
 * in `afterEach` below.
 */
let touchedCompanionEids: number[] = [];

/** Spawns a recruited companion — Companion + CombatStats + active TurnOrder. */
const spawnRecruitedCompanion = (
  world: World,
  options: { health: number; maxHealth: number; initiative: number; classId: string },
): number => {
  const eid = spawnParticipant(world, options);
  CombatStats.classId[eid] = options.classId;
  CombatStats.attack[eid] = 10;
  CombatStats.accuracy[eid] = 20; // guarantees a hit against low-evasion enemies
  // Companion targeting (_findClosestEnemy) requires a Position on the
  // source entity to run its nearest-enemy scan; without one it falls back
  // to "first non-self participant", which can resolve to an ally.
  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: 0, y: 0 }));
  addComponent(world, eid, Companion);
  addComponent(world, eid, set(Companion, { companionIdHandle: 0, approval: 0, recruited: true }));
  touchedCompanionEids.push(eid);
  return eid;
};

describe('Companion combat (C-340 AC-4)', () => {
  let world: World;
  let bridge: MockEngineBridge;
  let events: GameEvent[];

  beforeEach(() => {
    world = createCombatWorld();
    bridge = new MockEngineBridge();
    events = recordEvents(bridge);
    resetTurnTracking();
    touchedCompanionEids = [];
  });

  afterEach(() => {
    resetTurnTracking();
    for (const eid of touchedCompanionEids) {
      Companion.recruited[eid] = false;
    }
    touchedCompanionEids = [];
  });

  test('a recruited companion is included in the combat turn order', () => {
    const playerId = spawnParticipant(world, { health: 100, maxHealth: 100, initiative: 20 });
    const companionId = spawnRecruitedCompanion(world, {
      health: 30,
      maxHealth: 30,
      initiative: 15,
      classId: 'fighter',
    });
    spawnParticipant(world, { health: 40, maxHealth: 40, initiative: 5 }); // enemy

    initCombat(world, bridge);

    const started = events.find((e) => e.type === 'COMBAT_STARTED') as
      | { participantIds: number[] }
      | undefined;
    expect(started?.participantIds).toContain(playerId);
    expect(started?.participantIds).toContain(companionId);
  });

  test('an unrecruited companion (isActive: false) does not join the turn order', () => {
    spawnParticipant(world, { health: 100, maxHealth: 100, initiative: 20 }); // player
    const eid = addEntity(world);
    addComponent(world, eid, CombatStats);
    addComponent(world, eid, set(CombatStats, { health: 30, maxHealth: 30, initiative: 15 }));
    addComponent(world, eid, TurnOrder);
    addComponent(
      world,
      eid,
      set(TurnOrder, { currentTurn: false, initiativeValue: 15, isActive: false }),
    );
    addComponent(world, eid, Companion);
    addComponent(
      world,
      eid,
      set(Companion, { companionIdHandle: 0, approval: 0, recruited: false }),
    );
    touchedCompanionEids.push(eid);

    initCombat(world, bridge);

    const started = events.find((e) => e.type === 'COMBAT_STARTED') as
      | { participantIds: number[] }
      | undefined;
    expect(started?.participantIds).not.toContain(eid);
  });

  test('a fighter companion auto-attacks the nearest enemy on its turn', () => {
    spawnParticipant(world, { health: 100, maxHealth: 100, initiative: 20 }); // player, eid 1
    spawnRecruitedCompanion(world, {
      health: 30,
      maxHealth: 30,
      initiative: 15,
      classId: 'fighter',
    });
    const enemyId = spawnParticipant(world, { health: 40, maxHealth: 40, initiative: 5 });
    CombatStats.evasion[enemyId] = 0; // guarantee the companion's hit lands

    initCombat(world, bridge);
    // Player's turn first (highest initiative) — advance to the companion.
    advanceTurn(world, bridge);

    const attackLog = events.find(
      (e) => e.type === 'COMBAT_LOG' && (e as { message: string }).message.includes('attacks'),
    );
    expect(attackLog).toBeDefined();
    expect(CombatStats.health[enemyId]).toBeLessThan(40);
  });

  test('a cleric companion heals the most damaged ally instead of attacking', () => {
    const playerId = spawnParticipant(world, { health: 20, maxHealth: 100, initiative: 20 }); // damaged player, eid 1
    spawnRecruitedCompanion(world, {
      health: 30,
      maxHealth: 30,
      initiative: 15,
      classId: 'cleric',
    });
    spawnParticipant(world, { health: 40, maxHealth: 40, initiative: 5 }); // enemy

    initCombat(world, bridge);
    advanceTurn(world, bridge); // player's turn -> companion's turn

    const healLog = events.find(
      (e) => e.type === 'COMBAT_LOG' && (e as { message: string }).message.includes('heals'),
    );
    expect(healLog).toBeDefined();
    expect(CombatStats.health[playerId]).toBeGreaterThan(20);
  });
});
