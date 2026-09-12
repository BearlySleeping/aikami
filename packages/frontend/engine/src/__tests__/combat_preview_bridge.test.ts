// packages/frontend/engine/src/__tests__/combat_preview_bridge.test.ts
//
// C-515 (Combat-03) preview-bridge coverage.
//
//   AC-5  the preview round trip is correlated and stale-safe
//   AC-7  the production engine path answers previews on the active turn
//
// The harness is a REAL bitECS world driven through the production entry points
// (`startCombatTurns` → `dispatchCombatCommand` → `handleCombatPreviewRequest`)
// with a `MockEngineBridge`. No real Worker is spun up.
//
// Contract: C-515 AC-5, AC-7

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { CombatPreviewResultSchema } from '@aikami/schemas';
import type { CombatPreviewResult, CombatState } from '@aikami/types';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, set } from 'bitecs';
import { Value } from 'typebox/value';
import { snapshotBattlefield } from '../combat/combat_battlefield.ts';
import {
  registerCombatBridgeCommands,
  toCombatPreviewEnvelope,
} from '../combat/combat_bridge_commands.ts';
import { dispatchCombatCommand } from '../combat/combat_command_dispatch.ts';
import { handleCombatPreviewRequest } from '../combat/combat_preview_handler.ts';
import { snapshotCombatState } from '../combat/combat_state_adapter.ts';
import {
  getActiveTurn,
  getCombatPreviewSnapshot,
  startCombatTurns,
} from '../combat/combat_turn_driver.ts';
import { CombatIdentity, registerCombatIdentityObservers } from '../components/combat_identity.ts';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { GridPosition, registerGridPositionObservers } from '../components/grid_position.ts';
import type { TurnOrderData } from '../components/turn_order.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { resetCollisionGrid, setTerrainGrid } from '../systems/collision_system.ts';
import { TERRAIN_COST_SCALE } from '../systems/terrain_grid.ts';
import type { GameEvent } from '../types.ts';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const MAP_WIDTH = 8;
const MAP_HEIGHT = 6;
const TILE_SIZE = 32;
const ENCOUNTER_ID = 'c515-encounter';
const PLAYER_ID = 'player';

/** A wall at (3,1), between the player at (1,1) and the enemy at (4,1). */
const WALL = { x: 3, y: 1 };

const installTerrain = (): void => {
  const cellCount = MAP_WIDTH * MAP_HEIGHT;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    cost[i] = TERRAIN_COST_SCALE;
  }
  setTerrainGrid({ width: MAP_WIDTH, height: MAP_HEIGHT, tileSize: TILE_SIZE, cost, blocksSight });
};

const createParticipant = (options: {
  world: World;
  health: number;
  initiative: number;
  accuracy: number;
  evasion: number;
  cell: { x: number; y: number };
}): number => {
  const { world, cell } = options;
  const eid = addEntity(world);
  addComponent(world, eid, CombatStats);
  addComponent(
    world,
    eid,
    set(CombatStats, {
      health: options.health,
      maxHealth: options.health,
      initiative: options.initiative,
      attack: 5,
      defense: 0,
      accuracy: options.accuracy,
      evasion: options.evasion,
      xp: 0,
      level: 1,
      xpToNextLevel: 10,
    }),
  );
  addComponent(world, eid, TurnOrder);
  addComponent(
    world,
    eid,
    set(TurnOrder, { currentTurn: false, initiativeValue: options.initiative, isActive: true }),
  );
  addComponent(world, eid, GridPosition);
  addComponent(world, eid, set(GridPosition, { x: cell.x, y: cell.y }));
  // The driver writes the stable combatant id into CombatIdentity; the
  // component must already be attached for the registry's `query` to see it.
  addComponent(world, eid, CombatIdentity);
  return eid;
};

const ABILITY_CATALOG = {
  // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
  bow_shot: {
    abilityId: 'bow_shot',
    name: 'Bow Shot',
    kind: 'ranged_attack' as const,
    actionCost: 'action' as const,
    attackBonus: 3,
    damageDice: '1d8',
    damageType: 'piercing' as const,
    rangeCells: 6,
    requiresLineOfSight: false,
  },
};

