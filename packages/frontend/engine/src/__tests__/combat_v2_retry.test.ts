// packages/frontend/engine/src/__tests__/combat_v2_retry.test.ts
//
// C-525 R-3 / C-516 AC-10: a v2 encounter retried with its preserved seed
// reproduces the same event stream and outcome on the SAME entities.
//
// The harness is a REAL bitECS world driven through the production entry point
// (`startEncounterFromCommand`) and the production retry wiring
// (`retryEncounter` → `startProductionEncounter`). No Worker is spun up.
//
// Contract: C-516 AC-10, C-525 R-3

import { afterEach, describe, expect, it } from 'bun:test';
import {
  BASIC_COMBAT_ABILITIES,
  BASIC_MELEE_ABILITY_ID,
  resolveCombatAbilityIds,
} from '@aikami/constants';
import { canonicalCombatJson } from '@aikami/utils';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, query, set } from 'bitecs';
import { dispatchCombatCommand } from '../combat/combat_command_dispatch.ts';
import { clearEncounterRetryRecord, retryEncounter } from '../combat/combat_encounter_retry.ts';
import type {
  CombatEncounterParticipant,
  StartEncounterResult,
} from '../combat/combat_encounter_start.ts';
import {
  startEncounterFromCommand,
  startProductionEncounter,
} from '../combat/combat_encounter_start.ts';
import { getActiveTurn } from '../combat/combat_turn_driver.ts';
import { runV2AiTurns } from '../combat/combat_v2_ai.ts';
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
import { emitCombatStateUpdate } from '../systems/turn_manager_system.ts';
import type { GameEvent } from '../types.ts';

const MAP_WIDTH = 10;
const MAP_HEIGHT = 8;
const TILE_SIZE = 32;
const ENCOUNTER_ID = 'c525/retry_encounter';
const SEED = 4242;
const DETERMINISTIC_ENEMY_ATTACK_BONUS = 100;

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
      health: 40,
      maxHealth: 40,
      initiative: 30,
      attack: 5,
      defense: 0,
      accuracy: 20,
      evasion: 30,
    }),
  );
  addComponent(world, eid, TurnOrder);
  addComponent(
    world,
    eid,
    set(TurnOrder, { currentTurn: false, initiativeValue: 30, isActive: true }),
  );
  return eid;
};

const ROSTER: CombatEncounterParticipant[] = [
  {
    combatantId: 'player',
    team: 'player',
    cell: { x: 1, y: 1 },
    classIds: ['fighter'],
  },
  {
    combatantId: 'emberwatch/rat',
    team: 'enemy',
    cell: { x: 2, y: 1 },
    npcId: 'rat',
    stats: {
      hitPoints: 8,
      armorClass: 5,
      attackBonus: DETERMINISTIC_ENEMY_ATTACK_BONUS,
      initiative: 5,
    },
    abilityIds: [BASIC_MELEE_ABILITY_ID],
  },
];

type CombatEventName = Extract<
  GameEvent,
  {
    type:
      | 'COMBAT_STARTED'
      | 'COMBAT_ENDED'
      | 'COMBAT_LOG'
      | 'DAMAGE_DEALT'
      | 'TURN_CHANGED'
      | 'ACTION_ECONOMY_CHANGED'
      | 'COMBAT_COMMAND_REJECTED';
  }
>['type'];

const CAPTURED_EVENTS: CombatEventName[] = [
  'COMBAT_STARTED',
  'COMBAT_ENDED',
  'COMBAT_LOG',
  'DAMAGE_DEALT',
  'TURN_CHANGED',
  'ACTION_ECONOMY_CHANGED',
  'COMBAT_COMMAND_REJECTED',
];

type Harness = {
  world: World;
  bridge: MockEngineBridge;
  playerEid: number;
  started: StartEncounterResult;
  abilityIdsByCombatant: Record<string, string[]>;
  events: Array<{ type: CombatEventName }>;
};

const createHarness = (): Harness => {
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
  const events: Harness['events'] = [];
  for (const type of CAPTURED_EVENTS) {
    bridge.on(type, (event) => events.push(event));
  }

  const started = startEncounterFromCommand({
    world,
    bridge,
    command: {
      encounterId: ENCOUNTER_ID,
      seed: SEED,
      engine: 'v2',
      roster: { participants: ROSTER },
    },
    playerEntityId: playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    abilityIdsForClasses: resolveCombatAbilityIds,
    hooks: { runAiTurn: () => {}, emitStateUpdate: emitCombatStateUpdate },
    startLegacy: () => {},
  });

  return {
    world,
    bridge,
    playerEid,
    started,
    abilityIdsByCombatant: started.ok ? started.abilityIdsByCombatant : {},
    events,
  };
};

