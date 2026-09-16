// packages/frontend/engine/src/__tests__/combat_reaction_bridge.test.ts
//
// C-532 (Combat-08) reaction bridge round trip.
//
//   AC-3  an opportunity attack suspends and resumes a move
//
// The harness drives the PRODUCTION dispatch entry point
// (`dispatchCombatCommand`) against a real bitECS world, so the bridge
// registration, the worker routing, the kernel commit, the ECS apply and the
// event mapping are all exercised together. No Worker is spun up.
//
// Before C-532 wired this path the kernel could open a window nothing in the
// client could resolve: `COMBAT_REACTION_SELECTED` had no registered forwarder
// (so `EngineBridge.send` dropped it) and nothing emitted
// `COMBAT_REACTION_OPENED`, leaving the encounter suspended in phase
// `'reaction'` forever.
//
// Contract: C-532 AC-3

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BASIC_COMBAT_ABILITIES, OPPORTUNITY_ATTACK_ABILITY_ID } from '@aikami/constants';
import { emptyMoraleRules, emptyObjectiveRules } from '@aikami/schemas';
import type { ReactionRegistry } from '@aikami/types';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import {
  dispatchCombatCommand,
  isCombatDispatchCommand,
} from '../combat/combat_command_dispatch.ts';
import type { EncounterDepth } from '../combat/combat_encounter_depth.ts';
import type {
  CombatEncounterParticipant,
  CombatEncounterRoster,
} from '../combat/combat_encounter_start.ts';
import { startProductionEncounter } from '../combat/combat_encounter_start.ts';
import { buildV2CombatState } from '../combat/combat_v2_resolver.ts';
import { CombatIdentity, registerCombatIdentityObservers } from '../components/combat_identity.ts';
import { CombatMovement, registerCombatMovementObservers } from '../components/combat_movement.ts';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { Companion, registerCompanionObservers } from '../components/companion.ts';
import { Enemy, registerEnemyObservers } from '../components/enemy.ts';
import { GridPosition, registerGridPositionObservers } from '../components/grid_position.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { resetCollisionGrid, setTerrainGrid } from '../systems/collision_system.ts';
import { TERRAIN_COST_SCALE } from '../systems/terrain_grid.ts';

const MAP_WIDTH = 12;
const MAP_HEIGHT = 8;
const TILE_SIZE = 32;
const ENCOUNTER_ID = 'c532-reaction-encounter';
const PLAYER_ID = 'player';
const ENEMY_ID = 'emberwatch/ash_hound';

/** One registered opportunity attack — the only reaction this release ships. */
const REACTION_REGISTRY: ReactionRegistry = {
  definitions: [
    {
      reactionId: 'reaction.opportunity_attack',
      triggerKind: 'opportunity_attack',
      abilityId: OPPORTUNITY_ATTACK_ABILITY_ID,
      threatRangeCells: 1,
    },
  ],
};

const DEPTH: EncounterDepth = {
  objectiveRules: emptyObjectiveRules(),
  moraleRules: emptyMoraleRules(),
  reactionRegistry: REACTION_REGISTRY,
};

const installTerrain = (): void => {
  const cellCount = MAP_WIDTH * MAP_HEIGHT;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index++) {
    cost[index] = TERRAIN_COST_SCALE;
  }
  setTerrainGrid({ width: MAP_WIDTH, height: MAP_HEIGHT, tileSize: TILE_SIZE, cost, blocksSight });
};

const playerParticipant = (cell: { x: number; y: number }): CombatEncounterParticipant => ({
  combatantId: PLAYER_ID,
  team: 'player',
  cell,
  stats: { hitPoints: 40, armorClass: 10, attackBonus: 10, initiative: 30 },
  classIds: ['wizard'],
});

const enemyParticipant = (cell: { x: number; y: number }): CombatEncounterParticipant => ({
  combatantId: ENEMY_ID,
  team: 'enemy',
  cell,
  npcId: 'ash_hound',
  stats: { hitPoints: 40, armorClass: 10, attackBonus: 2, initiative: 5 },
});

