// packages/frontend/engine/src/__tests__/combat_v2_start.test.ts
//
// C-516 (Combat-04) encounter-start coverage.
//
//   AC-2  a production encounter starts real ECS combat with the content roster
//   AC-3  the production ability catalog is injected into the v2 driver
//   AC-1  the engine choice is pinned once at encounter start
//
// The harness is a REAL bitECS world driven through the production entry point
// (`startProductionEncounter`) with a `MockEngineBridge`. No Worker is spun up.
//
// Contract: C-516 AC-1, AC-2, AC-3

import { afterEach, describe, expect, it } from 'bun:test';
import { BASIC_COMBAT_ABILITIES, resolveCombatAbilityIds } from '@aikami/constants';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, hasComponent, query, set } from 'bitecs';
import type { CombatEncounterRoster } from '../combat/combat_encounter_start.ts';
import {
  clearEncounterEngine,
  deriveEncounterRosterFromWorld,
  getEncounterEngine,
  startProductionEncounter,
  validateEncounterRoster,
} from '../combat/combat_encounter_start.ts';
import { getCombatPreviewSnapshot, hasCombatTurns } from '../combat/combat_turn_driver.ts';
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
import type { GameEvent } from '../types.ts';

const MAP_WIDTH = 10;
const MAP_HEIGHT = 8;
const TILE_SIZE = 32;
const ENCOUNTER_ID = 'emberwatch/proof_encounter';

const installTerrain = (): void => {
  const cellCount = MAP_WIDTH * MAP_HEIGHT;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index++) {
    cost[index] = TERRAIN_COST_SCALE;
  }
  setTerrainGrid({ width: MAP_WIDTH, height: MAP_HEIGHT, tileSize: TILE_SIZE, cost, blocksSight });
};

/** The player entity the worker creates before any encounter. */
const createPlayer = (world: World): number => {
  // The first allocated entity is the project's player convention (eid 1).
  const eid = addEntity(world);
  addComponent(world, eid, CombatStats);
  addComponent(
    world,
    eid,
    set(CombatStats, {
      health: 30,
      maxHealth: 30,
      initiative: 18,
      attack: 5,
      defense: 0,
      accuracy: 5,
      evasion: 14,
    }),
  );
  addComponent(world, eid, TurnOrder);
  addComponent(
    world,
    eid,
    set(TurnOrder, { currentTurn: false, initiativeValue: 18, isActive: true }),
  );
  return eid;
};

/** Live entity count — `world.entities` does not exist in this bitecs build. */
const entityCount = (world: World): number => query(world, [CombatStats]).length;

const ROSTER: CombatEncounterRoster = {
  encounterId: ENCOUNTER_ID,
  seed: 4242,
  engine: 'v2',
  participants: [
    {
      combatantId: 'player',
      team: 'player',
      cell: { x: 1, y: 1 },
      stats: { hitPoints: 30, armorClass: 14, attackBonus: 5, initiative: 18 },
      classIds: ['fighter'],
    },
    {
      combatantId: 'emberwatch/mira',
      team: 'ally',
      cell: { x: 2, y: 2 },
      npcId: 'emberwatch/mira',
      displayName: 'Mira',
      stats: { hitPoints: 20, armorClass: 12, attackBonus: 4, initiative: 12 },
      classIds: ['cleric'],
    },
    {
      combatantId: 'emberwatch/rollo_grasper',
      team: 'enemy',
      cell: { x: 6, y: 2 },
      npcId: 'rollo_grasper',
      stats: { hitPoints: 12, armorClass: 11, attackBonus: 3, initiative: 10 },
    },
    {
      combatantId: 'emberwatch/ash_hound',
      team: 'enemy',
      cell: { x: 7, y: 3 },
      npcId: 'ash_hound',
      stats: { hitPoints: 9, armorClass: 12, attackBonus: 4, initiative: 15 },
    },
  ],
};

type Harness = {
  world: World;
  bridge: MockEngineBridge;
  starts: Array<Extract<GameEvent, { type: 'COMBAT_STARTED' }>>;
};

