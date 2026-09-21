// packages/shared/constants/src/lib/game/combat_abilities.ts
// biome-ignore-all lint/style/useNamingConvention: authored ability ids are snake_case content ids, not camelCase locals
//
// Production `CombatAbilityDefinition` catalog (Combat-04).
//
// The catalog is DERIVED from `CLASS_REGISTRY` rather than authored a second
// time: ids and display names come from the class features, so the catalog and
// the class registry can never silently drift (`UNMAPPED_CLASS_FEATURE_IDS`
// pins the features we deliberately do not map). Only the combat-relevant
// fields a class feature does not carry — kind, damage type, range — are
// declared here, per feature, and every declared value is a choice we can
// defend from the feature's own description.
//
// Nothing is invented: an ability whose class feature declares no damage dice
// is a `utility` ability (it still costs its action), and `attackBonus` is `0`
// for every class feature because the registry authors no attack bonus.
//
// Contract: C-516 AC-3

import type {
  CombatAbilityActivation,
  CombatAbilityDefinition,
  CombatAbilityKind,
} from '@aikami/types';
import { CLASS_REGISTRY } from './classes.ts';

// ---------------------------------------------------------------------------
// Basic attack
// ---------------------------------------------------------------------------

/** The unarmed/basic attack every combatant always has. */
export const BASIC_MELEE_ABILITY_ID = 'basic_melee';

/**
 * Combat-relevant fields a {@link ClassFeature} does not declare.
 *
 * `attackBonus` is intentionally absent — the registry authors no per-ability
 * attack bonus, so the catalog contributes none (0).
 */
type CombatAbilityMapping = {
  kind: CombatAbilityKind;
  /** Damage dice; only set when the feature's own effect dice are damage. */
  damageDice?: string;
  damageType?: CombatAbilityDefinition['damageType'];
  rangeCells: number;
  requiresLineOfSight: boolean;
  /**
   * Activation context. Absent means `ordinary`.
   * Contract: C-532 AC-3.
   */
  activation?: CombatAbilityActivation;
  /**
   * Whether the kernel implements the feature's declared effect. Active class
   * features whose combat semantics v2 does not model are `false`: they remain
   * visible/catalogued but a use is rejected with `unsupportedInV2` and spends
   * nothing. Contract: C-516 AC-3.
   */
  supported?: boolean;
};

/**
 * Per-feature combat mapping, keyed by `ClassFeature.id`.
 *
 * Passive features are absent by design — they have no activation, so they can
 * never be a `CombatCommand`. They are listed in
 * {@link UNMAPPED_CLASS_FEATURE_IDS} instead.
 */
const CLASS_FEATURE_COMBAT_MAPPINGS: Record<string, CombatAbilityMapping> = {
  // Fighter — both features are resource-gated self-buffs. v2 models no healing
  // or resource pools, so a use is honestly unavailable rather than a no-op.
  fighter_second_wind: {
    kind: 'utility',
    rangeCells: 0,
    requiresLineOfSight: false,
    supported: false,
  },
  fighter_action_surge: {
    kind: 'utility',
    rangeCells: 0,
    requiresLineOfSight: false,
    supported: false,
  },

  // Wizard — Magic Missile and Fireball are declared spells and always hit, so
  // they carry no line-of-sight requirement beyond the caster's range.
  wizard_arcane_recovery: {
    kind: 'utility',
    rangeCells: 0,
    requiresLineOfSight: false,
    supported: false,
  },
  wizard_magic_missile: {
    kind: 'ranged_attack',
    damageDice: '1d4+1',
    damageType: 'force',
    rangeCells: 8,
    requiresLineOfSight: true,
  },
  wizard_fireball: {
    kind: 'ranged_attack',
    damageDice: '8d6',
    damageType: 'fire',
    rangeCells: 8,
    requiresLineOfSight: false,
  },
  wizard_counterspell: {
    kind: 'utility',
    rangeCells: 6,
    requiresLineOfSight: true,
    supported: false,
  },

  // Rogue — all three are situational utility with no v2 effect model.
  rogue_cunning_action: {
    kind: 'utility',
    rangeCells: 0,
    requiresLineOfSight: false,
    supported: false,
  },
  rogue_steady_aim: {
    kind: 'utility',
    rangeCells: 0,
    requiresLineOfSight: false,
    supported: false,
  },
  rogue_uncanny_dodge: {
    kind: 'utility',
    rangeCells: 0,
    requiresLineOfSight: false,
    supported: false,
  },

  // Cleric — the healing words and Channel Divinity need a healing/resource
  // model v2 does not have yet; they are declared unavailable rather than
  // pretending a heal is a harmless utility action.
  cleric_healing_word: {
    kind: 'utility',
    rangeCells: 6,
    requiresLineOfSight: true,
    supported: false,
  },
  cleric_sacred_flame: {
    kind: 'ranged_attack',
    damageDice: '1d8',
    damageType: 'radiant',
    rangeCells: 6,
    requiresLineOfSight: false,
  },
  cleric_channel_divinity: {
    kind: 'utility',
    rangeCells: 6,
    requiresLineOfSight: true,
    supported: false,
  },
  cleric_spiritual_weapon: {
    kind: 'ranged_attack',
    damageDice: '1d8',
    damageType: 'force',
    rangeCells: 6,
    requiresLineOfSight: false,
  },
  cleric_mass_healing_word: {
    kind: 'utility',
    rangeCells: 6,
    requiresLineOfSight: true,
    supported: false,
  },
};