type OpenedEvent = {
  windowId: string;
  windowVersion: number;
  encounterRunId: string;
  moverId: string;
  reactionId: string;
  currentReactorId: string | null;
  reactorQueue: string[];
  triggerCell: { x: number; y: number };
  reactionPolicy: string;
  abilityId: string;
  committedCells: Array<{ x: number; y: number }>;
};

type Fixture = {
  world: World;
  bridge: MockEngineBridge;
  playerEid: number;
  enemyEid: number;
  opened: OpenedEvent[];
  rejected: Array<{ reasonCode: string }>;
};

const buildFixture = (options: { withReactions?: boolean } = {}): Fixture => {
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
      accuracy: 10,
      evasion: 10,
    }),
  );
  addComponent(world, playerEid, TurnOrder);
  addComponent(
    world,
    playerEid,
    set(TurnOrder, { currentTurn: false, initiativeValue: 30, isActive: true }),
  );

  const roster: CombatEncounterRoster = {
    encounterId: ENCOUNTER_ID,
    seed: 1234,
    engine: 'v2',
    participants: [playerParticipant({ x: 1, y: 1 }), enemyParticipant({ x: 2, y: 1 })],
    ...(options.withReactions === false ? {} : { depth: DEPTH }),
  };

  const started = startProductionEncounter({
    world,
    bridge,
    roster,
    playerEntityId: playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    hooks: { runAiTurn: () => {}, emitStateUpdate: () => {} },
  });
  expect(started.ok).toBe(true);

  const opened: OpenedEvent[] = [];
  const rejected: Array<{ reasonCode: string }> = [];
  bridge.on('COMBAT_REACTION_OPENED', (event) => opened.push(event as OpenedEvent));
  bridge.on('COMBAT_COMMAND_REJECTED', (event) => rejected.push(event));

  return {
    world,
    bridge,
    playerEid,
    enemyEid: started.ok ? (started.participantIds[1] ?? 0) : 0,
    opened,
    rejected,
  };
};

const dispatch = (target: Fixture, command: Parameters<typeof dispatchCombatCommand>[0]): void => {
  dispatchCombatCommand(command, {
    world: target.world,
    bridge: target.bridge,
    playerEntityId: target.playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
  });
};

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

let fixture: Fixture;

beforeEach(() => {
  fixture = buildFixture();
});

afterEach(() => {
  resetCollisionGrid();
  resetCombatComponentGlobals();
});

const liveState = (target: Fixture) =>
  buildV2CombatState({ world: target.world, abilityCatalog: BASIC_COMBAT_ABILITIES });

