// packages/shared/utils/src/lib/rules/__tests__/combat_depth_fixtures.ts
//
// Fixtures for the Combat-08 objective / morale / reaction / settlement suites.
// Contract: C-532

import type {
  CombatAbilityDefinition,
  CombatantState,
  MoraleRules,
  ObjectiveRules,
  ReactionRegistry,
} from '@aikami/types';
import {
  ABILITY_CATALOG,
  BATTLEFIELD,
  DEFAULT_BUDGET,
  ENCOUNTER_ID,
  GOBLIN_1,
  GOBLIN_2,
  makeCombatant,
  PLAYER_ID,
  RULES_VERSION,
} from './combat_fixtures';

export const HOUND_ID = 'emberwatch:ash_hound';
export const WARDEN_ID = 'emberwatch:ember_warden';
export const GUARD_ID = 'emberwatch:village_guard';
export const RITUAL_ID = 'emberwatch:ritual_brazier';
export const RITUAL_AFFORDANCE = 'extinguish_brazier';
export const EXIT_ZONE_ID = 'emberwatch:south_gate';

/** A basic_melee-shaped opportunity attack at reach 1. */
export const OPPORTUNITY_ABILITY: CombatAbilityDefinition = {
  abilityId: 'opportunity_strike',
  name: 'Opportunity Strike',
  kind: 'melee_attack',
  actionCost: 'reaction',
  attackBonus: 4,
  damageDice: '1d6',
  damageType: 'slashing',
  rangeCells: 1,
  requiresLineOfSight: false,
};

export const DEPTH_ABILITY_CATALOG: Record<string, CombatAbilityDefinition> = {
  ...ABILITY_CATALOG,
  // biome-ignore lint/style/useNamingConvention: authored content ids are snake_case
  opportunity_strike: OPPORTUNITY_ABILITY,
};

export const REACTION_REGISTRY: ReactionRegistry = {
  definitions: [
    {
      reactionId: 'reaction.opportunity_attack',
      triggerKind: 'opportunity_attack',
      abilityId: 'opportunity_strike',
      threatRangeCells: 1,
    },
  ],
};

export const makeDepthCombatants = (): CombatantState[] => [
  makeCombatant({
    combatantId: PLAYER_ID,
    name: 'Hero',
    team: 'player',
    position: { x: 0, y: 0 },
    hp: 30,
    maxHp: 30,
    armorClass: 12,
    attackBonus: 5,
    initiative: 14,
    abilityIds: ['basic_melee', 'opportunity_strike'],
  }),
  makeCombatant({
    combatantId: GUARD_ID,
    name: 'Village Guard',
    team: 'ally',
    position: { x: 0, y: 1 },
    hp: 18,
    maxHp: 18,
    armorClass: 13,
    attackBonus: 3,
    initiative: 9,
    abilityIds: ['basic_melee'],
  }),
  makeCombatant({
    combatantId: HOUND_ID,
    name: 'Ash Hound',
    team: 'enemy',
    position: { x: 2, y: 0 },
    hp: 12,
    maxHp: 12,
    armorClass: 13,
    attackBonus: 3,
    initiative: 11,
    abilityIds: ['basic_melee', 'opportunity_strike'],
  }),
  makeCombatant({
    combatantId: WARDEN_ID,
    name: 'Ember Warden',
    team: 'enemy',
    position: { x: 5, y: 5 },
    hp: 20,
    maxHp: 20,
    armorClass: 14,
    attackBonus: 4,
    initiative: 12,
    abilityIds: ['basic_melee', 'opportunity_strike'],
  }),
];

export const makeCombatantWithReaction = (
  overrides: Partial<CombatantState> & { combatantId: string },
): CombatantState =>
  makeCombatant({ budget: { ...DEFAULT_BUDGET(), reactionAvailable: true }, ...overrides });

export const BASE_MORALE_RULES: MoraleRules = {
  startingMorale: 60,
  breakThreshold: 30,
  triggers: [
    { triggerKind: 'leader_defeated', magnitude: 25 },
    { triggerKind: 'ally_removed', magnitude: 10 },
    { triggerKind: 'objective_failed', magnitude: 20 },
  ],
  responses: [
    { responseKind: 'retreat', exitZoneId: EXIT_ZONE_ID },
    { responseKind: 'surrender', exitZoneId: null },
  ],
  exitZones: [
    {
      zoneId: EXIT_ZONE_ID,
      cells: [{ x: 0, y: 7 }],
    },
  ],
  leaderIds: [WARDEN_ID],
};

export const EMPTY_MORALE_RULES: MoraleRules = {
  startingMorale: 100,
  breakThreshold: 0,
  triggers: [],
  responses: [],
  exitZones: [],
  leaderIds: [],
};

/** "Stop the ritual": an interaction before a declared round boundary. */
export const RITUAL_OBJECTIVE_RULES: ObjectiveRules = {
  definitions: [
    {
      objectiveId: 'objective.stop_ritual',
      kind: 'interact_before_deadline',
      required: true,
      hidden: false,
      rule: {
        kind: 'interact_before_deadline',
        objectId: RITUAL_ID,
        affordanceId: RITUAL_AFFORDANCE,
        deadlineRound: 3,
        requiredActorIds: [PLAYER_ID],
      },
    },
  ],
  protectedActorIds: [],
};

/** "Rout the hounds": a group-based, maintained objective. */
export const ROUT_OBJECTIVE_RULES: ObjectiveRules = {
  definitions: [
    {
      objectiveId: 'objective.rout_hounds',
      kind: 'defeat_or_rout',
      required: false,
      hidden: false,
      rule: {
        kind: 'defeat_or_rout',
        hostileIds: [HOUND_ID],
        routMoraleThreshold: 20,
      },
    },
  ],
  protectedActorIds: [],
};

export const createDepthInput = (
  overrides: {
    combatants?: CombatantState[];
    objectives?: { objectiveId: string; kind: string; status: string; progress: number }[];
    objectiveRules?: ObjectiveRules;
    moraleRules?: MoraleRules;
    reactionRegistry?: ReactionRegistry;
    seed?: number;
    encounterRunId?: string;
  } = {},
) => ({
  encounterId: ENCOUNTER_ID,
  rulesVersion: RULES_VERSION,
  seed: overrides.seed ?? 20260914,
  combatants: overrides.combatants ?? makeDepthCombatants(),
  abilityCatalog: DEPTH_ABILITY_CATALOG,
  battlefield: BATTLEFIELD,
  objectives: (overrides.objectives ?? []) as never,
  objectiveRules: overrides.objectiveRules,
  moraleRules: overrides.moraleRules,
  reactionRegistry: overrides.reactionRegistry,
  encounterRunId: overrides.encounterRunId,
});

export { GOBLIN_1, GOBLIN_2, PLAYER_ID };
