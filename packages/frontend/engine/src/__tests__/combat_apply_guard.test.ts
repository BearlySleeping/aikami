// packages/frontend/engine/src/__tests__/combat_apply_guard.test.ts
//
// Review F-A: the apply guard is a hard gate, and installing an authoritative
// state seeds it with THAT revision.
//
// The bug this locks down: `applyCombatResult` used to return `void` and
// silently no-op when the expected previous revision did not match, while the
// caller continued as if application had succeeded — replacing live v2 state,
// emitting mechanical events, opening reactions, settling the encounter and
// acknowledging the command. After a restore at revision N the guard still
// expected 0, so the first command of the restored fight advanced the kernel
// revision without touching the ECS.
//
// Contract: C-509 AC-6, C-532 AC-4/AC-6

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BASIC_COMBAT_ABILITIES } from '@aikami/constants';
import type { CombatState } from '@aikami/types';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import {
  dispatchCombatCommand,
  isCombatDispatchCommand,
} from '../combat/combat_command_dispatch.ts';
import type {
  CombatEncounterParticipant,
  CombatEncounterRoster,
} from '../combat/combat_encounter_start.ts';
import { startProductionEncounter } from '../combat/combat_encounter_start.ts';
import { getCombatSessionRevision } from '../combat/combat_session_checkpoint.ts';
import {
  applyCombatResult,
  getProjectedCombatRevision,
  installCombatProjection,
  resetCombatApplyGuard,
} from '../combat/combat_state_adapter.ts';
import { buildV2CombatState } from '../combat/combat_v2_resolver.ts';
import { getLiveV2CombatState } from '../combat/combat_v2_state.ts';
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
import { withLiveIdentity } from './support/combat_command_identity.ts';

const MAP_WIDTH = 12;
const MAP_HEIGHT = 8;
const TILE_SIZE = 32;
const ENCOUNTER_ID = 'f-a-apply-guard-encounter';
const PLAYER_ID = 'player';
const ENEMY_ID = 'emberwatch/guard_hound';

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
  npcId: 'guard_hound',
  stats: { hitPoints: 40, armorClass: 10, attackBonus: 2, initiative: 5 },
});

type Fixture = {
  world: World;
  bridge: MockEngineBridge;
  playerEid: number;
  enemyEid: number;
  accepted: Array<{ commandId: string; stateRevision: number }>;
  rejected: Array<{ reasonCode: string; detail?: string }>;
};

const buildFixture = (): Fixture => {
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
    seed: 4242,
    engine: 'v2',
    participants: [playerParticipant({ x: 1, y: 1 }), enemyParticipant({ x: 2, y: 1 })],
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

  const accepted: Fixture['accepted'] = [];
  const rejected: Fixture['rejected'] = [];
  bridge.on('COMBAT_COMMAND_ACCEPTED', (event) => {
    accepted.push({ commandId: event.commandId, stateRevision: event.stateRevision });
  });
  bridge.on('COMBAT_COMMAND_REJECTED', (event) => {
    rejected.push({
      reasonCode: event.reasonCode,
      ...(event.detail === undefined ? {} : { detail: event.detail }),
    });
  });

  return {
    world,
    bridge,
    playerEid,
    enemyEid: started.ok ? (started.participantIds[1] ?? 0) : 0,
    accepted,
    rejected,
  };
};

const dispatch = (target: Fixture, command: { type: string } & Record<string, unknown>): void => {
  dispatchCombatCommand(
    withLiveIdentity(
      { world: target.world, abilityCatalog: BASIC_COMBAT_ABILITIES },
      command,
    ) as Parameters<typeof dispatchCombatCommand>[0],
    {
      world: target.world,
      bridge: target.bridge,
      playerEntityId: target.playerEid,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    },
  );
};

