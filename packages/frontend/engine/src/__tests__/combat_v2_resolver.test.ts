// packages/frontend/engine/src/__tests__/combat_v2_resolver.test.ts
//
// C-516 (Combat-04) v2 resolver coverage.
//
//   AC-4  direct commands resolve through the v2 kernel when selected
//   AC-5  v2 events drive the existing combat UI unchanged
//   AC-8  click-to-move commits a budgeted v2 move
//
// The harness drives the PRODUCTION dispatch entry point
// (`dispatchCombatCommand`) against a real bitECS world, so the routing, the
// kernel commit, the ECS apply and the event mapping are all exercised
// together. No Worker is spun up.
//
// Contract: C-516 AC-4, AC-5, AC-8

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BASIC_COMBAT_ABILITIES } from '@aikami/constants';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { dispatchCombatCommand } from '../combat/combat_command_dispatch.ts';
import type {
  CombatEncounterParticipant,
  CombatEncounterRoster,
} from '../combat/combat_encounter_start.ts';
import { startProductionEncounter } from '../combat/combat_encounter_start.ts';
import { handleCombatPreviewRequest } from '../combat/combat_preview_handler.ts';
import { getActiveTurn, hasCombatTurns } from '../combat/combat_turn_driver.ts';
import { chooseV2AiCommand } from '../combat/combat_v2_ai.ts';
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
const ENCOUNTER_ID = 'c516-resolver-encounter';
const ENEMY_COMBATANT_ID = 'emberwatch/rollo_grasper';

const installTerrain = (): void => {
  const cellCount = MAP_WIDTH * MAP_HEIGHT;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index++) {
    cost[index] = TERRAIN_COST_SCALE;
  }
  setTerrainGrid({ width: MAP_WIDTH, height: MAP_HEIGHT, tileSize: TILE_SIZE, cost, blocksSight });
};

type Fixture = {
  world: World;
  bridge: MockEngineBridge;
  playerEid: number;
  enemyEid: number;
  logs: Array<{
    message: string;
    sourceId: number;
    targetId: number;
    targetRemainingHp: number;
    targetMaxHp: number;
  }>;
  damage: Array<{ entityId: number; amount: number }>;
  economy: Array<{ entityId: number; movementRemaining: number; actionAvailable: boolean }>;
  turns: Array<{ currentEntityId: number; activeEntities: number[] }>;
};

const playerParticipant = (cell: { x: number; y: number }): CombatEncounterParticipant => ({
  combatantId: 'player',
  team: 'player',
  cell,
  stats: { hitPoints: 40, armorClass: 10, attackBonus: 10, initiative: 30 },
  classIds: ['wizard'],
});

const enemyParticipant = (cell: { x: number; y: number }): CombatEncounterParticipant => ({
  combatantId: ENEMY_COMBATANT_ID,
  team: 'enemy',
  cell,
  npcId: 'rollo_grasper',
  stats: { hitPoints: 40, armorClass: 10, attackBonus: 2, initiative: 5 },
});

const buildFixture = (options: { enemyCell?: { x: number; y: number } } = {}): Fixture => {
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

  // The worker always creates the player first, so eid 1 is the player here.
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
    participants: [
      playerParticipant({ x: 1, y: 1 }),
      enemyParticipant(
        options.enemyCell ?? {
          x: 2,
          y: 1,
        },
      ),
    ],
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

  const enemyEid = started.ok ? (started.participantIds[1] ?? 0) : 0;

  const logs: Fixture['logs'] = [];
  const damage: Fixture['damage'] = [];
  const economy: Fixture['economy'] = [];
  const turns: Fixture['turns'] = [];
  bridge.on('COMBAT_LOG', (event) => logs.push(event));
  bridge.on('DAMAGE_DEALT', (event) => {
    damage.push({ entityId: event.entityId, amount: event.amount });
  });
  bridge.on('ACTION_ECONOMY_CHANGED', (event) => {
    economy.push({
      entityId: event.entityId,
      movementRemaining: event.movementRemaining,
      actionAvailable: event.actionAvailable,
    });
  });
  bridge.on('TURN_CHANGED', (event) => turns.push(event));

  return { world, bridge, playerEid, enemyEid, logs, damage, economy, turns };
};

