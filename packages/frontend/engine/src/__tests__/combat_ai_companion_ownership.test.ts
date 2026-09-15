// packages/frontend/engine/src/__tests__/combat_ai_companion_ownership.test.ts
//
// C-526 AC-6: companion control modes decide WHO OWNS the turn.
//
//   direct                the player owns it — the AI layer is never asked
//   suggest/intent/auto   the engine defers, and the wait is bounded by the
//                         ENCOUNTER, not by a clock: a player deliberating over
//                         a plan is not an AI timeout
//   mode change           switching to `direct` withdraws the pending decision
//                         so no proposal can be approved after the player took
//                         the turn over
//
// The harness is a REAL bitECS world driven through the production encounter
// entry point and the production command dispatcher — no kernel mocks.
//
// Contract: C-526 AC-6

import { describe, expect, it } from 'bun:test';
import {
  BASIC_COMBAT_ABILITIES,
  BASIC_MELEE_ABILITY_ID,
  resolveCombatAbilityIds,
} from '@aikami/constants';
import type { CombatAiDegradedReason } from '@aikami/types';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import {
  type CombatAiTurnCoordinator,
  createCombatAiTurnCoordinator,
} from '../combat/combat_ai_turns.ts';
import { dispatchCombatCommand } from '../combat/combat_command_dispatch.ts';
import {
  type CombatEncounterParticipant,
  startEncounterFromCommand,
} from '../combat/combat_encounter_start.ts';
import { getCombatIdentityRegistry } from '../combat/combat_state_adapter.ts';
import { buildV2CombatState } from '../combat/combat_v2_resolver.ts';
import { registerCombatIdentityObservers } from '../components/combat_identity.ts';
import { registerCombatMovementObservers } from '../components/combat_movement.ts';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { Companion, registerCompanionObservers } from '../components/companion.ts';
import { registerEnemyObservers } from '../components/enemy.ts';
import { registerGridPositionObservers } from '../components/grid_position.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { resetCollisionGrid, setTerrainGrid } from '../systems/collision_system.ts';
import { TERRAIN_COST_SCALE } from '../systems/terrain_grid.ts';

const MAP_WIDTH = 12;
const MAP_HEIGHT = 8;
const TILE_SIZE = 32;
const ENCOUNTER_ID = 'c526/companion_ownership';
const SEED = 991;
const PLAYER_ID = 'player';
const COMPANION_ID = 'emberwatch/mira';
const ENEMY_ID = 'emberwatch/rat';

const installTerrain = (): void => {
  const cellCount = MAP_WIDTH * MAP_HEIGHT;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index++) {
    cost[index] = TERRAIN_COST_SCALE;
  }
  setTerrainGrid({ width: MAP_WIDTH, height: MAP_HEIGHT, tileSize: TILE_SIZE, cost, blocksSight });
};

const createPlayer = (world: World): number => {
  const eid = addEntity(world);
  addComponent(world, eid, CombatStats);
  addComponent(
    world,
    eid,
    set(CombatStats, {
      health: 60,
      maxHealth: 60,
      initiative: 10,
      attack: 5,
      defense: 0,
      accuracy: 20,
      evasion: 0,
    }),
  );
  addComponent(world, eid, TurnOrder);
  addComponent(
    world,
    eid,
    set(TurnOrder, { currentTurn: false, initiativeValue: 10, isActive: true }),
  );
  return eid;
};

/** Companion FIRST in initiative, so its turn is the one being decided. */
const rosterWith = (
  companionControlMode: 'direct' | 'suggest' | 'intent' | 'autonomous',
): CombatEncounterParticipant[] => [
  { combatantId: PLAYER_ID, team: 'player', cell: { x: 1, y: 1 }, classIds: ['fighter'] },
  {
    combatantId: COMPANION_ID,
    team: 'ally',
    cell: { x: 2, y: 1 },
    npcId: 'mira',
    stats: { hitPoints: 14, armorClass: 12, attackBonus: 3, initiative: 60 },
    abilityIds: [BASIC_MELEE_ABILITY_ID],
    controlMode: companionControlMode,
  },
  {
    combatantId: ENEMY_ID,
    team: 'enemy',
    cell: { x: 6, y: 1 },
    npcId: 'rat',
    stats: { hitPoints: 12, armorClass: 5, attackBonus: 3, initiative: 40 },
    abilityIds: [BASIC_MELEE_ABILITY_ID],
  },
];

