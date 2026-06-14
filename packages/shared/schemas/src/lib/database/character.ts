// packages/shared/schemas/src/lib/database/character.ts
import Type from 'typebox';
import { AppearanceSchema } from './appearance.ts';
import {
  type AbilityType,
  DEFAULT_SAVING_THROWS,
  DEFAULT_SKILLS,
  SavingThrowSchema,
  SkillSchema,
} from './skills.ts';

// ── Ability Scores ──────────────────────────────────────────────────────

export const AbilityScoresSchema = Type.Object(
  {
    strength: Type.Optional(
      Type.Integer({ description: 'Strength Score (integer between 8 and 18)' }),
    ),
    dexterity: Type.Optional(
      Type.Integer({ description: 'Dexterity Score (integer between 8 and 18)' }),
    ),
    constitution: Type.Optional(
      Type.Integer({ description: 'Constitution Score (integer between 8 and 18)' }),
    ),
    intelligence: Type.Optional(
      Type.Integer({ description: 'Intelligence Score (integer between 8 and 18)' }),
    ),
    wisdom: Type.Optional(Type.Integer({ description: 'Wisdom Score (integer between 8 and 18)' })),
    charisma: Type.Optional(
      Type.Integer({ description: 'Charisma Score (integer between 8 and 18)' }),
    ),
  },
  { description: 'Ability Scores' },
);

export type AbilityScoresData = Type.Static<typeof AbilityScoresSchema>;

// ── Alignment ──────────────────────────────────────────────────────────

export const ALIGNMENTS = [
  'Lawful Good',
  'Neutral Good',
  'Chaotic Good',
  'Lawful Neutral',
  'True Neutral',
  'Chaotic Neutral',
  'Lawful Evil',
  'Neutral Evil',
  'Chaotic Evil',
] as const;

export const AlignmentSchema = Type.Optional(
  Type.String({
    description:
      'Alignment (one of: Lawful Good, Neutral Good, Chaotic Good, Lawful Neutral, True Neutral, Chaotic Neutral, Lawful Evil, Neutral Evil, Chaotic Evil)',
  }),
);

export type Alignment = Type.Static<typeof AlignmentSchema>;

// ── Race ────────────────────────────────────────────────────────────────

export const RaceSchema = Type.Optional(
  Type.String({ description: 'Character race/species (e.g., Elf, Dwarf, Tiefling)' }),
);

// ── Class ───────────────────────────────────────────────────────────────

export const ClassSchema = Type.Optional(
  Type.String({ description: 'Character class (e.g., Wizard, Rogue, Fighter)' }),
);

// ── Subclass ────────────────────────────────────────────────────────────

export const SubclassSchema = Type.Optional(
  Type.String({ description: 'Character subclass / specialization' }),
);

// ── Level ───────────────────────────────────────────────────────────────

export const LevelSchema = Type.Optional(
  Type.Integer({
    description: 'Character Level (integer between 1 and 20)',
    minimum: 1,
    maximum: 20,
  }),
);

// ── Experience Points ───────────────────────────────────────────────────

export const ExperiencePointsSchema = Type.Number({
  description: 'Experience Points (non-negative integer)',
  default: 0,
});

// ── Hit Points ──────────────────────────────────────────────────────────

export const HitPointsSchema = Type.Integer({ description: 'Current Hit Points', default: 10 });

export const HitPointsMaxSchema = Type.Optional(
  Type.Integer({ description: 'Maximum Hit Points' }),
);

export const TemporaryHitPointsSchema = Type.Integer({
  description: 'Temporary Hit Points',
  default: 0,
});

// ── Armor Class / Speed / Initiative ────────────────────────────────────

export const ArmorClassSchema = Type.Integer({ description: 'Armor Class', default: 10 });

export const SpeedSchema = Type.Integer({ description: 'Speed (ft)', default: 30 });

export const InitiativeSchema = Type.Optional(Type.Integer({ description: 'Initiative modifier' }));

// ── Proficiency Bonus ───────────────────────────────────────────────────

export const ProficiencyBonusSchema = Type.Optional(
  Type.Integer({ description: 'Proficiency bonus (derived from level)' }),
);

// ── Saving Throws ───────────────────────────────────────────────────────

export type { SavingThrowData } from './skills.ts';
export { DEFAULT_SAVING_THROWS, SavingThrowSchema } from './skills.ts';

// ── Skills ──────────────────────────────────────────────────────────────

export type { SkillData } from './skills.ts';
export { DEFAULT_SKILLS, SkillSchema } from './skills.ts';

// ── Proficiencies ───────────────────────────────────────────────────────

export const ProficienciesSchema = Type.Array(Type.String(), {
  description: 'Proficiencies (weapons, armor, tools, etc.)',
  default: [],
});

// ── Languages ───────────────────────────────────────────────────────────

export const LanguagesSchema = Type.Array(Type.String(), {
  description: 'Languages known',
  default: ['Common'],
});

// ── Equipment / Inventory ───────────────────────────────────────────────

export const EquipmentSchema = Type.Array(Type.String(), {
  description: 'Equipment',
  default: [],
});

export const InventorySchema = Type.Array(Type.String(), {
  description: 'Inventory / carried items',
  default: [],
});

// ── Personality / Ideals / Bonds / Flaws ────────────────────────────────

export const PersonalityTraitsSchema = Type.Optional(
  Type.String({ description: 'Personality Traits' }),
);

export const IdealsSchema = Type.Optional(Type.String({ description: 'Ideals' }));

export const BondsSchema = Type.Optional(Type.String({ description: 'Bonds' }));

export const FlawsSchema = Type.Optional(Type.String({ description: 'Flaws' }));

// ── Background ──────────────────────────────────────────────────────────

export const BackgroundSchema = Type.Optional(
  Type.String({ description: 'Character background story / origin' }),
);

// ── Notes ───────────────────────────────────────────────────────────────

export const NotesSchema = Type.Optional(Type.String({ description: 'Additional Notes' }));

// ── Full Character Sheet (composed from sub-schemas) ───────────────────

export const BaseCharacterSheetSchema = Type.Object(
  {
    name: Type.String({ description: 'Character Name (Required, max 100 characters)' }),

    race: RaceSchema,
    class: ClassSchema,
    subclass: SubclassSchema,
    level: LevelSchema,
    experiencePoints: ExperiencePointsSchema,

    abilityScores: Type.Optional(AbilityScoresSchema),

    hitPoints: HitPointsSchema,
    hitPointsMax: HitPointsMaxSchema,
    temporaryHitPoints: TemporaryHitPointsSchema,
    armorClass: ArmorClassSchema,
    speed: SpeedSchema,
    initiative: InitiativeSchema,

    proficiencyBonus: ProficiencyBonusSchema,

    savingThrows: Type.Array(SavingThrowSchema, {
      description: 'Saving throw proficiencies',
      default: DEFAULT_SAVING_THROWS,
    }),

    skills: Type.Array(SkillSchema, {
      description: 'Skill proficiencies',
      default: DEFAULT_SKILLS,
    }),

    alignment: AlignmentSchema,
    background: BackgroundSchema,

    proficiencies: ProficienciesSchema,
    languages: LanguagesSchema,

    equipment: EquipmentSchema,
    inventory: InventorySchema,

    personalityTraits: PersonalityTraitsSchema,
    ideals: IdealsSchema,
    bonds: BondsSchema,
    flaws: FlawsSchema,

    appearance: Type.Optional(AppearanceSchema),
    notes: NotesSchema,
  },
  { description: 'D&D Character Sheet' },
);
