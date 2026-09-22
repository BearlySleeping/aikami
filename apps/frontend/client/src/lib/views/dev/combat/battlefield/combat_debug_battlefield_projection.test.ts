// apps/frontend/client/src/lib/views/dev/combat/battlefield/combat_debug_battlefield_projection.test.ts
//
// Unit tests for the synthetic battlefield projections: the collision grid a
// scenario declares, board dimensions, authoritative blocked cells and the
// CombatState → token mapping. Nothing here asserts rendering; it asserts the
// data the engine will paint.
import { describe, expect, test } from 'bun:test';
import type { CombatState } from '@aikami/types';
import { COMBAT_RULES_VERSION, createCombatState } from '@aikami/utils';
import {
  buildCombatDebugSceneSpec,
  buildSyntheticCollisionGrid,
  countCombatDebugCombatants,
  DEFAULT_COMBAT_DEBUG_OVERLAY_LAYERS,
} from './combat_debug_battlefield_projection.ts';

const PLAYER_ID = 'player';
const HOSTILE_ID = 'debug_hostile';

/** A two-combatant state on a 4×4 board with one terrain-blocked cell. */
const stateWithBlockedCell = (): CombatState =>
  createCombatState({
    encounterId: 'combat-debug-scenario',
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 1337,
    combatants: [
      {
        combatantId: PLAYER_ID,
        name: 'Adventurer',
        team: 'player',
        position: { x: 2, y: 2 },
        hp: 30,
        maxHp: 30,
        armorClass: 13,
        attackBonus: 4,
        initiative: 10,
        abilityIds: ['basic_melee'],
        budget: {
          movementRemaining: 6,
          actionAvailable: true,
          quickActionAvailable: true,
          reactionAvailable: true,
        },
        downed: false,
        defeated: false,
      },
      {
        combatantId: HOSTILE_ID,
        name: 'Hostile',
        team: 'enemy',
        position: { x: 4, y: 2 },
        hp: 18,
        maxHp: 18,
        armorClass: 11,
        attackBonus: 3,
        initiative: 8,
        abilityIds: ['basic_melee'],
        budget: {
          movementRemaining: 6,
          actionAvailable: true,
          quickActionAvailable: true,
          reactionAvailable: true,
        },
        downed: false,
        defeated: false,
      },
    ],
    abilityCatalog: {
      // biome-ignore lint/style/useNamingConvention: authored content id
      basic_melee: {
        abilityId: 'basic_melee',
        name: 'Basic Melee',
        kind: 'melee_attack',
        actionCost: 'action',
        attackBonus: 2,
        damageDice: '1d6',
        damageType: 'slashing',
        rangeCells: 1,
        requiresLineOfSight: false,
      },
    },
    battlefield: {
      width: 4,
      height: 4,
      blockedCells: [{ x: 1, y: 1 }],
      movementCost: [1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
    objectives: [],
  });

describe('buildSyntheticCollisionGrid', () => {
  test('maps the declared dimensions, tile size and blocked cells', () => {
    const grid = buildSyntheticCollisionGrid({
      kind: 'synthetic',
      width: 10,
      height: 8,
      blockedCells: [{ x: 4, y: 4 }],
    });
    expect(grid).toBeDefined();
    expect(grid?.width).toBe(10);
    expect(grid?.height).toBe(8);
    expect(grid?.tileSize).toBe(32);
    expect(grid?.grid).toHaveLength(80);
    expect(grid?.grid[4 * 10 + 4]).toBe(true);
    expect(grid?.grid[0]).toBe(false);
  });

  test('ignores blocked cells outside the declared board', () => {
    const grid = buildSyntheticCollisionGrid({
      kind: 'synthetic',
      width: 4,
      height: 4,
      blockedCells: [{ x: 99, y: 99 }],
    });
    expect(grid?.grid.some((solid) => solid)).toBe(false);
  });

  test('returns undefined for an authored battlefield', () => {
    expect(
      buildSyntheticCollisionGrid({ kind: 'authored', mapId: 'inn', encounterId: 'x' }),
    ).toBeUndefined();
  });
});

describe('buildCombatDebugSceneSpec', () => {
  test('uses the declarative battlefield before any state arrives', () => {
    const scene = buildCombatDebugSceneSpec({
      state: undefined,
      syntheticBattlefield: {
        kind: 'synthetic',
        width: 12,
        height: 12,
        blockedCells: [{ x: 3, y: 3 }],
      },
      layers: DEFAULT_COMBAT_DEBUG_OVERLAY_LAYERS,
      activeCombatantId: undefined,
      selectedCombatantId: undefined,
      targetedCombatantId: undefined,
      reachableCells: [],
      targetCells: [],
    });
    expect(scene?.width).toBe(12);
    expect(scene?.height).toBe(12);
    expect(scene?.blockedCells).toEqual([{ x: 3, y: 3 }]);
    expect(scene?.actors).toEqual([]);
  });

  test('prefers authoritative state dimensions and terrain-blocked cells', () => {
    const scene = buildCombatDebugSceneSpec({
      state: stateWithBlockedCell(),
      syntheticBattlefield: {
        kind: 'synthetic',
        width: 99,
        height: 99,
        blockedCells: [],
      },
      layers: DEFAULT_COMBAT_DEBUG_OVERLAY_LAYERS,
      activeCombatantId: PLAYER_ID,
      selectedCombatantId: undefined,
      targetedCombatantId: undefined,
      reachableCells: [],
      targetCells: [],
    });
    expect(scene?.width).toBe(4);
    expect(scene?.height).toBe(4);
    // Occupancy is not terrain; only the cost-0 cell is reported as blocked.
    expect(scene?.blockedCells).toEqual([{ x: 1, y: 1 }]);
  });

  test('projects every combatant onto its authoritative cell', () => {
    const scene = buildCombatDebugSceneSpec({
      state: stateWithBlockedCell(),
      syntheticBattlefield: undefined,
      layers: DEFAULT_COMBAT_DEBUG_OVERLAY_LAYERS,
      activeCombatantId: PLAYER_ID,
      selectedCombatantId: undefined,
      targetedCombatantId: undefined,
      reachableCells: [],
      targetCells: [],
    });
    expect(scene?.actors).toHaveLength(2);
    const hostile = scene?.actors?.find((actor) => actor.id === HOSTILE_ID);
    const player = scene?.actors?.find((actor) => actor.id === PLAYER_ID);
    expect(hostile?.cell).toEqual({ x: 4, y: 2 });
    expect(hostile?.team).toBe('enemy');
    expect(player?.active).toBe(true);
    expect(player?.hp).toBe(30);
    expect(player?.maxHp).toBe(30);
  });

  test('echoes selection cells only when the layer is enabled', () => {
    const base = {
      state: stateWithBlockedCell(),
      syntheticBattlefield: undefined,
      activeCombatantId: PLAYER_ID,
      selectedCombatantId: undefined,
      targetedCombatantId: undefined,
      reachableCells: [{ x: 2, y: 3 }],
      targetCells: [{ x: 3, y: 2 }],
    };
    const off = buildCombatDebugSceneSpec({
      ...base,
      layers: DEFAULT_COMBAT_DEBUG_OVERLAY_LAYERS,
    });
    const on = buildCombatDebugSceneSpec({
      ...base,
      layers: { ...DEFAULT_COMBAT_DEBUG_OVERLAY_LAYERS, reachable: true, targets: true },
    });
    expect(off?.reachableCells).toEqual([]);
    expect(off?.targetCells).toEqual([]);
    expect(on?.reachableCells).toEqual([{ x: 2, y: 3 }]);
    expect(on?.targetCells).toEqual([{ x: 3, y: 2 }]);
  });

  test('counts combatants for parity diagnostics', () => {
    expect(countCombatDebugCombatants(stateWithBlockedCell())).toBe(2);
    expect(countCombatDebugCombatants(undefined)).toBe(0);
  });
});
