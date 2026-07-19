// packages/shared/constants/src/lib/game/classes.ts
//
// Starter class definitions for Fighter, Wizard, Rogue, Cleric (levels 1–5).
// Classes are defined as content-pack data and follow the ClassDefinition schema.
//
// Contract: C-337 Complete Character Progression, Classes, Abilities, Skills, and Spells

import type { ClassDefinition, XpThresholds } from '@aikami/types';

// ---------------------------------------------------------------------------
// XP Thresholds — XP required to reach each level
// ---------------------------------------------------------------------------

export const XP_THRESHOLDS: XpThresholds = {
  '1': 0,
  '2': 300,
  '3': 900,
  '4': 2700,
  '5': 6500,
};

// ---------------------------------------------------------------------------
// Fighter — martial powerhouse with Action Surge and Second Wind
// ---------------------------------------------------------------------------

export const FIGHTER: ClassDefinition = {
  id: 'fighter',
  name: 'Fighter',
  description:
    'A master of martial combat, skilled with a variety of weapons and armor. Fighters excel at sustained combat through their superior technique and endurance.',
  hitDie: 'd10',
  hpPerLevel: 6,
  primaryAbility: 'strength',
  savingThrowProficiencies: ['strength', 'constitution'],
  skillProficiencyChoices: [
    'Acrobatics',
    'Animal Handling',
    'Athletics',
    'History',
    'Insight',
    'Intimidation',
    'Perception',
    'Survival',
  ],
  skillProficiencyCount: 2,
  weaponProficiencies: ['simple', 'martial'],
  armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
  features: {
    '1': [
      {
        id: 'fighter_fighting_style',
        name: 'Fighting Style',
        description:
          'You adopt a particular style of fighting as your specialty. Choose one: Great Weapon Fighting (reroll 1s and 2s on damage dice with two-handed weapons).',
        level: 1,
        kind: 'passive',
      },
      {
        id: 'fighter_second_wind',
        name: 'Second Wind',
        description:
          'You have a limited well of stamina that you can draw on to protect yourself from harm. On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level.',
        level: 1,
        kind: 'active',
        activation: {
          cost: 'bonus_action',
          usageLimit: 'per_rest',
          maxUses: 1,
          target: 'self',
          effectDice: '1d10',
        },
      },
    ],
    '2': [
      {
        id: 'fighter_action_surge',
        name: 'Action Surge',
        description:
          'Starting at 2nd level, you can push yourself beyond your normal limits for a moment. On your turn, you can take one additional action.',
        level: 2,
        kind: 'active',
        activation: {
          cost: 'free',
          usageLimit: 'per_rest',
          maxUses: 1,
          target: 'self',
        },
      },
    ],
    '3': [
      {
        id: 'fighter_improved_critical',
        name: 'Improved Critical',
        description: 'Your weapon attacks score a critical hit on a roll of 19 or 20.',
        level: 3,
        kind: 'passive',
      },
    ],
    '4': [
      {
        id: 'fighter_ability_score_improvement',
        name: 'Ability Score Improvement',
        description:
          'You can increase one ability score of your choice by 2, or two ability scores by 1 each.',
        level: 4,
        kind: 'passive',
      },
    ],
    '5': [
      {
        id: 'fighter_extra_attack',
        name: 'Extra Attack',
        description:
          'You can attack twice, instead of once, whenever you take the Attack action on your turn.',
        level: 5,
        kind: 'passive',
      },
    ],
  },
  subclassChoiceLevel: 3,
  subclasses: [
    {
      id: 'champion',
      name: 'Champion',
      description:
        'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection.',
      features: {},
    },
  ],
};

// ---------------------------------------------------------------------------
// Wizard — arcane spellcaster with spell recovery and sculpt spells
// ---------------------------------------------------------------------------