type Harness = {
  world: World;
  bridge: MockEngineBridge;
  playerEid: number;
  enemyEid: number;
  playerId: string;
  enemyId: string;
  ready: Array<Extract<GameEvent, { type: 'COMBAT_PREVIEW_READY' }>>;
  rejected: Array<Extract<GameEvent, { type: 'COMBAT_PLAN_REJECTED' }>>;
  turns: Array<Extract<GameEvent, { type: 'TURN_CHANGED' }>>;
};

const createHarness = (options: { abilityCatalog?: Record<string, unknown> } = {}): Harness => {
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  registerCombatIdentityObservers(world);
  registerGridPositionObservers(world);
  installTerrain();

  const playerEid = createParticipant({
    world,
    health: 30,
    initiative: 20,
    accuracy: 5,
    evasion: 12,
    cell: { x: 1, y: 1 },
  });
  const enemyEid = createParticipant({
    world,
    health: 20,
    initiative: 10,
    accuracy: 3,
    evasion: 11,
    cell: { x: 4, y: 1 },
  });

  const bridge = new MockEngineBridge();
  const ready: Harness['ready'] = [];
  const rejected: Harness['rejected'] = [];
  const turns: Harness['turns'] = [];
  bridge.on('COMBAT_PREVIEW_READY', (event) => ready.push(event));
  bridge.on('COMBAT_PLAN_REJECTED', (event) => rejected.push(event));
  bridge.on('TURN_CHANGED', (event) => turns.push(event));

  startCombatTurns(world, bridge, {
    playerEntityId: playerEid,
    playerCombatantId: PLAYER_ID,
    encounterId: ENCOUNTER_ID,
    abilityCatalog: (options.abilityCatalog ?? ABILITY_CATALOG) as never,
    hooks: {
      runAiTurn: () => {},
      emitStateUpdate: () => {},
    },
  });

  const snapshot = getCombatPreviewSnapshot(world);
  const playerId = snapshot?.activeCombatantId ?? PLAYER_ID;
  const enemyId = snapshot?.order.find((id) => id !== playerId) ?? 'unknown';

  return { world, bridge, playerEid, enemyEid, playerId, enemyId, ready, rejected, turns };
};

const request = (
  query: Record<string, unknown>,
  overrides: Partial<{ requestId: string; encounterId: string; basedOnRevision: number }> = {},
) => ({
  type: 'COMBAT_PREVIEW_REQUESTED' as const,
  requestId: overrides.requestId ?? 'req-1',
  encounterId: overrides.encounterId ?? ENCOUNTER_ID,
  basedOnRevision: overrides.basedOnRevision ?? 0,
  query: query as never,
});

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

// The terrain/spatial grid is a MODULE singleton — restore it so no later test
// file inherits this fixture's map (C-379's `resetCollisionGrid`).
afterEach(() => {
  resetCollisionGrid();
});

// ---------------------------------------------------------------------------
// AC-5 — correlated, stale-safe round trip
// ---------------------------------------------------------------------------