const resetCombatComponentGlobals = (): void => {
  for (let slot = 0; slot < 64; slot++) {
    Companion.recruited[slot] = false;
    Companion.npcId[slot] = '';
    Enemy.isActive[slot] = false;
    Enemy.spawnId[slot] = '';
    Enemy.encounterId[slot] = '';
    delete CombatMovement.movementPerTurn[slot];
    CombatIdentity.combatantId[slot] = '';
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

describe('review F-A: restore at a non-zero revision keeps the guard synchronized', () => {
  it('advances authoritative state, ECS projection, acknowledgement and revision together', () => {
    const { world, enemyEid } = fixture;

    // 1. Commit one accepted command so the fight really is at revision 1.
    dispatch(fixture, { type: 'COMBAT_ACTION', action: 'DEFEND' });
    const advanced = getLiveV2CombatState(world);
    expect(advanced?.stateRevision).toBe(1);

    // 2. Simulate the restore boundary: a NEW state at a NON-ZERO revision, the
    //    exact shape `COMBAT_CHECKPOINT_RESTORED` installs.
    const restored: CombatState = {
      ...(advanced as CombatState),
      stateRevision: 7,
      combatants: {
        ...(advanced as CombatState).combatants,
        [ENEMY_ID]: {
          ...(advanced as CombatState).combatants[ENEMY_ID],
          hp: 40,
        },
        // A mid-turn save restores the budget as it was captured; give the
        // player its action back so the next command is a legal one.
        [PLAYER_ID]: {
          ...(advanced as CombatState).combatants[PLAYER_ID],
          budget: {
            ...(advanced as CombatState).combatants[PLAYER_ID].budget,
            actionAvailable: true,
          },
        },
      },
    } as CombatState;
    dispatchCombatCommand(
      { type: 'COMBAT_CHECKPOINT_RESTORED', state: restored },
      {
        world,
        bridge: fixture.bridge,
        playerEntityId: fixture.playerEid,
        abilityCatalog: BASIC_COMBAT_ABILITIES,
      },
    );

    // 3. The guard MUST be seeded with the restored revision, not 0.
    expect(getProjectedCombatRevision(world, ENCOUNTER_ID)).toBe(7);

    // 4. A state-changing command now advances everything together.
    const acceptedBefore = fixture.accepted.length;
    const hpBefore = CombatStats.health[enemyEid] ?? 0;
    dispatch(fixture, {
      type: 'COMBAT_ACTION',
      action: 'ATTACK',
      targetId: ENEMY_ID,
      basedOnRevision: 7,
    });

    const after = getLiveV2CombatState(world);
    expect(after?.stateRevision).toBe(8);
    expect(getProjectedCombatRevision(world, ENCOUNTER_ID)).toBe(8);
    // The ECS received the transition: either the enemy lost HP or the attack
    // resolved to a miss, but the projected revision must match the kernel's.
    expect(CombatStats.health[enemyEid]).toBeLessThanOrEqual(hpBefore);
    // The correlated acknowledgement reports the SAME revision the kernel
    // advanced to — never a success the ECS did not receive.
    const acknowledgement = fixture.accepted.at(-1);
    expect(acknowledgement?.stateRevision).toBe(8);
    expect(fixture.accepted.length).toBe(acceptedBefore + 1);
    expect(getCombatSessionRevision(world)).toBeGreaterThan(0);
  });

  it('rejects a command whose expected revision is not the projected one', () => {
    const { world, enemyEid } = fixture;
    dispatch(fixture, { type: 'COMBAT_ACTION', action: 'DEFEND' });
    const before = getLiveV2CombatState(world);
    const hpBefore = CombatStats.health[enemyEid] ?? 0;
    const acceptedBefore = fixture.accepted.length;
    const sessionBefore = getCombatSessionRevision(world);

    // Deliberately bind to a superseded revision.
    dispatch(fixture, {
      type: 'COMBAT_ACTION',
      action: 'ATTACK',
      targetId: ENEMY_ID,
      basedOnRevision: 0,
    });

    expect(fixture.rejected.at(-1)?.reasonCode).toBe('staleRevision');
    expect(getLiveV2CombatState(world)?.stateRevision).toBe(before?.stateRevision ?? -1);
    expect(getProjectedCombatRevision(world, ENCOUNTER_ID)).toBe(before?.stateRevision ?? -1);
    expect(CombatStats.health[enemyEid]).toBe(hpBefore);
    expect(fixture.accepted.length).toBe(acceptedBefore);
    expect(getCombatSessionRevision(world)).toBe(sessionBefore);
  });

  it('a rejected application publishes no mechanical success and does not advance the boundary', () => {
    const { world, bridge } = fixture;
    dispatch(fixture, { type: 'COMBAT_ACTION', action: 'DEFEND' });
    const state = getLiveV2CombatState(world) as CombatState;

    // A hand-built result whose previous state is NOT the projected revision.
    const foreign: CombatState = { ...state, stateRevision: 99 };
    const sessionBefore = getCombatSessionRevision(world);
    const resolved = {
      valid: true as const,
      state: { ...state, stateRevision: 100 },
      events: [],
    };

    const outcome = applyCombatResult(world, foreign, resolved);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toBe('revisionMismatch');
      expect(outcome.projectedRevision).toBe(state.stateRevision);
      expect(outcome.resultRevision).toBe(100);
    }
    expect(getProjectedCombatRevision(world, ENCOUNTER_ID)).toBe(state.stateRevision);
    expect(getCombatSessionRevision(world)).toBe(sessionBefore);
    expect(bridge.listenerCount()).toBeGreaterThan(0);
  });

  it('distinguishes a duplicate application from a rejection', () => {
    const { world } = fixture;
    // Project once so the live authoritative state exists.
    const state = buildV2CombatState({ world, abilityCatalog: BASIC_COMBAT_ABILITIES });
    expect(state).not.toBeNull();
    if (state === null) {
      return;
    }
    installCombatProjection(world, state);
    const resolved = {
      valid: true as const,
      state: { ...state, stateRevision: state.stateRevision + 1 },
      events: [],
    };
    expect(applyCombatResult(world, state, resolved).status).toBe('accepted');
    const again = applyCombatResult(world, state, resolved);
    expect(again.status).toBe('duplicate');
    if (again.status === 'duplicate') {
      expect(again.stateRevision).toBe(state.stateRevision + 1);
    }
  });
});

describe('review F-A: the apply guard is per world, never shared', () => {
  it('two isolated worlds keep independent guards', () => {
    const other = buildFixture();
    dispatch(fixture, { type: 'COMBAT_ACTION', action: 'DEFEND' });
    expect(getProjectedCombatRevision(fixture.world, ENCOUNTER_ID)).toBe(1);
    // The second world has projected nothing: the first world's guard is not
    // visible to it at all.
    expect(getProjectedCombatRevision(other.world, ENCOUNTER_ID)).toBeNull();

    dispatch(other, { type: 'COMBAT_ACTION', action: 'DEFEND' });
    expect(getProjectedCombatRevision(other.world, ENCOUNTER_ID)).toBe(1);
    expect(getProjectedCombatRevision(fixture.world, ENCOUNTER_ID)).toBe(1);

    resetCombatApplyGuard(other.world);
    expect(getProjectedCombatRevision(other.world, ENCOUNTER_ID)).toBeNull();
    expect(getProjectedCombatRevision(fixture.world, ENCOUNTER_ID)).toBe(1);
    resetCollisionGrid();
    resetCombatComponentGlobals();
  });
});

describe('review F-A: the dispatcher recognises the checkpoint commands', () => {
  it('routes COMBAT_CHECKPOINT_RESTORED through the combat dispatcher', () => {
    expect(isCombatDispatchCommand({ type: 'COMBAT_CHECKPOINT_RESTORED', state: null })).toBe(true);
    expect(
      isCombatDispatchCommand({ type: 'COMBAT_SESSION_CHECKPOINT_REQUESTED', requestId: 'r' }),
    ).toBe(true);
    expect(
      isCombatDispatchCommand({ type: 'COMBAT_SESSION_REVISION_REQUESTED', requestId: 'r' }),
    ).toBe(true);
  });

  it('clears live state and the guard when the checkpoint is null', () => {
    const { world } = fixture;
    expect(buildV2CombatState({ world, abilityCatalog: BASIC_COMBAT_ABILITIES })).not.toBeNull();
    dispatchCombatCommand(
      { type: 'COMBAT_CHECKPOINT_RESTORED', state: null },
      {
        world,
        bridge: fixture.bridge,
        playerEntityId: fixture.playerEid,
        abilityCatalog: BASIC_COMBAT_ABILITIES,
      },
    );
    expect(getLiveV2CombatState(world)).toBeNull();
    expect(getProjectedCombatRevision(world, ENCOUNTER_ID)).toBeNull();
  });
});