/** Replays the retry exactly as the worker wires it. */
const retry = (harness: Harness): StartEncounterResult | null =>
  retryEncounter({
    world: harness.world,
    start: (roster) =>
      startProductionEncounter({
        world: harness.world,
        bridge: harness.bridge,
        roster,
        playerEntityId: harness.playerEid,
        abilityCatalog: BASIC_COMBAT_ABILITIES,
        hooks: { runAiTurn: () => {}, emitStateUpdate: emitCombatStateUpdate },
      }),
  });

type Attempt = {
  /** Canonical JSON of the kernel state before the first command. */
  initialState: string;
  /** Every battle event the bridge emitted, in order. */
  eventStream: string[];
  /** Canonical JSON of the kernel state after the encounter ended. */
  finalState: string | null;
  outcome: { victory: boolean } | null;
};

/**
 * Plays a fixed policy — player ATTACKs the rat, then ends its turn — until the
 * encounter ends. The event log is cleared first so start/retry chatter is not
 * part of the compared stream.
 */
const playEncounter = (harness: Harness): Attempt => {
  const { world, bridge, playerEid, abilityIdsByCombatant } = harness;
  harness.events.length = 0;

  const initialState = canonicalCombatJson(
    buildV2CombatState({ world, abilityCatalog: BASIC_COMBAT_ABILITIES, abilityIdsByCombatant }),
  );

  const commandContext = {
    world,
    bridge,
    playerEntityId: playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    abilityIdsByCombatant,
  };

  for (let guard = 0; guard < 40; guard++) {
    const active = getActiveTurn(world);
    if (active === null) {
      break;
    }
    if (active.entityId === playerEid) {
      dispatchCombatCommand(
        { type: 'COMBAT_ACTION', action: 'ATTACK', targetId: 'emberwatch/rat' } as never,
        commandContext,
      );
      if (getActiveTurn(world) === null) {
        break;
      }
      dispatchCombatCommand({ type: 'COMBAT_END_TURN' } as never, commandContext);
    } else {
      runV2AiTurns({
        world,
        bridge,
        abilityCatalog: BASIC_COMBAT_ABILITIES,
        playerEntityId: playerEid,
        abilityIdsByCombatant,
      });
    }
  }

  const finalState = canonicalCombatJson(
    buildV2CombatState({ world, abilityCatalog: BASIC_COMBAT_ABILITIES, abilityIdsByCombatant }),
  );
  const ended = harness.events.find((event) => event.type === 'COMBAT_ENDED') as
    | Extract<GameEvent, { type: 'COMBAT_ENDED' }>
    | undefined;

  return {
    initialState,
    eventStream: harness.events.map((event) => JSON.stringify(event)),
    finalState,
    outcome: ended === undefined ? null : { victory: ended.victory },
  };
};

afterEach(() => {
  resetCollisionGrid();
  resetCombatComponentGlobals();
});

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

describe('C-525 R-3: deterministic v2 retry', () => {
  it('reproduces the same initial state, event stream and outcome', () => {
    const harness = createHarness();
    expect(harness.started.ok).toBe(true);

    const openingPlayerHp = CombatStats.health[harness.playerEid];
    const first = playEncounter(harness);
    expect(first.outcome).not.toBeNull();
    expect(CombatStats.health[harness.playerEid]).toBeLessThan(openingPlayerHp);

    const combatantsBefore = query(harness.world, [CombatStats]).length;
    const retried = retry(harness);
    expect(retried?.ok).toBe(true);
    expect(CombatStats.health[harness.playerEid]).toBe(openingPlayerHp);

    // COMBAT_STARTED is re-emitted for the SAME engine and the real roster,
    // and the retry reuses the existing entities instead of spawning a copy.
    const restarted = harness.events.find((event) => event.type === 'COMBAT_STARTED') as
      | Extract<GameEvent, { type: 'COMBAT_STARTED' }>
      | undefined;
    expect(restarted?.engine).toBe('v2');
    expect(restarted?.participantIds).toHaveLength(ROSTER.length);
    expect(query(harness.world, [CombatStats]).length).toBe(combatantsBefore);

    const second = playEncounter(harness);

    expect(second.initialState).toBe(first.initialState);
    expect(second.eventStream).toEqual(first.eventStream);
    expect(second.outcome).toEqual(first.outcome);
    expect(second.finalState).toBe(first.finalState);

    clearEncounterRetryRecord(harness.world);
  });
});