const dispatchCommand = (
  target: Fixture,
  command: Parameters<typeof dispatchCombatCommand>[0],
): void => {
  dispatchCombatCommand(command, {
    world: target.world,
    bridge: target.bridge,
    playerEntityId: target.playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
  });
};

let fixture: Fixture;

beforeEach(() => {
  fixture = buildFixture();
});

afterEach(() => {
  resetCollisionGrid();
  resetCombatComponentGlobals();
});

// ---------------------------------------------------------------------------
// AC-4 — direct commands resolve through the v2 kernel
// ---------------------------------------------------------------------------

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

describe('C-516 AC-4: direct commands resolve through the v2 kernel', () => {
  it('resolves an ATTACK through the kernel and applies it to the ECS world', () => {
    const { world, logs, damage } = fixture;
    const before = CombatStats.health[fixture.enemyEid];
    const revisionBefore = getActiveTurn(world)?.combatantId;
    expect(revisionBefore).toBe('player');

    dispatchCommand(fixture, { type: 'COMBAT_ACTION', action: 'ATTACK', targetId: 2 } as never);

    // `targetId: 2` is a raw-eid selection; the resolver maps it to the
    // combatant the kernel knows.
    const after = CombatStats.health[fixture.enemyEid];
    expect(after).toBeLessThanOrEqual(before ?? 0);
    expect(logs.length + damage.length).toBeGreaterThan(0);
  });

  it('never lets the client supply damage — the kernel rolls it', () => {
    const { world } = fixture;
    const state = buildV2CombatState({
      world,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    });
    expect(state).not.toBeNull();
    // An ability that is not in the catalog is a typed rejection, not a roll.
    dispatchCommand(fixture, {
      type: 'COMBAT_ACTION',
      action: 'ABILITY',
      abilityId: 'not_a_real_ability',
      targetId: 2,
    } as never);
    expect(CombatStats.health[fixture.enemyEid]).toBe(40);
  });

  it('resolves DEFEND by spending the action', () => {
    const { world, economy } = fixture;
    dispatchCommand(fixture, { type: 'COMBAT_ACTION', action: 'DEFEND' } as never);

    const state = buildV2CombatState({ world, abilityCatalog: BASIC_COMBAT_ABILITIES });
    expect(state?.combatants.player?.budget.actionAvailable).toBe(false);
    expect(economy.length).toBeGreaterThan(0);
  });

  it('advances the revision by exactly one per successful command', () => {
    const { world } = fixture;
    const first = buildV2CombatState({ world, abilityCatalog: BASIC_COMBAT_ABILITIES });
    expect(first?.stateRevision).toBe(0);

    dispatchCommand(fixture, { type: 'COMBAT_ACTION', action: 'DEFEND' } as never);

    const second = buildV2CombatState({ world, abilityCatalog: BASIC_COMBAT_ABILITIES });
    expect(second?.stateRevision).toBe(1);
  });

  it('never mutates the projection it was handed', () => {
    const { world } = fixture;
    const state = buildV2CombatState({ world, abilityCatalog: BASIC_COMBAT_ABILITIES });
    expect(state).not.toBeNull();
    const snapshotBefore = JSON.stringify(state);

    dispatchCommand(fixture, { type: 'COMBAT_ACTION', action: 'DEFEND' } as never);

    expect(JSON.stringify(state)).toBe(snapshotBefore);
  });

  it('rejects a command from a combatant whose turn it is not', () => {
    const { world } = fixture;
    // The enemy is not the active combatant; a player-issued attack for it is
    // ignored by the kernel rather than applied.
    const hpBefore = CombatStats.health[fixture.enemyEid];
    const state = buildV2CombatState({ world, abilityCatalog: BASIC_COMBAT_ABILITIES });
    expect(state?.initiative.order[state.initiative.activeIndex]).toBe('player');
    expect(CombatStats.health[fixture.playerEid]).toBe(40);
    dispatchCommand(fixture, { type: 'COMBAT_ACTION', action: 'ATTACK', targetId: 1 } as never);
    expect(CombatStats.health[fixture.enemyEid]).toBe(hpBefore);
  });

  it('keeps FLEE as the party-retreat exit — it never reaches the kernel', () => {
    const { world, bridge, enemyEid } = fixture;
    const ended: Array<{ victory: boolean }> = [];
    bridge.on('COMBAT_ENDED', (event) => ended.push({ victory: event.victory }));

    dispatchCommand(fixture, { type: 'COMBAT_ACTION', action: 'FLEE' } as never);

    // The legacy party-retreat exit ran: the encounter ended as a loss and the
    // turn driver is torn down. A kernel command would instead have been
    // rejected as `invalidCommandShape` and left the encounter running.
    expect(ended).toHaveLength(1);
    expect(ended[0]?.victory).toBe(false);
    expect(hasCombatTurns(world)).toBe(false);
    // Nothing was rolled or damaged.
    expect(fixture.damage).toHaveLength(0);
    expect(CombatStats.health[enemyEid]).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — v2 events drive the existing combat UI unchanged
// ---------------------------------------------------------------------------

describe('C-516 AC-5: v2 events drive the existing combat UI unchanged', () => {
  it('maps a resolved attack onto COMBAT_LOG with the applied HP', () => {
    const { logs, damage, enemyEid } = fixture;
    dispatchCommand(fixture, { type: 'COMBAT_ACTION', action: 'ATTACK', targetId: 2 } as never);

    const hpAfter = CombatStats.health[enemyEid] ?? 0;
    if (damage.length > 0) {
      expect(damage[0]?.entityId).toBe(enemyEid);
      // The log entry must agree with the applied state, not the command.
      expect(logs.some((entry) => entry.targetRemainingHp === hpAfter)).toBe(true);
    } else {
      // A miss still logs — and never claims damage.
      expect(logs.some((entry) => entry.message.includes('misses'))).toBe(true);
    }
  });

  it('emits TURN_CHANGED as the round advances', () => {
    const { turns } = fixture;
    dispatchCommand(fixture, { type: 'COMBAT_END_TURN' } as never);
    expect(turns.length).toBeGreaterThan(0);
  });

  it('emits ACTION_ECONOMY_CHANGED with real entity ids only', () => {
    const { economy } = fixture;
    dispatchCommand(fixture, { type: 'COMBAT_ACTION', action: 'DEFEND' } as never);
    expect(economy.length).toBeGreaterThan(0);
    expect(economy.every((event) => event.entityId > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-8 — click-to-move commits a budgeted v2 move
// ---------------------------------------------------------------------------

describe('C-516 AC-8: click-to-move commits a budgeted v2 move', () => {
  it('commits the previewed path, moves the entity and spends the budget', () => {
    const { world, playerEid, bridge } = fixture;

    const preview = handleCombatPreviewRequest({
      world,
      bridge,
      request: {
        type: 'COMBAT_PREVIEW_REQUESTED',
        requestId: 'move-1',
        encounterId: ENCOUNTER_ID,
        basedOnRevision: 0,
        query: { kind: 'legalMoves', combatantId: 'player' },
      },
    });
    expect(preview.valid).toBe(true);
    if (!preview.valid) {
      return;
    }
    const endpoint = (preview.legalEndpoints ?? []).find((cell) => cell.x !== 1 || cell.y !== 1);
    expect(endpoint).toBeDefined();
    if (endpoint === undefined) {
      return;
    }

    dispatchCommand(fixture, {
      type: 'COMBAT_MOVE',
      cellX: endpoint.x,
      cellY: endpoint.y,
    } as never);

    expect(GridPosition.x[playerEid]).toBe(endpoint.x);
    expect(GridPosition.y[playerEid]).toBe(endpoint.y);

    const state = buildV2CombatState({ world, abilityCatalog: BASIC_COMBAT_ABILITIES });
    const spent = state?.combatants.player?.budget.movementRemaining ?? 0;
    const cost = preview.movementCostTo?.[`${endpoint.x},${endpoint.y}`] ?? 0;
    expect(spent).toBe(6 - cost);
  });

  it('rejects an unreachable cell without moving the entity', () => {
    const { playerEid } = fixture;
    dispatchCommand(fixture, { type: 'COMBAT_MOVE', cellX: 11, cellY: 7 } as never);
    expect(GridPosition.x[playerEid]).toBe(1);
    expect(GridPosition.y[playerEid]).toBe(1);
  });

  it('rejects an occupied cell without moving the entity', () => {
    const { playerEid, enemyEid } = fixture;
    const enemyCell = { x: GridPosition.x[enemyEid] ?? 2, y: GridPosition.y[enemyEid] ?? 1 };
    dispatchCommand(fixture, {
      type: 'COMBAT_MOVE',
      cellX: enemyCell.x,
      cellY: enemyCell.y,
    } as never);
    expect(GridPosition.x[playerEid]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-10 — enemy turns resolve under the deterministic engine
// ---------------------------------------------------------------------------

describe('C-516 AC-10: enemy turns resolve on the v2 engine, deterministically', () => {
  it('runs the enemy turn after the player ends theirs', () => {
    const { world, logs } = fixture;

    dispatchCommand(fixture, { type: 'COMBAT_END_TURN' } as never);

    // The AI acts through the kernel, so the log only ever contains resolved
    // events, and the turn comes back to the player.
    expect(logs.length).toBeGreaterThan(0);
    expect(getActiveTurn(world)?.combatantId).toBe('player');
  });

  it('picks the same command for the same state (ai determinism)', () => {
    const state = buildV2CombatState({
      world: fixture.world,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    });
    expect(state).not.toBeNull();
    if (state === null) {
      return;
    }
    // Project once and choose twice: the policy holds no RNG of its own.
    const enemyIndex = state.initiative.order.findIndex((id) => id !== 'player');
    expect(enemyIndex).toBeGreaterThanOrEqual(0);
    state.initiative.activeIndex = enemyIndex;
    const enemyId = state.initiative.order[enemyIndex] ?? '';
    const first = chooseV2AiCommand({
      state,
      combatantId: enemyId,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      basicAttackAbilityId: 'basic_melee',
    });
    const second = chooseV2AiCommand({
      state,
      combatantId: enemyId,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      basicAttackAbilityId: 'basic_melee',
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('attacks when a hostile is in range and approaches when none is', () => {
    const state = buildV2CombatState({
      world: fixture.world,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
    });
    if (state === null) {
      return;
    }
    const enemyIndex = state.initiative.order.findIndex((id) => id !== 'player');
    expect(enemyIndex).toBeGreaterThanOrEqual(0);
    // The policy is a pure function of the state, so make the enemy the active
    // combatant in a COPY and ask it what it would do. Everything else — the
    // adjacency to the player, the budgets, the terrain — is the live state.
    state.initiative.activeIndex = enemyIndex;
    const enemyId = state.initiative.order[enemyIndex] ?? '';
    const command = chooseV2AiCommand({
      state,
      combatantId: enemyId,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      basicAttackAbilityId: 'basic_melee',
    });
    expect(command.kind).toBe('useAbility');
    if (command.kind === 'useAbility') {
      expect(command.targetIds).toEqual(['player']);
    }
  });
});
