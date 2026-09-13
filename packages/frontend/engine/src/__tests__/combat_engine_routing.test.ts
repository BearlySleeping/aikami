// packages/frontend/engine/src/__tests__/combat_engine_routing.test.ts
//
// C-516 (Combat-04) engine routing coverage.
//
//   AC-6  legacy is preserved and selectable; the engine is chosen once per
//         encounter and the dispatcher branches on THAT record, not on the
//         feature flag.
//
// The discriminator is a real behavioural difference: the legacy DEFEND path
// writes the "Player takes a defensive stance!" log entry, while the v2 path
// resolves DEFEND through the kernel and emits no log for it. Whichever engine
// was pinned at encounter start decides which marker appears.
//
// Contract: C-516 AC-6

import { afterEach, describe, expect, it } from 'bun:test';
import { BASIC_COMBAT_ABILITIES, resolveCombatAbilityIds } from '@aikami/constants';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { dispatchCombatCommand } from '../combat/combat_command_dispatch.ts';
import type { CombatEncounterParticipant } from '../combat/combat_encounter_start.ts';
import {
  clearEncounterEngine,
  getEncounterEngine,
  startEncounterFromCommand,
} from '../combat/combat_encounter_start.ts';
import { buildV2CombatState } from '../combat/combat_v2_resolver.ts';
import { CombatIdentity, registerCombatIdentityObservers } from '../components/combat_identity.ts';
import { CombatMovement, registerCombatMovementObservers } from '../components/combat_movement.ts';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { Companion, registerCompanionObservers } from '../components/companion.ts';
import { Enemy, registerEnemyObservers } from '../components/enemy.ts';
import { registerGridPositionObservers } from '../components/grid_position.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { resetCollisionGrid, setTerrainGrid } from '../systems/collision_system.ts';
import { TERRAIN_COST_SCALE } from '../systems/terrain_grid.ts';
import { emitCombatStateUpdate, initCombat } from '../systems/turn_manager_system.ts';

const MAP_WIDTH = 10;
const MAP_HEIGHT = 8;
const TILE_SIZE = 32;
const LEGACY_DEFEND_MARKER = 'Player takes a defensive stance!';

const installTerrain = (): void => {
  const cellCount = MAP_WIDTH * MAP_HEIGHT;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index++) {
    cost[index] = TERRAIN_COST_SCALE;
  }
  setTerrainGrid({ width: MAP_WIDTH, height: MAP_HEIGHT, tileSize: TILE_SIZE, cost, blocksSight });
};

const ROSTER: CombatEncounterParticipant[] = [
  {
    combatantId: 'player',
    team: 'player',
    cell: { x: 1, y: 1 },
    stats: { hitPoints: 40, armorClass: 10, attackBonus: 8, initiative: 30 },
    classIds: ['fighter'],
  },
  {
    combatantId: 'emberwatch/rollo_grasper',
    team: 'enemy',
    cell: { x: 4, y: 1 },
    npcId: 'rollo_grasper',
    stats: { hitPoints: 40, armorClass: 10, attackBonus: 2, initiative: 5 },
  },
];

const createPlayer = (world: World): number => {
  const playerEid = addEntity(world);
  addComponent(world, playerEid, CombatStats);
  addComponent(
    world,
    playerEid,
    set(CombatStats, {
      health: 40,
      maxHealth: 40,
      initiative: 30,
      attack: 5,
      defense: 0,
      accuracy: 8,
      evasion: 10,
    }),
  );
  addComponent(world, playerEid, TurnOrder);
  addComponent(
    world,
    playerEid,
    set(TurnOrder, { currentTurn: false, initiativeValue: 30, isActive: true }),
  );
  return playerEid;
};

type Harness = {
  world: World;
  bridge: MockEngineBridge;
  playerEid: number;
  messages: string[];
};