export const WIZARD: ClassDefinition = {
  id: 'wizard',
  name: 'Wizard',
  description:
    'A scholarly magic-user capable of manipulating the structures of reality. Wizards draw on a comprehensive understanding of arcane theory.',
  hitDie: 'd6',
  hpPerLevel: 4,
  primaryAbility: 'intelligence',
  savingThrowProficiencies: ['intelligence', 'wisdom'],
  skillProficiencyChoices: [
    'Arcana',
    'History',
    'Insight',
    'Investigation',
    'Medicine',
    'Religion',
  ],
  skillProficiencyCount: 2,
  weaponProficiencies: ['daggers', 'darts', 'slings', 'quarterstaffs', 'light_crossbows'],
  armorProficiencies: [],
  features: {
    '1': [
      {
        id: 'wizard_arcane_recovery',
        name: 'Arcane Recovery',
        description:
          'You have learned to regain some of your magical energy by studying your spellbook. Once per day when you finish a short rest, you can recover expended spell energy.',
        level: 1,
        kind: 'active',
        activation: {
          cost: 'free',
          usageLimit: 'per_day',
          maxUses: 1,
          target: 'self',
        },
      },
      {
        id: 'wizard_magic_missile',
        name: 'Magic Missile',
        description:
          'You create three glowing darts of magical force. Each dart hits a creature of your choice that you can see, dealing 1d4+1 force damage each.',
        level: 1,
        kind: 'active',
        activation: {
          cost: 'action',
          usageLimit: 'per_rest',
          maxUses: 3,
          target: 'single_enemy',
          effectDice: '1d4+1',
          scalingStat: 'intelligence',
        },
      },
    ],
    '2': [
      {
        id: 'wizard_sculpt_spells',
        name: 'Sculpt Spells',
        description:
          'You can create pockets of relative safety within the effects of your evocation spells, protecting allies from harm.',
        level: 2,
        kind: 'passive',
      },
    ],
    '3': [
      {
        id: 'wizard_fireball',
        name: 'Fireball',
        description:
          'A bright streak flashes from your pointing finger to a point you choose, then blossoms with a low roar into an explosion of flame. Each creature in a 20-foot-radius sphere takes 8d6 fire damage.',
        level: 3,
        kind: 'active',
        activation: {
          cost: 'action',
          usageLimit: 'per_rest',
          maxUses: 1,
          target: 'area',
          effectDice: '8d6',
          scalingStat: 'intelligence',
        },
      },
    ],
    '4': [
      {
        id: 'wizard_ability_score_improvement',
        name: 'Ability Score Improvement',
        description:
          'You can increase one ability score of your choice by 2, or two ability scores by 1 each.',
        level: 4,
        kind: 'passive',
      },
    ],
    '5': [
      {
        id: 'wizard_counterspell',
        name: 'Counterspell',
        description:
          'You attempt to interrupt a creature in the process of casting a spell. If the creature is casting a spell of 3rd level or lower, its spell fails and has no effect.',
        level: 5,
        kind: 'active',
        activation: {
          cost: 'reaction',
          usageLimit: 'per_rest',
          maxUses: 2,
          target: 'single_enemy',
          scalingStat: 'intelligence',
        },
      },
    ],
  },
  subclassChoiceLevel: 2,
  subclasses: [
    {
      id: 'evoker',
      name: 'Evoker',
      description:
        'Focused on the study of powerful elemental spells that harness raw energy in its most destructive forms.',
      features: {},
    },
  ],
};

// ---------------------------------------------------------------------------
// Rogue — stealth striker with Sneak Attack and Cunning Action
// ---------------------------------------------------------------------------

export const ROGUE: ClassDefinition = {
  id: 'rogue',
  name: 'Rogue',
  description:
    'A scoundrel who uses stealth and trickery to overcome obstacles and enemies. Rogues excel at striking from the shadows and avoiding direct confrontation.',
  hitDie: 'd8',
  hpPerLevel: 5,
  primaryAbility: 'dexterity',
  savingThrowProficiencies: ['dexterity', 'intelligence'],
  skillProficiencyChoices: [
    'Acrobatics',
    'Athletics',
    'Deception',
    'Insight',
    'Intimidation',
    'Investigation',
    'Perception',
    'Performance',
    'Persuasion',
    'Sleight of Hand',
    'Stealth',
  ],
  skillProficiencyCount: 4,
  weaponProficiencies: ['simple', 'hand_crossbows', 'longswords', 'rapiers', 'shortswords'],
  armorProficiencies: ['light'],
  features: {
    '1': [
      {
        id: 'rogue_sneak_attack',
        name: 'Sneak Attack',
        description:
          'Once per turn, you can deal an extra 1d6 damage to one creature you hit with an attack if you have advantage on the attack roll. The attack must use a finesse or ranged weapon.',
        level: 1,
        kind: 'passive',
      },
      {
        id: 'rogue_expertise',
        name: 'Expertise',
        description:
          'Choose two of your skill proficiencies. Your proficiency bonus is doubled for any ability check you make that uses either of the chosen proficiencies.',
        level: 1,
        kind: 'passive',
      },
    ],
    '2': [
      {
        id: 'rogue_cunning_action',
        name: 'Cunning Action',
        description:
          'Your quick thinking and agility allow you to move and act quickly. You can take a bonus action on each of your turns in combat to Dash, Disengage, or Hide.',
        level: 2,
        kind: 'active',
        activation: {
          cost: 'bonus_action',
          usageLimit: 'unlimited',
          maxUses: 1,
          target: 'self',
        },
      },
    ],
    '3': [
      {
        id: 'rogue_steady_aim',
        name: 'Steady Aim',
        description:
          'As a bonus action, you give yourself advantage on your next attack roll on the current turn. You can use this only if you have not moved during this turn.',
        level: 3,
        kind: 'active',
        activation: {
          cost: 'bonus_action',
          usageLimit: 'unlimited',
          maxUses: 1,
          target: 'self',
        },
      },
    ],
    '4': [
      {
        id: 'rogue_ability_score_improvement',
        name: 'Ability Score Improvement',
        description:
          'You can increase one ability score of your choice by 2, or two ability scores by 1 each.',
        level: 4,
        kind: 'passive',
      },
    ],
    '5': [
      {
        id: 'rogue_uncanny_dodge',
        name: 'Uncanny Dodge',
        description:
          'When an attacker that you can see hits you with an attack, you can use your reaction to halve the damage.',
        level: 5,
        kind: 'active',
        activation: {
          cost: 'reaction',
          usageLimit: 'unlimited',
          maxUses: 1,
          target: 'self',
        },
      },
    ],
  },
  subclassChoiceLevel: 3,
  subclasses: [
    {
      id: 'thief',
      name: 'Thief',
      description:
        'A nimble infiltrator who excels at burglary, pickpocketing, and other feats of dexterity.',
      features: {},
    },
  ],
};

