// packages/shared/utils/src/lib/rules/__tests__/combat_fixtures.ts
//
// Shared fixtures for the combat kernel test suites.
// Contract: C-509

import type {
  BattlefieldState,
  CombatAbilityDefinition,
  CombatantState,
  CombatObjectiveState,
  GridPoint,
} from '@aikami/types';

export const ENCOUNTER_ID = 'emberwatch-encounter-1';
export const RULES_VERSION = 'combat-2.0.0';
export const PLAYER_ID = 'player-hero';
export const GOBLIN_1 = 'emberwatch:goblin-1';
export const GOBLIN_2 = 'emberwatch:goblin-2';

export const BATTLEFIELD: BattlefieldState = {
  width: 8,
  height: 8,
  blockedCells: [{ x: 2, y: 0 }],
};

export const ABILITY_CATALOG: Record<string, CombatAbilityDefinition> = {
  // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
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
  // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
  heavy_melee: {
    abilityId: 'heavy_melee',
    name: 'Heavy Melee',
    kind: 'melee_attack',
    actionCost: 'action',
    attackBonus: 4,
    damageDice: '3d6+4',
    damageType: 'bludgeoning',
    rangeCells: 1,
    requiresLineOfSight: false,
  },
  // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
  bow_shot: {
    abilityId: 'bow_shot',
    name: 'Bow Shot',
    kind: 'ranged_attack',
    actionCost: 'action',
    attackBonus: 3,
    damageDice: '1d8',
    damageType: 'piercing',
    rangeCells: 6,
    requiresLineOfSight: false,
  },
  guard: {
    abilityId: 'guard',
    name: 'Guard',
    kind: 'defend',
    actionCost: 'action',
    attackBonus: 0,
    damageDice: null,
    damageType: null,
    rangeCells: 0,
    requiresLineOfSight: false,
  },
  focus: {
    abilityId: 'focus',
    name: 'Focus',
    kind: 'utility',
    actionCost: 'quick',
    attackBonus: 0,
    damageDice: null,
    damageType: null,
    rangeCells: 0,
    requiresLineOfSight: false,
  },
};

export const DEFAULT_BUDGET = (): CombatantState['budget'] => ({
  movementRemaining: 6,
  actionAvailable: true,
  quickActionAvailable: true,
  reactionAvailable: true,
});

export const makeCombatant = (
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
  abilityIds: ['basic_melee'],
  budget: DEFAULT_BUDGET(),
  downed: false,
  defeated: false,
  ...overrides,
});

export const makeCombatants = (): CombatantState[] => [
  makeCombatant({
    combatantId: PLAYER_ID,
    name: 'Hero',
    team: 'player',
    position: { x: 0, y: 0 },
    hp: 20,
    maxHp: 20,
    armorClass: 12,
    attackBonus: 5,
    initiative: 14,
    abilityIds: ['basic_melee', 'heavy_melee', 'bow_shot', 'guard', 'focus'],
  }),
  makeCombatant({
    combatantId: GOBLIN_1,
    name: 'Goblin Scout',
    team: 'enemy',
    position: { x: 1, y: 0 },
    hp: 12,
    maxHp: 12,
    armorClass: 13,
    attackBonus: 3,
    initiative: 11,
    abilityIds: ['basic_melee'],
  }),
  makeCombatant({
    combatantId: GOBLIN_2,
    name: 'Goblin Archer',
    team: 'enemy',
    position: { x: 3, y: 3 },
    hp: 8,
    maxHp: 8,
    armorClass: 11,
    attackBonus: 2,
    initiative: 9,
    abilityIds: ['basic_melee'],
  }),
];

export const OBJECTIVES: CombatObjectiveState[] = [
  { objectiveId: 'survive', kind: 'survival', status: 'pending' },
];

export const createInput = (
  overrides: {
    combatants?: CombatantState[];
    seed?: number;
    objectives?: CombatObjectiveState[];
    rulesVersion?: string;
    encounterId?: string;
  } = {},
) => ({
  encounterId: overrides.encounterId ?? ENCOUNTER_ID,
  rulesVersion: overrides.rulesVersion ?? RULES_VERSION,
  seed: overrides.seed ?? 1337,
  combatants: overrides.combatants ?? makeCombatants(),
  abilityCatalog: ABILITY_CATALOG,
  battlefield: BATTLEFIELD,
  objectives: overrides.objectives ?? OBJECTIVES,
});

/** Deep-freezes a value so accidental mutation throws in strict mode. */
export const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
};

export const gridPoint = (x: number, y: number): GridPoint => ({ x, y });

/** Contiguous horizontal path starting one cell to the right of (x, y). */
export const eastwardPath = (x: number, y: number, steps: number): GridPoint[] =>
  Array.from({ length: steps }, (_, index) => gridPoint(x + index + 1, y));

/** Contiguous vertical path starting one cell below (x, y). */
export const southwardPath = (x: number, y: number, steps: number): GridPoint[] =>
  Array.from({ length: steps }, (_, index) => gridPoint(x, y + index + 1));