const createHarness = (engine: 'legacy' | 'v2'): Harness => {
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  registerCombatIdentityObservers(world);
  registerGridPositionObservers(world);
  registerCombatMovementObservers(world);
  registerEnemyObservers(world);
  registerCompanionObservers(world);
  installTerrain();

  const bridge = new MockEngineBridge();
  const playerEid = createPlayer(world);
  const messages: string[] = [];
  bridge.on('COMBAT_LOG', (event) => messages.push(event.message));

  const started = startEncounterFromCommand({
    world,
    bridge,
    command: { encounterId: 'c516-routing', seed: 99, engine, roster: ROSTER },
    playerEntityId: playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    abilityIdsForClasses: resolveCombatAbilityIds,
    hooks: { runAiTurn: () => {}, emitStateUpdate: emitCombatStateUpdate },
    startLegacy: (targetWorld, targetBridge, seed) => {
      initCombat(targetWorld, targetBridge, seed);
    },
  });
  expect(started.ok).toBe(true);

  return { world, bridge, playerEid, messages };
};

const dispatchDefend = (harness: Harness): void => {
  dispatchCombatCommand({ type: 'COMBAT_ACTION', action: 'DEFEND' } as never, {
    world: harness.world,
    bridge: harness.bridge,
    playerEntityId: harness.playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
  });
};

afterEach(() => {
  resetCollisionGrid();
  resetCombatComponentGlobals();
});

/**
 * The combat SoA components are MODULE-level arrays keyed by eid, and eids are
 * recycled across worlds — so a world created later can read the values this
 * file wrote. Clear the slots this file touches so no later test file inherits
 * an authored enemy/companion identity.
 */
const resetCombatComponentGlobals = (): void => {
  for (let eid = 0; eid < 64; eid++) {
    Companion.recruited[eid] = false;
    Companion.npcId[eid] = '';
    Companion.approval[eid] = 0;
    Enemy.isActive[eid] = false;
    Enemy.spawnId[eid] = '';
    Enemy.encounterId[eid] = '';

    delete CombatMovement.movementPerTurn[eid];
    CombatIdentity.combatantId[eid] = '';
  }
};

describe('C-516 AC-6: legacy is preserved and selectable', () => {
  it('routes a legacy encounter through the legacy turn manager', () => {
    const harness = createHarness('legacy');
    expect(getEncounterEngine(harness.world)).toBe('legacy');

    dispatchDefend(harness);
    expect(harness.messages).toContain(LEGACY_DEFEND_MARKER);
  });

  it('routes a v2 encounter through the v2 resolver', () => {
    const harness = createHarness('v2');
    expect(getEncounterEngine(harness.world)).toBe('v2');

    dispatchDefend(harness);
    // The legacy marker is absent: the kernel resolved DEFEND instead.
    expect(harness.messages).not.toContain(LEGACY_DEFEND_MARKER);
    const state = buildV2CombatState({
      world: harness.world,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    });
    expect(state?.stateRevision).toBe(1);
    expect(state?.combatants.player?.budget.actionAvailable).toBe(false);
  });

  it('branches on the pinned record, not on the flag', () => {
    const harness = createHarness('v2');
    // Clearing the pinned engine (what a mid-fight teardown would do) makes the
    // very same world route to legacy — so the decision is the record, read
    // once, and not a per-command flag lookup.
    clearEncounterEngine(harness.world);
    expect(getEncounterEngine(harness.world)).toBeUndefined();

    dispatchDefend(harness);
    expect(harness.messages).toContain(LEGACY_DEFEND_MARKER);
  });

  it('switching engines for the next encounter needs no code change', () => {
    const first = createHarness('legacy');
    dispatchDefend(first);
    expect(first.messages).toContain(LEGACY_DEFEND_MARKER);

    const second = createHarness('v2');
    dispatchDefend(second);
    expect(second.messages).not.toContain(LEGACY_DEFEND_MARKER);
    expect(getEncounterEngine(second.world)).toBe('v2');
  });

  it('rejects SUPPORT and REVIVE before either resolver receives them', () => {
    for (const engine of ['legacy', 'v2'] as const) {
      for (const action of ['SUPPORT', 'REVIVE'] as const) {
        const harness = createHarness(engine);
        const rejected: string[] = [];
        harness.bridge.on('COMBAT_COMMAND_REJECTED', (event) => {
          rejected.push(event.reasonCode);
        });

        dispatchCombatCommand({ type: 'COMBAT_ACTION', action } as never, {
          world: harness.world,
          bridge: harness.bridge,
          playerEntityId: harness.playerEid,
          abilityCatalog: BASIC_COMBAT_ABILITIES,
        });

        expect(rejected).toEqual(['invalidCommandShape']);
        expect(harness.messages).not.toContain(LEGACY_DEFEND_MARKER);
      }
    }
  });
});