describe('C-532 AC-3: the reaction bridge round trip', () => {
  it('routes COMBAT_REACTION_SELECTED through the combat dispatcher', () => {
    // An unregistered command is dropped on the main thread and an unrouted one
    // is dropped in the worker — either leaves the window unresolved.
    expect(
      isCombatDispatchCommand({
        type: 'COMBAT_REACTION_SELECTED',
        encounterId: ENCOUNTER_ID,
        encounterRunId: 'run',
        windowId: 'w',
        windowVersion: 1,
        reactorId: PLAYER_ID,
        choice: 'decline',
        source: 'player',
        basedOnRevision: 0,
      }),
    ).toBe(true);
  });

  it('opens a window on the bridge when a move leaves a threat range', () => {
    dispatch(fixture, { type: 'COMBAT_MOVE', cellX: 1, cellY: 2 });

    expect(fixture.opened).toHaveLength(1);
    const event = fixture.opened[0];
    expect(event?.moverId).toBe(PLAYER_ID);
    expect(event?.currentReactorId).toBe(ENEMY_ID);
    expect(event?.reactorQueue).toEqual([ENEMY_ID]);
    expect(event?.reactionId).toBe('reaction.opportunity_attack');
    expect(event?.abilityId).toBe(OPPORTUNITY_ATTACK_ABILITY_ID);
    // The trigger cell is the cell the mover was ATTEMPTING to enter.
    expect(event?.triggerCell).toEqual({ x: 1, y: 2 });
    // The enemy is not player-controlled, so it has no decision surface: the
    // engine pins a deterministic policy instead of blocking on a model.
    expect(event?.reactionPolicy).toBe('auto');
    expect(liveState(fixture)?.phase).toBe('reaction');
  });

  it('emits nothing when the encounter authors no reaction', () => {
    const withoutReactions = buildFixture({ withReactions: false });
    dispatch(withoutReactions, { type: 'COMBAT_MOVE', cellX: 1, cellY: 2 });

    expect(withoutReactions.opened).toHaveLength(0);
    expect(liveState(withoutReactions)?.phase).toBe('active');
  });

  it('resumes the suspended move once the window is declined', () => {
    dispatch(fixture, { type: 'COMBAT_MOVE', cellX: 1, cellY: 2 });
    const opened = fixture.opened[0];
    expect(opened).toBeDefined();
    if (opened === undefined) {
      return;
    }

    dispatch(fixture, {
      type: 'COMBAT_REACTION_SELECTED',
      encounterId: ENCOUNTER_ID,
      encounterRunId: opened.encounterRunId,
      windowId: opened.windowId,
      windowVersion: opened.windowVersion,
      reactorId: ENEMY_ID,
      choice: 'decline',
      source: 'ai_policy',
      basedOnRevision: liveState(fixture)?.stateRevision ?? -1,
    });

    const state = liveState(fixture);
    // The suspension released: the encounter is playable again and the mover
    // completed the command it declared.
    expect(state?.phase).toBe('active');
    expect(state?.reaction.windows).toEqual([]);
    expect(GridPosition.x[fixture.playerEid]).toBe(1);
    expect(GridPosition.y[fixture.playerEid]).toBe(2);
    expect(fixture.rejected).toEqual([]);
  });

  it('rejects a stale or duplicate choice without spending anything', () => {
    dispatch(fixture, { type: 'COMBAT_MOVE', cellX: 1, cellY: 2 });
    const opened = fixture.opened[0];
    expect(opened).toBeDefined();
    if (opened === undefined) {
      return;
    }

    const selection = {
      type: 'COMBAT_REACTION_SELECTED' as const,
      encounterId: ENCOUNTER_ID,
      encounterRunId: opened.encounterRunId,
      windowId: opened.windowId,
      windowVersion: opened.windowVersion,
      reactorId: ENEMY_ID,
      choice: 'decline' as const,
      source: 'ai_policy' as const,
      basedOnRevision: liveState(fixture)?.stateRevision ?? -1,
    };
    dispatch(fixture, selection);
    // The window is gone, so the replay is a typed rejection — not a second
    // resolution that would advance RNG or the revision.
    const revision = liveState(fixture)?.stateRevision;
    dispatch(fixture, selection);

    expect(fixture.rejected.map((entry) => entry.reasonCode)).toEqual(['staleRevision']);
    expect(liveState(fixture)?.stateRevision).toBe(revision);
  });

  it('accepts the opportunity attack and consumes the reaction', () => {
    dispatch(fixture, { type: 'COMBAT_MOVE', cellX: 1, cellY: 2 });
    const opened = fixture.opened[0];
    expect(opened).toBeDefined();
    if (opened === undefined) {
      return;
    }

    dispatch(fixture, {
      type: 'COMBAT_REACTION_SELECTED',
      encounterId: ENCOUNTER_ID,
      encounterRunId: opened.encounterRunId,
      windowId: opened.windowId,
      windowVersion: opened.windowVersion,
      reactorId: ENEMY_ID,
      choice: 'accept',
      source: 'ai_policy',
      basedOnRevision: liveState(fixture)?.stateRevision ?? -1,
    });

    const state = liveState(fixture);
    expect(state?.phase).toBe('active');
    // Consumed whether the attack hit or missed.
    expect(state?.combatants[ENEMY_ID]?.budget.reactionAvailable).toBe(false);
  });
});
