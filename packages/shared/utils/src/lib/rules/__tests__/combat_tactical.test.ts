// packages/shared/utils/src/lib/rules/__tests__/combat_tactical.test.ts
//
// C-515 (Combat-03) pure tactical-query coverage.
//
//   AC-2  reachable endpoints respect the movement budget and terrain cost
//   AC-3  legal targets use range and line of sight
//   AC-4  forecast is deterministic and non-mutating
//   AC-8  quantization is canonical and round-trips
//
// Contract: C-515 AC-2, AC-3, AC-4, AC-8

import { describe, expect, it } from 'bun:test';
import type {
  BattlefieldState,
  CombatAbilityDefinition,
  CombatantState,
  CombatCommand,
  CombatState,
} from '@aikami/types';
import { COMBAT_RULES_VERSION, canonicalCombatJson, createCombatState } from '../combat_kernel';
import {
  cellKey,
  cellToWorldPixel,
  computeReachableEndpoints,
  hasLineOfSight,
  worldPixelToCell,
} from '../combat_spatial';
import { forecastCombatAction, getLegalActions } from '../combat_tactical';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRID = { width: 8, height: 5 };

const openBattlefield = (overrides: Partial<BattlefieldState> = {}): BattlefieldState => ({
  width: GRID.width,
  height: GRID.height,
  blockedCells: [],
  ...overrides,
});

const uniformCost = (width: number, height: number, cost = 1): number[] =>
  Array.from({ length: width * height }, () => cost);

const noSight = (width: number, height: number): boolean[] =>
  Array.from({ length: width * height }, () => false);

const catalog = (
  overrides: Partial<CombatAbilityDefinition> & { abilityId: string },
): CombatAbilityDefinition => ({
  name: overrides.abilityId,
  kind: 'ranged_attack',
  actionCost: 'action',
  attackBonus: 3,
  damageDice: '1d8',
  damageType: 'piercing',
  rangeCells: 6,
  requiresLineOfSight: true,
  ...overrides,
});

const CATALOG: Record<string, CombatAbilityDefinition> = {
  // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
  bow_shot: catalog({ abilityId: 'bow_shot' }),
  // A non-attack ability that still names a target and requires sight — the
  // C-515 widening beyond `kind: 'ranged_attack'`.
  // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
  hex_bolt: catalog({
    abilityId: 'hex_bolt',
    kind: 'utility',
    actionCost: 'quick',
    damageDice: null,
    damageType: null,
  }),
  // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
  basic_melee: catalog({
    abilityId: 'basic_melee',
    kind: 'melee_attack',
    rangeCells: 1,
    requiresLineOfSight: false,
  }),
};

const makeCombatant = (
  overrides: Partial<CombatantState> & { combatantId: string },
): CombatantState => ({
  name: overrides.combatantId,
  team: 'enemy',
  position: { x: 0, y: 0 },
  hp: 10,
  maxHp: 10,
  armorClass: 12,
  attackBonus: 3,
  initiative: 10,
  abilityIds: ['bow_shot'],
  budget: {
    movementRemaining: 6,
    actionAvailable: true,
    quickActionAvailable: true,
    reactionAvailable: true,
  },
  downed: false,
  defeated: false,
  ...overrides,
});

const buildState = (
  overrides: {
    combatants?: CombatantState[];
    battlefield?: BattlefieldState;
    abilityCatalog?: Record<string, CombatAbilityDefinition>;
  } = {},
): CombatState =>
  createCombatState({
    encounterId: 'c515-encounter',
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 99,
    combatants: overrides.combatants ?? [
      makeCombatant({
        combatantId: 'hero',
        team: 'player',
        position: { x: 2, y: 2 },
        initiative: 20,
        abilityIds: ['bow_shot', 'hex_bolt', 'basic_melee'],
      }),
      makeCombatant({ combatantId: 'goblin', position: { x: 5, y: 2 }, initiative: 10 }),
    ],
    abilityCatalog: overrides.abilityCatalog ?? CATALOG,
    battlefield: overrides.battlefield ?? openBattlefield(),
    objectives: [],
  });