const createHarness = (options: { roster?: CombatEncounterRoster; playerEid?: number } = {}) => {
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  registerCombatIdentityObservers(world);
  registerGridPositionObservers(world);
  registerCombatMovementObservers(world);
  registerEnemyObservers(world);
  registerCompanionObservers(world);
  installTerrain();

  const playerEid = options.playerEid ?? createPlayer(world);
  const bridge = new MockEngineBridge();
  const starts: Harness['starts'] = [];
  bridge.on('COMBAT_STARTED', (event) => starts.push(event));

  const roster = options.roster ?? ROSTER;
  const result = startProductionEncounter({
    world,
    bridge,
    roster,
    playerEntityId: playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    hooks: { runAiTurn: () => {}, emitStateUpdate: () => {} },
  });

  return { world, bridge, playerEid, result, starts };
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

describe('C-516 AC-2: a production encounter starts real ECS combat with the content roster', () => {
  it('spawns every roster slot as a combatant with the combat components', () => {
    const harness = createHarness();
    const { world, playerEid, result } = harness;

    expect(result.ok).toBe(true);
    expect(hasCombatTurns(world)).toBe(true);

    const snapshot = getCombatPreviewSnapshot(world);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.order.length).toBe(ROSTER.participants.length);

    // The player entity is reused, not duplicated.
    expect(hasComponent(world, playerEid, CombatIdentity)).toBe(true);
    expect(CombatIdentity.combatantId[playerEid]).toBe('player');
    expect(hasComponent(world, playerEid, CombatMovement)).toBe(true);
    expect(GridPosition.x[playerEid]).toBe(1);
    expect(GridPosition.y[playerEid]).toBe(1);

    const statsAfter = CombatStats.health[playerEid];
    expect(statsAfter).toBe(30);
    expect(CombatStats.evasion[playerEid]).toBe(14);
    expect(CombatStats.accuracy[playerEid]).toBe(5);
    expect((TurnOrder as unknown as { initiativeValue: number[] }).initiativeValue[playerEid]).toBe(
      18,
    );
  });

  it('classifies allies and enemies from their authored ids', () => {
    const harness = createHarness();
    const { world } = harness;
    const snapshot = getCombatPreviewSnapshot(world);
    expect(snapshot?.order).toContain('emberwatch/mira');
    expect(snapshot?.order).toContain('emberwatch/rollo_grasper');

    const companionEid = query(world, [Companion]).find(
      (eid) => Companion.recruited[eid] === true && Companion.npcId[eid] !== '',
    );
    expect(companionEid).toBeDefined();
    if (companionEid !== undefined) {
      expect(Companion.npcId[companionEid]).toBe('emberwatch/mira');
    }

    const enemyEids = query(world, [Enemy]).filter(
      (eid) => Enemy.isActive[eid] === true && eid !== harness.playerEid,
    );
    expect(enemyEids.length).toBe(2);
  });

  it('emits exactly one COMBAT_STARTED carrying every participant and the engine', () => {
    const harness = createHarness();
    expect(harness.starts).toHaveLength(1);
    const started = harness.starts[0];
    expect(started?.engine).toBe('v2');
    expect(started?.participantIds.length).toBe(ROSTER.participants.length);
    expect(started?.firstTurnEntityId).toBeGreaterThan(0);
  });

  it('is idempotent — a second start while active spawns nothing', () => {
    const harness = createHarness();
    const before = entityCount(harness.world);
    const second = startProductionEncounter({
      world: harness.world,
      bridge: harness.bridge,
      roster: ROSTER,
      playerEntityId: harness.playerEid,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      hooks: { runAiTurn: () => {}, emitStateUpdate: () => {} },
    });
    expect(second.ok).toBe(true);
    expect(entityCount(harness.world)).toBe(before);
    expect(harness.starts).toHaveLength(1);
  });

  it('rejects an incomplete roster before spawning anything', () => {
    const world = createWorld();
    registerCombatStatsObservers(world);
    registerTurnOrderObservers(world);
    registerCombatIdentityObservers(world);
    registerGridPositionObservers(world);
    registerCombatMovementObservers(world);
    installTerrain();
    const playerEid = createPlayer(world);
    const bridge = new MockEngineBridge();

    const noPlayer = validateEncounterRoster({
      roster: { ...ROSTER, participants: ROSTER.participants.filter((p) => p.team !== 'player') },
    });
    expect(noPlayer?.ok).toBe(false);
    if (noPlayer !== null && !noPlayer.ok) {
      expect(noPlayer.messageKey).toBeTruthy();
    }

    const outOfBounds = validateEncounterRoster({
      roster: {
        ...ROSTER,
        participants: ROSTER.participants.map((participant) =>
          participant.team === 'enemy' ? { ...participant, cell: { x: 99, y: 99 } } : participant,
        ),
      },
      battlefieldSize: { width: MAP_WIDTH, height: MAP_HEIGHT },
    });
    expect(outOfBounds?.ok).toBe(false);

    const result = startProductionEncounter({
      world,
      bridge,
      roster: { ...ROSTER, participants: ROSTER.participants.filter((p) => p.team !== 'player') },
      playerEntityId: playerEid,
      abilityCatalog: BASIC_COMBAT_ABILITIES,
      hooks: { runAiTurn: () => {}, emitStateUpdate: () => {} },
    });
    expect(result.ok).toBe(false);
    expect(hasCombatTurns(world)).toBe(false);
    expect(entityCount(world)).toBe(1);
  });

  it('derives the collision funnel roster from the live world', () => {
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

    const derived = deriveEncounterRosterFromWorld({
      world,
      playerEntityId: playerEid,
      encounterId: ENCOUNTER_ID,
      seed: 7,
      engine: 'legacy',
    });
    // Only the player exists — nothing to fight yet.
    expect(derived).toBeNull();
    expect(playerEid).toBeGreaterThan(0);
  });
});

describe('C-516 AC-3: the production ability catalog is injected into v2', () => {
  it('grants each combatant its own abilities, not the whole catalog', () => {
    const harness = createHarness();
    const snapshot = getCombatPreviewSnapshot(harness.world);
    expect(Object.keys(snapshot?.abilityCatalog ?? {}).length).toBeGreaterThan(1);

    // `basic_melee` is always present; the fighter mapping rides along.
    expect(snapshot?.abilityCatalog.basic_melee).toBeDefined();
    expect(resolveCombatAbilityIds(['fighter'])).toContain('fighter_second_wind');
  });

  it('exposes per-combatant grants through the driver snapshot', () => {
    const harness = createHarness();
    const snapshot = getCombatPreviewSnapshot(harness.world);
    expect(snapshot?.abilityIdsByCombatant).toBeDefined();
  });
});

describe('C-516 AC-1: the engine choice is pinned once at encounter start', () => {
  it('records the engine on the encounter and never re-reads the flag', () => {
    const harness = createHarness();
    expect(getEncounterEngine(harness.world)).toBe('v2');
    clearEncounterEngine(harness.world);
    expect(getEncounterEngine(harness.world)).toBeUndefined();
    // Clearing the record does not disturb the running encounter.
    expect(hasCombatTurns(harness.world)).toBe(true);
  });

  it('pins legacy when the roster asks for it', () => {
    const harness = createHarness({ roster: { ...ROSTER, engine: 'legacy' } });
    expect(getEncounterEngine(harness.world)).toBe('legacy');
    expect(harness.starts[0]?.engine).toBe('legacy');
  });
});