describe('C-515 AC-5: the preview bridge round trip is correlated and stale-safe', () => {
  it('answers a legalMoves request with exactly one correlated COMBAT_PREVIEW_READY', () => {
    const { world, bridge, playerId } = harness;

    dispatchCombatCommand(request({ kind: 'legalMoves', combatantId: playerId }), {
      world,
      bridge,
      playerEntityId: harness.playerEid,
    });

    const ready = harness.ready;
    expect(ready).toHaveLength(1);
    expect(harness.rejected).toHaveLength(0);
    expect(ready[0]?.requestId).toBe('req-1');
    expect(ready[0]?.forecast.actionCost).toBe('movement');
    expect((ready[0]?.legalEndpoints ?? []).length).toBeGreaterThan(0);
    const costKeys = Object.keys(ready[0]?.movementCostTo ?? {});
    expect(costKeys.length).toBeGreaterThan(0);
    expect(costKeys.every((key) => /^-?\d+,-?\d+$/.test(key))).toBe(true);
  });

  it('answers a legalTargets request with the in-range visible enemy', () => {
    const { world, bridge, playerId, enemyId } = harness;

    dispatchCombatCommand(
      request({ kind: 'legalTargets', combatantId: playerId, abilityId: 'bow_shot' }),
      { world, bridge, playerEntityId: harness.playerEid },
    );

    const ready = harness.ready;
    expect(ready).toHaveLength(1);
    expect(ready[0]?.legalTargetIds).toEqual([enemyId]);
  });

  it('answers an action request with a non-committing forecast', () => {
    const { world, bridge, playerId } = harness;

    dispatchCombatCommand(
      request({
        kind: 'action',
        combatantId: playerId,
        command: {
          kind: 'move',
          combatantId: playerId,
          path: [
            { x: 1, y: 2 },
            { x: 2, y: 2 },
          ],
        },
      }),
      { world, bridge, playerEntityId: harness.playerEid },
    );

    const ready = harness.ready;
    expect(ready).toHaveLength(1);
    expect(ready[0]?.forecast.movementCost).toBe(2);
    expect(ready[0]?.forecast.path).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    // The forecast never moved the actor.
    expect(GridPosition.x[harness.playerEid]).toBe(1);
    expect(GridPosition.y[harness.playerEid]).toBe(1);
  });

  it('rejects a non-matching basedOnRevision as staleRevision and mutates nothing', () => {
    const { world, bridge, playerId, playerEid, enemyEid } = harness;
    const turnBefore = getActiveTurn(world);

    dispatchCombatCommand(
      request({ kind: 'legalMoves', combatantId: playerId }, { basedOnRevision: 7 }),
      { world, bridge, playerEntityId: playerEid },
    );

    expect(harness.ready).toHaveLength(0);
    const rejected = harness.rejected;
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.requestId).toBe('req-1');
    expect(rejected[0]?.reasonCode).toBe('staleRevision');
    expect(rejected[0]?.messageKey).toBe('combat.invalid.stale_revision');

    expect(getActiveTurn(world)).toEqual(turnBefore);
    expect((getComponent(world, playerEid, CombatStats) as CombatStatsData).health).toBe(30);
    expect((getComponent(world, enemyEid, CombatStats) as CombatStatsData).health).toBe(20);
    // No turn-stream or log noise.
    expect(harness.turns).toHaveLength(1);
  });

  it('rejects a non-active combatant as notActiveCombatant', () => {
    const { world, bridge, playerEid, enemyId } = harness;

    dispatchCombatCommand(request({ kind: 'legalMoves', combatantId: enemyId }), {
      world,
      bridge,
      playerEntityId: playerEid,
    });

    const rejected = harness.rejected;
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reasonCode).toBe('notActiveCombatant');
    expect(harness.ready).toHaveLength(0);
  });

  it('rejects a request for an unknown encounter', () => {
    const { world, bridge, playerId, playerEid } = harness;

    dispatchCombatCommand(
      request({ kind: 'legalMoves', combatantId: playerId }, { encounterId: 'other' }),
      { world, bridge, playerEntityId: playerEid },
    );

    const rejected = harness.rejected;
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reasonCode).toBe('encounterEnded');
  });

  it('is idempotent for the same revision — a duplicate requestId is ignorable', () => {
    const { world, bridge, playerId, playerEid } = harness;
    const query = { kind: 'legalMoves', combatantId: playerId };

    dispatchCombatCommand(request(query, { requestId: 'dup' }), {
      world,
      bridge,
      playerEntityId: playerEid,
    });
    dispatchCombatCommand(request(query, { requestId: 'dup' }), {
      world,
      bridge,
      playerEntityId: playerEid,
    });

    const ready = harness.ready;
    expect(ready).toHaveLength(2);
    expect(ready[0]?.requestId).toBe('dup');
    expect(ready[1]?.requestId).toBe('dup');
    expect(JSON.stringify(ready[0])).toBe(JSON.stringify(ready[1]));
  });
});

// ---------------------------------------------------------------------------
// AC-7 — the production engine path
// ---------------------------------------------------------------------------