const sortedKeys = (cells: Array<{ x: number; y: number }>): string[] => cells.map(cellKey);

// ---------------------------------------------------------------------------
// AC-8 — quantization
// ---------------------------------------------------------------------------

describe('C-515 AC-8: worldPixelToCell / cellToWorldPixel are canonical', () => {
  it('floors a pixel into the cell that contains it', () => {
    expect(worldPixelToCell({ px: 0, py: 0, tileSize: 32 })).toEqual({ x: 0, y: 0 });
    expect(worldPixelToCell({ px: 31, py: 31, tileSize: 32 })).toEqual({ x: 0, y: 0 });
    expect(worldPixelToCell({ px: 32, py: 32, tileSize: 32 })).toEqual({ x: 1, y: 1 });
  });

  it('floors toward the correct cell for negative pixels (never truncates to 0)', () => {
    expect(worldPixelToCell({ px: -1, py: 0, tileSize: 32 })).toEqual({ x: -1, y: 0 });
    expect(worldPixelToCell({ px: 0, py: -33, tileSize: 32 })).toEqual({ x: 0, y: -2 });
    expect(Math.trunc(-1 / 32) === 0).toBe(true);
  });

  it('returns the tile CENTRE, not the corner', () => {
    expect(cellToWorldPixel({ cell: { x: 0, y: 0 }, tileSize: 32 })).toEqual({ x: 16, y: 16 });
    expect(cellToWorldPixel({ cell: { x: 2, y: 3 }, tileSize: 32 })).toEqual({ x: 80, y: 112 });
    expect(cellToWorldPixel({ cell: { x: 2, y: 3 }, tileSize: 16 })).toEqual({ x: 40, y: 56 });
  });

  it('round-trips every in-bounds cell for tile sizes 16/32/48', () => {
    for (const tileSize of [16, 32, 48]) {
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
          const centre = cellToWorldPixel({ cell: { x, y }, tileSize });
          expect(worldPixelToCell({ px: centre.x, py: centre.y, tileSize })).toEqual({ x, y });
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC-2 — reachability
// ---------------------------------------------------------------------------

describe('C-515 AC-2: computeReachableEndpoints respects budget and terrain cost', () => {
  it('returns exactly the 4-connected cells within budget, ordered y then x', () => {
    const battlefield = openBattlefield();
    const result = computeReachableEndpoints({
      battlefield,
      origin: { x: 2, y: 2 },
      movementBudget: 1,
    });

    expect(sortedKeys(result.endpoints)).toEqual(['2,1', '1,2', '3,2', '2,3']);
    expect(result.costTo).toEqual({ '2,1': 1, '1,2': 1, '3,2': 1, '2,3': 1 });
  });

  it('never reports the origin as an endpoint and excludes diagonals', () => {
    const result = computeReachableEndpoints({
      battlefield: openBattlefield(),
      origin: { x: 2, y: 2 },
      movementBudget: 1,
    });
    expect(sortedKeys(result.endpoints)).not.toContain('2,2');
    // A diagonal is two 4-connected steps, never one.
    expect(sortedKeys(result.endpoints)).not.toContain('3,3');
    expect(sortedKeys(result.endpoints)).not.toContain('1,1');
  });

  it('returns nothing for a zero budget', () => {
    const result = computeReachableEndpoints({
      battlefield: openBattlefield(),
      origin: { x: 2, y: 2 },
      movementBudget: 0,
    });
    expect(result.endpoints).toEqual([]);
    expect(result.costTo).toEqual({});
  });

  it('excludes cost-0 cells and blockedCells, and reports the shortest-path cost', () => {
    const cost = uniformCost(GRID.width, GRID.height);
    // A wall to the east and a mud cell to the west (cost 3).
    cost[2 * GRID.width + 3] = 0;
    cost[2 * GRID.width + 1] = 3;

    const result = computeReachableEndpoints({
      battlefield: openBattlefield({ movementCost: cost }),
      origin: { x: 2, y: 2 },
      movementBudget: 4,
    });

    expect(sortedKeys(result.endpoints)).not.toContain('3,2');
    expect(result.costTo['1,2']).toBe(3);
    // (0,2) is reachable only through the mud cell: 3 + 1.
    expect(result.costTo['0,2']).toBe(4);

    const blocked = computeReachableEndpoints({
      battlefield: openBattlefield({ blockedCells: [{ x: 3, y: 2 }] }),
      origin: { x: 2, y: 2 },
      movementBudget: 2,
    });
    expect(sortedKeys(blocked.endpoints)).not.toContain('3,2');
    expect(sortedKeys(blocked.endpoints)).not.toContain('4,2');
  });

  it('treats out-of-bounds and occupied cells as unreachable', () => {
    const corner = computeReachableEndpoints({
      battlefield: openBattlefield(),
      origin: { x: 0, y: 0 },
      movementBudget: 3,
    });
    expect(sortedKeys(corner.endpoints).every((key) => !key.startsWith('-'))).toBe(true);

    const occupied = computeReachableEndpoints({
      battlefield: openBattlefield(),
      origin: { x: 2, y: 2 },
      movementBudget: 2,
      occupied: [{ x: 3, y: 2 }],
    });
    expect(sortedKeys(occupied.endpoints)).not.toContain('3,2');
    expect(sortedKeys(occupied.endpoints)).not.toContain('4,2');
  });

  it('does not mutate the battlefield and is byte-identical across runs', () => {
    const battlefield = Object.freeze(openBattlefield({ movementCost: uniformCost(8, 5) }));
    const first = computeReachableEndpoints({
      battlefield,
      origin: { x: 2, y: 2 },
      movementBudget: 3,
    });
    const second = computeReachableEndpoints({
      battlefield,
      origin: { x: 2, y: 2 },
      movementBudget: 3,
    });
    expect(canonicalCombatJson(first)).toBe(canonicalCombatJson(second));
    // costTo keys are inserted in the same order as endpoints.
    expect(Object.keys(first.costTo)).toEqual(sortedKeys(first.endpoints));
  });

  it('getLegalActions exposes the same legal move set', () => {
    const state = buildState();
    const actions = getLegalActions({ state, combatantId: 'hero' });
    const direct = computeReachableEndpoints({
      battlefield: state.battlefield,
      origin: { x: 2, y: 2 },
      movementBudget: 6,
      occupied: [{ x: 5, y: 2 }],
    });
    expect(sortedKeys(actions.endpoints)).toEqual(sortedKeys(direct.endpoints));
    expect(actions.budget.movementRemaining).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — range + line of sight
// ---------------------------------------------------------------------------

describe('C-515 AC-3: legal targets use range and line of sight', () => {
  /** A single opaque cell at (3,2), between the hero (2,2) and the goblin (5,2). */
  const occluded = (): BattlefieldState => {
    const sight = noSight(GRID.width, GRID.height);
    sight[2 * GRID.width + 3] = true;
    return openBattlefield({ blocksSight: sight });
  };

  it('rejects a target with no line of sight using targetNotVisible', () => {
    const state = buildState({ battlefield: occluded() });
    const result = forecastCombatAction({
      state,
      command: {
        kind: 'useAbility',
        combatantId: 'hero',
        abilityId: 'bow_shot',
        targetIds: ['goblin'],
      },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('targetNotVisible');
      expect(result.messageKey).toBe('combat.invalid.target_not_visible');
    }
  });

  it('enforces line of sight for a non-attack ability that names a target', () => {
    const state = buildState({ battlefield: occluded() });
    const result = forecastCombatAction({
      state,
      command: {
        kind: 'useAbility',
        combatantId: 'hero',
        abilityId: 'hex_bolt',
        targetIds: ['goblin'],
      },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('targetNotVisible');
    }
  });

  it('reports targetOutOfRange before line of sight', () => {
    const state = buildState({ battlefield: occluded() });
    const result = forecastCombatAction({
      state,
      command: {
        kind: 'useAbility',
        combatantId: 'hero',
        abilityId: 'basic_melee',
        targetIds: ['goblin'],
      },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('targetOutOfRange');
    }
  });

  it('maps defeated / self / unknown targets to their C-509 reasons', () => {
    const state = buildState({
      combatants: [
        makeCombatant({
          combatantId: 'hero',
          team: 'player',
          position: { x: 2, y: 2 },
          initiative: 20,
          abilityIds: ['bow_shot'],
        }),
        makeCombatant({ combatantId: 'goblin', position: { x: 5, y: 2 }, defeated: true, hp: 0 }),
      ],
    });

    const defeated = forecastCombatAction({
      state,
      command: {
        kind: 'useAbility',
        combatantId: 'hero',
        abilityId: 'bow_shot',
        targetIds: ['goblin'],
      },
    });
    expect(defeated.valid).toBe(false);
    if (!defeated.valid) {
      expect(defeated.reasonCode).toBe('targetDefeated');
    }

    const self = forecastCombatAction({
      state,
      command: {
        kind: 'useAbility',
        combatantId: 'hero',
        abilityId: 'bow_shot',
        targetIds: ['hero'],
      },
    });
    expect(self.valid).toBe(false);
    if (!self.valid) {
      expect(self.reasonCode).toBe('targetInvalid');
    }

    const unknown = forecastCombatAction({
      state,
      command: {
        kind: 'useAbility',
        combatantId: 'hero',
        abilityId: 'bow_shot',
        targetIds: ['nobody'],
      },
    });
    expect(unknown.valid).toBe(false);
    if (!unknown.valid) {
      expect(unknown.reasonCode).toBe('targetInvalid');
    }
  });

  it('leaves C-509 behaviour intact when blocksSight is absent', () => {
    const state = buildState();
    const result = forecastCombatAction({
      state,
      command: {
        kind: 'useAbility',
        combatantId: 'hero',
        abilityId: 'bow_shot',
        targetIds: ['goblin'],
      },
    });
    expect(result.valid).toBe(true);
  });

  it('getLegalActions legalTargets match what the kernel accepts', () => {
    const state = buildState({ battlefield: occluded() });
    const actions = getLegalActions({ state, combatantId: 'hero' });
    expect(actions.targetsByAbility.bow_shot).toEqual([]);
    expect(actions.targetsByAbility.hex_bolt).toEqual([]);
  });

  it('getLegalActions lists a visible in-range target', () => {
    const state = buildState();
    const actions = getLegalActions({ state, combatantId: 'hero' });
    expect(actions.targetsByAbility.bow_shot).toEqual(['goblin']);
    expect(actions.targetsByAbility.basic_melee).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — forecast
// ---------------------------------------------------------------------------

describe('C-515 AC-4: forecast is deterministic and non-mutating', () => {
  const freeze = <T>(value: T): T => {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value as Record<string, unknown>)) {
        freeze(child);
      }
    }
    return value;
  };

  it('forecasts a move with its path and cost without mutating the state', () => {
    const state = freeze(buildState());
    const before = canonicalCombatJson(state);
    const command: CombatCommand = {
      kind: 'move',
      combatantId: 'hero',
      path: [
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ],
    };

    const result = forecastCombatAction({ state, command });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.forecast.actionCost).toBe('movement');
      expect(result.forecast.path).toEqual([
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ]);
      expect(result.forecast.movementCost).toBe(2);
      expect(result.forecast.reactionRisks).toEqual([]);
      expect(result.forecast.objectiveEffects).toEqual([]);
    }
    expect(canonicalCombatJson(state)).toBe(before);
  });

  it('forecasts an attack with advisory hit chance and damage range, without advancing the RNG', () => {
    const state = freeze(buildState());
    const rngBefore = canonicalCombatJson(state.rng);

    const result = forecastCombatAction({
      state,
      command: {
        kind: 'useAbility',
        combatantId: 'hero',
        abilityId: 'bow_shot',
        targetIds: ['goblin'],
      },
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.forecast.actionCost).toBe('action');
      expect(result.forecast.hitChance).toBeGreaterThan(0);
      expect(result.forecast.hitChance).toBeLessThanOrEqual(1);
      expect(result.forecast.damageRange).toEqual({ minimum: 1, maximum: 8 });
      expect(result.forecast.affectedEntityIds).toEqual(['goblin']);
      expect(result.forecast.affectedCells).toEqual([{ x: 5, y: 2 }]);
    }
    expect(canonicalCombatJson(state.rng)).toBe(rngBefore);
  });

  it('produces byte-identical output for the same input', () => {
    const state = buildState();
    const command: CombatCommand = {
      kind: 'useAbility',
      combatantId: 'hero',
      abilityId: 'bow_shot',
      targetIds: ['goblin'],
    };
    const first = forecastCombatAction({ state, command });
    const second = forecastCombatAction({ state, command });
    expect(canonicalCombatJson(first)).toBe(canonicalCombatJson(second));
  });

  it('returns a typed rejection for an invalid command', () => {
    const state = buildState();
    const result = forecastCombatAction({
      state,
      command: {
        kind: 'useAbility',
        combatantId: 'hero',
        abilityId: 'not_in_catalog',
        targetIds: ['goblin'],
      },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('abilityUnknown');
      expect(result.messageKey).toBe('combat.invalid.ability_unknown');
    }
  });

  it('warns affectsAlly and marks endTurn with endsTurn', () => {
    const state = buildState({
      combatants: [
        makeCombatant({
          combatantId: 'hero',
          team: 'player',
          position: { x: 2, y: 2 },
          initiative: 20,
          abilityIds: ['bow_shot'],
        }),
        makeCombatant({
          combatantId: 'ally',
          team: 'ally',
          position: { x: 4, y: 2 },
          initiative: 10,
          abilityIds: ['bow_shot'],
        }),
      ],
    });

    const friendly = forecastCombatAction({
      state,
      command: {
        kind: 'useAbility',
        combatantId: 'hero',
        abilityId: 'bow_shot',
        targetIds: ['ally'],
      },
    });
    expect(friendly.valid).toBe(true);
    if (friendly.valid) {
      expect(friendly.forecast.warnings).toEqual(['affectsAlly']);
    }

    const endTurn = forecastCombatAction({
      state,
      command: { kind: 'endTurn', combatantId: 'hero' },
    });
    expect(endTurn.valid).toBe(true);
    if (endTurn.valid) {
      expect(endTurn.forecast.warnings).toEqual(['endsTurn']);
    }
  });
});

// ---------------------------------------------------------------------------
// Line-of-sight primitive
// ---------------------------------------------------------------------------

describe('C-515: hasLineOfSight skips origin and target cells', () => {
  it('is unobstructed when blocksSight is absent', () => {
    expect(
      hasLineOfSight({
        battlefield: openBattlefield(),
        from: { x: 0, y: 0 },
        to: { x: 4, y: 0 },
      }),
    ).toBe(true);
  });

  it('is blocked by an intermediate opaque cell but not by the endpoints', () => {
    const sight = noSight(GRID.width, GRID.height);
    sight[0 * GRID.width + 0] = true;
    sight[0 * GRID.width + 4] = true;
    const battlefield = openBattlefield({ blocksSight: sight });

    expect(hasLineOfSight({ battlefield, from: { x: 0, y: 0 }, to: { x: 4, y: 0 } })).toBe(true);

    sight[0 * GRID.width + 2] = true;
    expect(hasLineOfSight({ battlefield, from: { x: 0, y: 0 }, to: { x: 4, y: 0 } })).toBe(false);
  });
});
