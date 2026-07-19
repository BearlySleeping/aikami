// packages/shared/schemas/src/lib/game/class_definition.ts
//
// TypeBox schemas for class definitions, class features, and ability activations.
// These define the data shapes for content-pack class/ability registries and
// character sheet class-related fields.
//
// Contract: C-337 Complete Character Progression, Classes, Abilities, Skills, and Spells

import Type, { type Static } from 'typebox';
import { AbilityTypeSchema } from '../database/skills.ts';

// ---------------------------------------------------------------------------
// Ability Activation — how an active ability is triggered
// ---------------------------------------------------------------------------

export const AbilityActivationSchema = Type.Object(
  {
    /** What the activation costs in the action economy */
    cost: Type.Union([
      Type.Literal('action'),
      Type.Literal('bonus_action'),
      Type.Literal('reaction'),
      Type.Literal('free'),
    ]),
    /** Usage limit period */
    usageLimit: Type.Union([
      Type.Literal('per_rest'),
      Type.Literal('per_encounter'),
      Type.Literal('per_day'),
      Type.Literal('unlimited'),
    ]),
    /** How many uses per the usageLimit period */
    maxUses: Type.Integer({ minimum: 1, description: 'Max uses per period' }),
    /** Optional: target required */
    target: Type.Optional(
      Type.Union([
        Type.Literal('self'),
        Type.Literal('single_enemy'),
        Type.Literal('single_ally'),
        Type.Literal('all_enemies'),
        Type.Literal('area'),
      ]),
    ),
    /** Optional: dice expression for the effect (e.g. "1d8+2") */
    effectDice: Type.Optional(
      Type.String({ pattern: '^\\d+d\\d+(\\+\\d+)?$', description: 'Effect dice e.g. "1d8+2"' }),
    ),
    /** Optional: what ability score this scales off */
    scalingStat: Type.Optional(AbilityTypeSchema),
  },
  { additionalProperties: false, description: 'How an active ability is triggered' },
);

export type AbilityActivation = Static<typeof AbilityActivationSchema>;

// ---------------------------------------------------------------------------
// Class Feature — a single feature granted at a specific level
// ---------------------------------------------------------------------------

export const ClassFeatureSchema = Type.Object(
  {
    /** Unique feature ID — "fighter_second_wind", "rogue_sneak_attack" */
    id: Type.String({
      minLength: 1,
      pattern: '^[a-z]+_[a-z_]+$',
      description: 'Unique feature ID (classname_featurename)',
    }),
    /** Display name */
    name: Type.String({ minLength: 1, description: 'Display name' }),
    /** Player-facing description of what this does */
    description: Type.String({ minLength: 1, description: 'Player-facing description' }),
    /** The class level at which this feature is granted */
    level: Type.Integer({ minimum: 1, maximum: 20, description: 'Class level this is granted at' }),
    /** Whether this feature is an active ability (goes on hotbar) vs passive */
    kind: Type.Union([Type.Literal('active'), Type.Literal('passive')]),
    /** For active abilities: how to activate it */
    activation: Type.Optional(AbilityActivationSchema),
  },
  { additionalProperties: false },
);

export type ClassFeature = Static<typeof ClassFeatureSchema>;

// ---------------------------------------------------------------------------
// Subclass Definition
// ---------------------------------------------------------------------------

export const SubclassDefinitionSchema = Type.Object(
  {
    /** Unique subclass ID — "champion", "evoker" */
    id: Type.String({ minLength: 1, description: 'Unique subclass ID' }),
    /** Display name */
    name: Type.String({ minLength: 1, description: 'Display name' }),
    /** Flavor description */
    description: Type.String({ minLength: 1, description: 'Flavor description' }),
    /** Features granted at each level, keyed by level number string */
    features: Type.Record(Type.String(), Type.Array(ClassFeatureSchema), {
      description: 'Features keyed by class level',
    }),
  },
  { additionalProperties: false },
);

export type SubclassDefinition = Static<typeof SubclassDefinitionSchema>;

// ---------------------------------------------------------------------------
// Class Definition — full class data shape
// ---------------------------------------------------------------------------

export const ClassDefinitionSchema = Type.Object(
  {
    /** Unique class ID — "fighter", "wizard", "rogue", "cleric" */
    id: Type.String({ minLength: 1, description: 'Unique class ID' }),
    /** Display name */
    name: Type.String({ minLength: 1, description: 'Display name' }),
    /** Flavor description */
    description: Type.String({ minLength: 1, description: 'Flavor description' }),
    /** Hit die for HP rolls on level-up (e.g. "d10") */
    hitDie: Type.String({ pattern: '^d\\d+$', description: 'Hit die e.g. "d10"' }),
    /** Average HP per level after first (rounded up) */
    hpPerLevel: Type.Integer({ minimum: 1, description: 'Average HP per level after first' }),
    /** Primary ability score for class features */
    primaryAbility: AbilityTypeSchema,
    /** Saving throw proficiencies granted at level 1 */
    savingThrowProficiencies: Type.Array(AbilityTypeSchema, {
      minItems: 2,
      maxItems: 2,
      description: 'Two saving throw proficiencies',
    }),
    /** Skill proficiency choices available at level 1 */
    skillProficiencyChoices: Type.Array(Type.String(), {
      minItems: 1,
      description: 'Skill proficiency choices',
    }),
    /** Number of skills to pick from the choices */
    skillProficiencyCount: Type.Integer({
      minimum: 1,
      description: 'Number of skills to pick',
    }),
    /** Weapon proficiencies */
    weaponProficiencies: Type.Array(Type.String(), { description: 'Weapon proficiencies' }),
    /** Armor proficiencies */
    armorProficiencies: Type.Array(Type.String(), { description: 'Armor proficiencies' }),
    /** Features granted at each level, keyed by level number string */
    features: Type.Record(Type.String(), Type.Array(ClassFeatureSchema), {
      description: 'Features keyed by class level',
    }),
    /** Subclass choice level (0 = no subclass) */
    subclassChoiceLevel: Type.Integer({ minimum: 0, description: 'Subclass choice level' }),
    /** Available subclasses */
    subclasses: Type.Array(SubclassDefinitionSchema, { description: 'Available subclasses' }),
  },
  { additionalProperties: false },
);

export type ClassDefinition = Static<typeof ClassDefinitionSchema>;

// ---------------------------------------------------------------------------
// Class Registry — content-pack style record of class definitions
// ---------------------------------------------------------------------------

export const ClassRegistrySchema = Type.Record(Type.String(), ClassDefinitionSchema, {
  description: 'Class definitions keyed by class ID',
});

export type ClassRegistry = Static<typeof ClassRegistrySchema>;

// ---------------------------------------------------------------------------
// Ability Registry — record of ability definitions keyed by feature ID
// ---------------------------------------------------------------------------

export const AbilityRegistrySchema = Type.Record(Type.String(), ClassFeatureSchema, {
  description: 'Ability definitions keyed by feature ID',
});

export type AbilityRegistry = Static<typeof AbilityRegistrySchema>;

// ---------------------------------------------------------------------------
// XP Thresholds — level-up XP requirements
// ---------------------------------------------------------------------------

export const XpThresholdsSchema = Type.Record(Type.String(), Type.Integer({ minimum: 0 }), {
  description: 'XP thresholds per level (key is level number string)',
});

export type XpThresholds = Static<typeof XpThresholdsSchema>;