// ---------------------------------------------------------------------------
// Cleric — divine healer with Turn Undead and Channel Divinity
// ---------------------------------------------------------------------------

export const CLERIC: ClassDefinition = {
  id: 'cleric',
  name: 'Cleric',
  description:
    'A priestly champion who wields divine magic in service of a higher power. Clerics are versatile spellcasters who can heal, protect, and smite.',
  hitDie: 'd8',
  hpPerLevel: 5,
  primaryAbility: 'wisdom',
  savingThrowProficiencies: ['wisdom', 'charisma'],
  skillProficiencyChoices: ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion'],
  skillProficiencyCount: 2,
  weaponProficiencies: ['simple'],
  armorProficiencies: ['light', 'medium', 'shields'],
  features: {
    '1': [
      {
        id: 'cleric_healing_word',
        name: 'Healing Word',
        description:
          'A creature of your choice that you can see regains hit points equal to 1d4 + your spellcasting ability modifier. You can cast this spell once per rest.',
        level: 1,
        kind: 'active',
        activation: {
          cost: 'bonus_action',
          usageLimit: 'per_rest',
          maxUses: 3,
          target: 'single_ally',
          effectDice: '1d4',
          scalingStat: 'wisdom',
        },
      },
      {
        id: 'cleric_sacred_flame',
        name: 'Sacred Flame',
        description:
          'Flame-like radiance descends on a creature that you can see. The target must succeed on a Dexterity saving throw or take 1d8 radiant damage.',
        level: 1,
        kind: 'active',
        activation: {
          cost: 'action',
          usageLimit: 'unlimited',
          maxUses: 1,
          target: 'single_enemy',
          effectDice: '1d8',
          scalingStat: 'wisdom',
        },
      },
    ],
    '2': [
      {
        id: 'cleric_channel_divinity',
        name: 'Channel Divinity: Turn Undead',
        description:
          'As an action, you present your holy symbol and speak a prayer censuring the undead. Each undead that can see or hear you must make a Wisdom saving throw or be turned for 1 minute.',
        level: 2,
        kind: 'active',
        activation: {
          cost: 'action',
          usageLimit: 'per_rest',
          maxUses: 1,
          target: 'all_enemies',
          scalingStat: 'wisdom',
        },
      },
    ],
    '3': [
      {
        id: 'cleric_spiritual_weapon',
        name: 'Spiritual Weapon',
        description:
          'You create a floating, spectral weapon that attacks your enemies. As a bonus action, you can move the weapon up to 20 feet and repeat the attack against a creature within 5 feet.',
        level: 3,
        kind: 'active',
        activation: {
          cost: 'bonus_action',
          usageLimit: 'per_rest',
          maxUses: 1,
          target: 'single_enemy',
          effectDice: '1d8',
          scalingStat: 'wisdom',
        },
      },
    ],
    '4': [
      {
        id: 'cleric_ability_score_improvement',
        name: 'Ability Score Improvement',
        description:
          'You can increase one ability score of your choice by 2, or two ability scores by 1 each.',
        level: 4,
        kind: 'passive',
      },
    ],
    '5': [
      {
        id: 'cleric_mass_healing_word',
        name: 'Mass Healing Word',
        description:
          'As a bonus action, you call out words of restoration. Up to three creatures of your choice that you can see regain hit points equal to 1d4 + your spellcasting ability modifier.',
        level: 5,
        kind: 'active',
        activation: {
          cost: 'bonus_action',
          usageLimit: 'per_rest',
          maxUses: 1,
          target: 'single_ally',
          effectDice: '1d4',
          scalingStat: 'wisdom',
        },
      },
    ],
  },
  subclassChoiceLevel: 1,
  subclasses: [
    {
      id: 'life',
      name: 'Life Domain',
      description:
        'The Life domain focuses on the vibrant positive energy that sustains all life. Gods of life promote vitality and health.',
      features: {},
    },
  ],
};

// ---------------------------------------------------------------------------
// Aggregate constants
// ---------------------------------------------------------------------------

/** All 4 starter classes as an ordered tuple. */
export const STARTER_CLASSES = [FIGHTER, WIZARD, ROGUE, CLERIC] as const;

/** Registry keyed by class ID for fast lookup. */
export const CLASS_REGISTRY = {
  fighter: FIGHTER,
  wizard: WIZARD,
  rogue: ROGUE,
  cleric: CLERIC,
} as const satisfies Record<string, ClassDefinition>;

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/** Case-insensitive map from legacy class name string to class ID. */
export const LEGACY_CLASS_NAME_TO_ID: Record<string, string> = {
  fighter: 'fighter',
  wizard: 'wizard',
  rogue: 'rogue',
  cleric: 'cleric',
};