describe('C-515 AC-7: the production engine path answers previews on the active turn', () => {
  it('returns a schema-valid result and leaves the revision and turn unchanged', () => {
    const { world, bridge, playerId } = harness;
    const turnBefore = getActiveTurn(world);

    const result: CombatPreviewResult = handleCombatPreviewRequest({
      world,
      bridge,
      request: request({ kind: 'legalMoves', combatantId: playerId }),
    });

    expect(Value.Check(CombatPreviewResultSchema, result)).toBe(true);
    expect(result.valid).toBe(true);
    expect(getActiveTurn(world)).toEqual(turnBefore);
  });

  it('builds the live battlefield and CombatState from the ECS world', () => {
    const { world, playerId } = harness;
    const battlefield = snapshotBattlefield(world);
    const state: CombatState = snapshotCombatState(world, {
      encounterId: ENCOUNTER_ID,
      rulesVersion: 'combat-2.0.0',
      seed: 0,
      abilityCatalog: ABILITY_CATALOG,
      battlefield,
      playerCombatantId: PLAYER_ID,
    });

    expect(battlefield.movementCost).toHaveLength(MAP_WIDTH * MAP_HEIGHT);
    expect(state.stateRevision).toBe(0);
    expect(state.combatants[playerId]?.position).toEqual({ x: 1, y: 1 });
    // The wall is solid and opaque for terrain reasons only.
    expect(state.battlefield.movementCost?.[WALL.y * MAP_WIDTH + WALL.x]).toBe(1);
    expect(state.battlefield.blocksSight?.[WALL.y * MAP_WIDTH + WALL.x]).toBe(false);
  });

  it('rejects an action preview for an ability absent from the catalog with abilityUnknown', () => {
    const { world, bridge, playerId, playerEid } = harness;

    dispatchCombatCommand(
      request({
        kind: 'action',
        combatantId: playerId,
        command: {
          kind: 'useAbility',
          combatantId: playerId,
          abilityId: 'not_in_catalog',
          targetIds: [],
        },
      }),
      { world, bridge, playerEntityId: playerEid },
    );

    const rejected = harness.rejected;
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reasonCode).toBe('abilityUnknown');
    expect(rejected[0]?.messageKey).toBe('combat.invalid.ability_unknown');
  });

  it('rejects a legalTargets preview for an ability absent from the catalog', () => {
    const { world, bridge, playerId, playerEid } = harness;

    dispatchCombatCommand(
      request({ kind: 'legalTargets', combatantId: playerId, abilityId: 'not_in_catalog' }),
      { world, bridge, playerEntityId: playerEid },
    );

    expect(harness.rejected[0]?.reasonCode).toBe('abilityUnknown');
  });

  it('never throws when the encounter started with an empty catalog', () => {
    const empty = createHarness({ abilityCatalog: {} });
    const turnBefore = getActiveTurn(empty.world);

    dispatchCombatCommand(request({ kind: 'legalMoves', combatantId: empty.playerId }), {
      world: empty.world,
      bridge: empty.bridge,
      playerEntityId: empty.playerEid,
    });
    expect(empty.ready).toHaveLength(1);

    dispatchCombatCommand(
      request({
        kind: 'legalTargets',
        combatantId: empty.playerId,
        abilityId: 'bow_shot',
      }),
      { world: empty.world, bridge: empty.bridge, playerEntityId: empty.playerEid },
    );
    expect(empty.rejected[0]?.reasonCode).toBe('abilityUnknown');

    expect(getActiveTurn(empty.world)).toEqual(turnBefore);
    // The player identity is still registered even with no catalog.
    expect(CombatIdentity.combatantId[empty.playerEid]).toBe(empty.playerId);
    expect((getComponent(empty.world, empty.enemyEid, TurnOrder) as TurnOrderData).isActive).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-5 — main-thread forwarding registration
// ---------------------------------------------------------------------------

describe('C-515 AC-5: COMBAT_PREVIEW_REQUESTED is registered for the worker', () => {
  it('registers the preview command alongside the other combat commands', () => {
    const registered: string[] = [];

    registerCombatBridgeCommands({
      register: (type) => {
        registered.push(type);
      },
      post: () => {},
    });

    expect(registered).toEqual(['COMBAT_ACTION', 'COMBAT_END_TURN', 'COMBAT_PREVIEW_REQUESTED']);
  });

  it('forwards the correlation id, revision and query verbatim', () => {
    const command = {
      type: 'COMBAT_PREVIEW_REQUESTED' as const,
      requestId: 'req-forward',
      encounterId: ENCOUNTER_ID,
      basedOnRevision: 3,
      query: { kind: 'legalMoves' as const, combatantId: PLAYER_ID },
    };

    expect(toCombatPreviewEnvelope(command)).toEqual({
      type: 'COMBAT_PREVIEW_REQUESTED',
      requestId: 'req-forward',
      encounterId: ENCOUNTER_ID,
      basedOnRevision: 3,
      query: { kind: 'legalMoves', combatantId: PLAYER_ID },
    });
  });
});