type Harness = {
  world: World;
  bridge: MockEngineBridge;
  playerEid: number;
  requested: Array<{ requestId: string; combatantId: string }>;
  withdrawn: string[];
  degraded: Array<{ combatantId: string; reason: CombatAiDegradedReason }>;
  coordinator: CombatAiTurnCoordinator;
};

const createHarness = (
  companionControlMode: 'direct' | 'suggest' | 'intent' | 'autonomous',
  hardDeadlineMs = 5,
): Harness => {
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  registerCombatIdentityObservers(world);
  registerGridPositionObservers(world);
  registerCombatMovementObservers(world);
  registerEnemyObservers(world);
  registerCompanionObservers(world);
  installTerrain();

  const playerEid = createPlayer(world);
  const bridge = new MockEngineBridge();
  startEncounterFromCommand({
    world,
    bridge,
    command: {
      encounterId: ENCOUNTER_ID,
      seed: SEED,
      engine: 'v2',
      roster: { participants: rosterWith(companionControlMode) },
    },
    playerEntityId: playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    abilityIdsForClasses: resolveCombatAbilityIds,
    hooks: { runAiTurn: () => {}, emitStateUpdate: () => {} },
    startLegacy: () => {},
  });

  const requested: Harness['requested'] = [];
  const withdrawn: string[] = [];
  const degraded: Harness['degraded'] = [];
  bridge.on('COMBAT_AI_DECISION_REQUESTED', (event) => {
    requested.push({ requestId: event.requestId, combatantId: event.combatantId });
  });
  bridge.on('COMBAT_AI_DECISION_WITHDRAWN', (event) => {
    withdrawn.push(event.requestId);
  });

  const coordinator = createCombatAiTurnCoordinator({
    world,
    bridge,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    playerEntityId: playerEid,
    llmAgentsEnabled: true,
    hardDeadlineMs,
    onDegraded: (event) => {
      degraded.push(event);
    },
  });

  return { world, bridge, playerEid, requested, withdrawn, degraded, coordinator };
};

const settle = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

const combatantIds = (harness: Harness): string[] => {
  const state = buildV2CombatState({
    world: harness.world,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
  });
  return state === null ? [] : state.initiative.order;
};