/**
 * Class features deliberately NOT in the catalog.
 *
 * Every entry is `kind: 'passive'` (nothing to activate) or a feature whose
 * combat semantics v2 does not model yet. The C-516 AC-3 test asserts that
 * every active feature is either mapped or listed here, so adding a feature to
 * `CLASS_REGISTRY` without deciding its combat behaviour fails the suite.
 */
export const UNMAPPED_CLASS_FEATURE_IDS: readonly string[] = [
  // Passive features — no activation, never a command.
  'fighter_fighting_style',
  'fighter_improved_critical',
  'fighter_ability_score_improvement',
  'fighter_extra_attack',
  'wizard_sculpt_spells',
  'wizard_ability_score_improvement',
  'rogue_sneak_attack',
  'rogue_expertise',
  'rogue_ability_score_improvement',
  'cleric_ability_score_improvement',
];

// ---------------------------------------------------------------------------
// Catalog construction
// ---------------------------------------------------------------------------

/** Class features of a class definition, flattened out of the level map. */
const classFeatures = (classId: string) => {
  const definition = CLASS_REGISTRY[classId as keyof typeof CLASS_REGISTRY];
  if (definition === undefined) {
    return [];
  }
  return Object.values(definition.features).flat();
};

/**
 * Maps a `ClassFeature`'s activation cost onto a kernel action cost.
 *
 * `bonus_action` is the 5e bonus action, which C-514 models as the quick
 * action; `free` and `reaction` are already kernel literals.
 */
const toActionCost = (
  cost: 'action' | 'bonus_action' | 'reaction' | 'free',
): CombatAbilityDefinition['actionCost'] => {
  if (cost === 'bonus_action') {
    return 'quick';
  }
  return cost;
};

const buildClassFeatureAbility = (options: {
  featureId: string;
  mapping: CombatAbilityMapping;
}): CombatAbilityDefinition | null => {
  const { featureId, mapping } = options;
  for (const classId of Object.keys(CLASS_REGISTRY)) {
    const feature = classFeatures(classId).find((candidate) => candidate.id === featureId);
    if (feature === undefined) {
      continue;
    }
    const activation = feature.activation;
    if (activation === undefined) {
      return null;
    }
    return {
      abilityId: feature.id,
      name: feature.name,
      kind: mapping.kind,
      actionCost: toActionCost(activation.cost),
      attackBonus: 0,
      damageDice: mapping.damageDice ?? null,
      damageType: mapping.damageType ?? null,
      rangeCells: mapping.rangeCells,
      requiresLineOfSight: mapping.requiresLineOfSight,
      ...(mapping.activation === undefined ? {} : { activation: mapping.activation }),
      ...(mapping.supported === undefined ? {} : { supported: mapping.supported }),
    };
  }
  return null;
};