describe('C-526 AC-6: companion control modes own the turn', () => {
  it('never asks the AI layer for a `direct` companion turn', () => {
    const harness = createHarness('direct');
    expect(combatantIds(harness)[0]).toBe(COMPANION_ID);
    harness.coordinator.run();
    expect(harness.requested).toHaveLength(0);
    expect(harness.coordinator.pendingCount).toBe(0);
    resetCollisionGrid();
  });

  it('defers a Suggest companion turn and asks the client for a proposal', () => {
    const harness = createHarness('suggest');
    harness.coordinator.run();
    expect(harness.requested).toHaveLength(1);
    expect(harness.requested[0]?.combatantId).toBe(COMPANION_ID);
    expect(harness.coordinator.pendingCount).toBe(1);
    harness.coordinator.cancelAll();
    resetCollisionGrid();
  });

  it('does NOT time out while the player deliberates over a companion plan', async () => {
    // A 5 ms model deadline: an enemy decision would already have fallen back.
    const harness = createHarness('suggest', 5);
    harness.coordinator.run();
    await settle(40);
    // Player deliberation is not an AI timeout: the turn is still held, and no
    // degradation was reported.
    expect(harness.coordinator.pendingCount).toBe(1);
    expect(harness.degraded.filter((entry) => entry.reason === 'timeout')).toHaveLength(0);
    harness.coordinator.cancelAll();
    resetCollisionGrid();
  });

  it('still times out an ENEMY decision on the same deadline', async () => {
    const world = createWorld();
    registerCombatStatsObservers(world);
    registerTurnOrderObservers(world);
    registerCombatIdentityObservers(world);
    registerGridPositionObservers(world);
    registerCombatMovementObservers(world);
    registerEnemyObservers(world);
    registerCompanionObservers(world);
    installTerrain();
    const playerEid = createPlayer(world);
    const bridge = new MockEngineBridge();
    startEncounterFromCommand({
      world,
      bridge,
      command: {
        encounterId: ENCOUNTER_ID,
        seed: SEED,
        engine: 'v2',
        // Enemy-only: it holds initiative and is the only deferred actor.
        roster: { participants: [
          { combatantId: PLAYER_ID, team: 'player', cell: { x: 1, y: 1 }, classIds: ['fighter'] },
          {
            combatantId: ENEMY_ID,
            team: 'enemy',
            cell: { x: 6, y: 1 },
            npcId: 'rat',
            stats: { hitPoints: 12, armorClass: 5, attackBonus: 3, initiative: 60 },
            abilityIds: [BASIC_MELEE_ABILITY_ID],
          },
        ] },
      },
      playerEntityId: playerEid,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      abilityIdsForClasses: resolveCombatAbilityIds,
      hooks: { runAiTurn: () => {}, emitStateUpdate: () => {} },
      startLegacy: () => {},
    });
    const degraded: Array<{ combatantId: string; reason: CombatAiDegradedReason }> = [];
    const coordinator = createCombatAiTurnCoordinator({
      world,
      bridge,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      playerEntityId: playerEid,
      llmAgentsEnabled: true,
      hardDeadlineMs: 5,
      onDegraded: (event) => {
        degraded.push(event);
      },
    });
    coordinator.run();
    await settle(40);
    expect(degraded.some((entry) => entry.reason === 'timeout')).toBe(true);
    coordinator.cancelAll();
    resetCollisionGrid();
  });

  it('withdraws a pending companion proposal when the player switches to `direct`', () => {
    const harness = createHarness('suggest');
    harness.coordinator.run();
    expect(harness.requested).toHaveLength(1);
    const requestId = harness.requested[0]?.requestId ?? '';

    dispatchCombatCommand(
      {
        type: 'COMBAT_COMPANION_MODE_SET',
        encounterId: ENCOUNTER_ID,
        combatantId: COMPANION_ID,
        mode: 'direct',
      },
      {
        world: harness.world,
        bridge: harness.bridge,
        playerEntityId: harness.playerEid,
        abilityCatalog: BASIC_COMBAT_ABILITIES,
        aiTurns: harness.coordinator,
      },
    );

    // The engine tells the client to drop the proposal, and holds nothing.
    expect(harness.withdrawn).toEqual([requestId]);
    expect(harness.coordinator.pendingCount).toBe(0);
    resetCollisionGrid();
  });

  it('lets the coordinator take the turn back when the mode leaves `direct`', () => {
    const harness = createHarness('direct');
    harness.coordinator.run();
    expect(harness.requested).toHaveLength(0);

    dispatchCombatCommand(
      {
        type: 'COMBAT_COMPANION_MODE_SET',
        encounterId: ENCOUNTER_ID,
        combatantId: COMPANION_ID,
        mode: 'autonomous',
      },
      {
        world: harness.world,
        bridge: harness.bridge,
        playerEntityId: harness.playerEid,
        abilityCatalog: BASIC_COMBAT_ABILITIES,
        aiTurns: harness.coordinator,
      },
    );

    expect(harness.requested).toHaveLength(1);
    expect(harness.requested[0]?.combatantId).toBe(COMPANION_ID);
    harness.coordinator.cancelAll();
    resetCollisionGrid();
  });

  it('ignores a mode change from a different encounter', () => {
    const harness = createHarness('suggest');
    harness.coordinator.run();
    dispatchCombatCommand(
      {
        type: 'COMBAT_COMPANION_MODE_SET',
        encounterId: 'another-encounter',
        combatantId: COMPANION_ID,
        mode: 'direct',
      },
      {
        world: harness.world,
        bridge: harness.bridge,
        playerEntityId: harness.playerEid,
        abilityCatalog: BASIC_COMBAT_ABILITIES,
        aiTurns: harness.coordinator,
      },
    );
    expect(harness.withdrawn).toHaveLength(0);
    expect(harness.coordinator.pendingCount).toBe(1);
    harness.coordinator.cancelAll();
    resetCollisionGrid();
  });

  it('does not convert a player or enemy into a recruited companion', () => {
    const harness = createHarness('direct');
    const registry = getCombatIdentityRegistry(harness.world);
    registry.sync(harness.world);
    const enemyEntityId = registry.toEntityId(ENEMY_ID);

    for (const combatantId of [PLAYER_ID, ENEMY_ID]) {
      dispatchCombatCommand(
        {
          type: 'COMBAT_COMPANION_MODE_SET',
          encounterId: ENCOUNTER_ID,
          combatantId,
          mode: 'suggest',
        },
        {
          world: harness.world,
          bridge: harness.bridge,
          playerEntityId: harness.playerEid,
          abilityCatalog: BASIC_COMBAT_ABILITIES,
          aiTurns: harness.coordinator,
        },
      );
    }

    expect(Companion.recruited[harness.playerEid]).not.toBe(true);
    expect(enemyEntityId === null ? undefined : Companion.recruited[enemyEntityId]).not.toBe(true);
    resetCollisionGrid();
  });
});