/** The basic attack — always available, authored here rather than in a class. */
export const BASIC_MELEE_ABILITY: CombatAbilityDefinition = {
  abilityId: BASIC_MELEE_ABILITY_ID,
  name: 'Basic Melee Attack',
  kind: 'melee_attack',
  actionCost: 'action',
  attackBonus: 0,
  damageDice: '1d6',
  damageType: 'slashing',
  rangeCells: 1,
  requiresLineOfSight: false,
  activation: 'ordinary',
  supported: true,
  maxTargets: 1,
};

/**
 * The opportunity attack — the one registered Combat-08 reaction.
 *
 * It is an ordinary melee attack resolved through the ordinary ability and
 * targeting rules: the reaction layer supplies only the trigger, the ordering
 * and the reaction budget. `actionCost: 'reaction'` is what makes the kernel
 * consume the reactor's reaction instead of its action.
 *
 * Authored here, like {@link BASIC_MELEE_ABILITY}, because it belongs to no
 * class.
 *
 * Contract: C-532 AC-3
 */
export const OPPORTUNITY_ATTACK_ABILITY_ID = 'opportunity_strike';

export const OPPORTUNITY_ATTACK_ABILITY: CombatAbilityDefinition = {
  abilityId: OPPORTUNITY_ATTACK_ABILITY_ID,
  name: 'Opportunity Strike',
  kind: 'melee_attack',
  actionCost: 'reaction',
  attackBonus: 0,
  damageDice: '1d6',
  damageType: 'slashing',
  rangeCells: 1,
  requiresLineOfSight: false,
  activation: 'reaction',
  supported: true,
  maxTargets: 1,
};

/**
 * Ability ids granted to each class, keyed by class id.
 *
 * A combatant seeded from a class gets `basic_melee` plus that class's mapped
 * abilities — never the whole catalog, so a rogue cannot cast Fireball.
 */
export const COMBAT_ABILITY_IDS_BY_CLASS: Record<string, readonly string[]> = Object.fromEntries(
  Object.keys(CLASS_REGISTRY).map((classId) => [
    classId,
    [
      BASIC_MELEE_ABILITY_ID,
      OPPORTUNITY_ATTACK_ABILITY_ID,
      ...classFeatures(classId)
        .filter((feature) => CLASS_FEATURE_COMBAT_MAPPINGS[feature.id] !== undefined)
        .map((feature) => feature.id),
    ],
  ]),
);

const classFeatureAbilities: CombatAbilityDefinition[] = Object.entries(
  CLASS_FEATURE_COMBAT_MAPPINGS,
)
  .map(([featureId, mapping]) => buildClassFeatureAbility({ featureId, mapping }))
  .filter((ability): ability is CombatAbilityDefinition => ability !== null);

/**
 * The production catalog: `basic_melee` plus every faithfully mappable class
 * ability, keyed by `abilityId`.
 */
export const BASIC_COMBAT_ABILITIES: Record<string, CombatAbilityDefinition> = Object.fromEntries(
  [BASIC_MELEE_ABILITY, OPPORTUNITY_ATTACK_ABILITY, ...classFeatureAbilities].map((ability) => [
    ability.abilityId,
    ability,
  ]),
);

/**
 * Catalog lookup that never throws — an unknown ability id yields `undefined`
 * so a command for it becomes a typed `abilityUnknown` rejection in the kernel.
 */
export const getCombatAbility = (abilityId: string): CombatAbilityDefinition | undefined =>
  BASIC_COMBAT_ABILITIES[abilityId];

/**
 * Resolves the ability ids a combatant is entitled to for its class list.
 *
 * An unknown or empty class list still yields `basic_melee`, so every
 * combatant can always act.
 */
export const resolveCombatAbilityIds = (classIds: readonly string[]): string[] => {
  // Every combatant can always attack and can always take its opportunity
  // attack; class abilities are additive. Contract: C-532 AC-3.
  const ids = new Set<string>([BASIC_MELEE_ABILITY_ID, OPPORTUNITY_ATTACK_ABILITY_ID]);
  for (const classId of classIds) {
    for (const abilityId of COMBAT_ABILITY_IDS_BY_CLASS[classId] ?? []) {
      ids.add(abilityId);
    }
  }
  return [...ids];
};
