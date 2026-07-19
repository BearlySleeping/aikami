// packages/shared/schemas/src/lib/database/character.ts
import Type from 'typebox';
import { AppearanceSchema } from './appearance.ts';
import { DEFAULT_SAVING_THROWS, DEFAULT_SKILLS, SavingThrowSchema, SkillSchema } from './skills.ts';

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
export type AbilityScores = Type.Static<typeof AbilityScoresSchema>;

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

export type Race = Type.Static<typeof RaceSchema>;
// ── Class ───────────────────────────────────────────────────────────────

export const ClassSchema = Type.Optional(
  Type.String({ description: 'Character class (e.g., Wizard, Rogue, Fighter)' }),
);

export type Class = Type.Static<typeof ClassSchema>;
// ── Subclass ────────────────────────────────────────────────────────────

export const SubclassSchema = Type.Optional(
  Type.String({ description: 'Character subclass / specialization' }),
);

export type Subclass = Type.Static<typeof SubclassSchema>;
// ── Level ───────────────────────────────────────────────────────────────

export const LevelSchema = Type.Optional(
  Type.Integer({
    description: 'Character Level (integer between 1 and 20)',
    minimum: 1,
    maximum: 20,
  }),
);

export type Level = Type.Static<typeof LevelSchema>;
// ── Experience Points ───────────────────────────────────────────────────

export const ExperiencePointsSchema = Type.Number({
  description: 'Experience Points (non-negative integer)',
  default: 0,
});

export type ExperiencePoints = Type.Static<typeof ExperiencePointsSchema>;
// ── Hit Points ──────────────────────────────────────────────────────────

export const HitPointsSchema = Type.Integer({ description: 'Current Hit Points', default: 10 });

export type HitPoints = Type.Static<typeof HitPointsSchema>;
export const HitPointsMaxSchema = Type.Optional(
  Type.Integer({ description: 'Maximum Hit Points' }),
);

export type HitPointsMax = Type.Static<typeof HitPointsMaxSchema>;
export const TemporaryHitPointsSchema = Type.Integer({
  description: 'Temporary Hit Points',
  default: 0,
});

export type TemporaryHitPoints = Type.Static<typeof TemporaryHitPointsSchema>;
// ── Armor Class / Speed / Initiative ────────────────────────────────────

export const ArmorClassSchema = Type.Integer({ description: 'Armor Class', default: 10 });

export type ArmorClass = Type.Static<typeof ArmorClassSchema>;
export const SpeedSchema = Type.Integer({ description: 'Speed (ft)', default: 30 });

export type Speed = Type.Static<typeof SpeedSchema>;
export const InitiativeSchema = Type.Optional(Type.Integer({ description: 'Initiative modifier' }));

export type Initiative = Type.Static<typeof InitiativeSchema>;
// ── Proficiency Bonus ───────────────────────────────────────────────────

export const ProficiencyBonusSchema = Type.Optional(
  Type.Integer({ description: 'Proficiency bonus (derived from level)' }),
);

export type ProficiencyBonus = Type.Static<typeof ProficiencyBonusSchema>;
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

export type Proficiencies = Type.Static<typeof ProficienciesSchema>;
// ── Languages ───────────────────────────────────────────────────────────

export const LanguagesSchema = Type.Array(Type.String(), {
  description: 'Languages known',
  default: ['Common'],
});

export type Languages = Type.Static<typeof LanguagesSchema>;
// ── Equipment / Inventory ───────────────────────────────────────────────

export const EquipmentSchema = Type.Array(Type.String(), {
  description: 'Equipment',
  default: [],
});

export type Equipment = Type.Static<typeof EquipmentSchema>;
export const InventorySchema = Type.Array(Type.String(), {
  description: 'Inventory / carried items',
  default: [],
});

export type Inventory = Type.Static<typeof InventorySchema>;
// ── Personality / Ideals / Bonds / Flaws ────────────────────────────────

export const PersonalityTraitsSchema = Type.Optional(
  Type.String({ description: 'Personality Traits' }),
);

export type PersonalityTraits = Type.Static<typeof PersonalityTraitsSchema>;
export const IdealsSchema = Type.Optional(Type.String({ description: 'Ideals' }));

export type Ideals = Type.Static<typeof IdealsSchema>;
export const BondsSchema = Type.Optional(Type.String({ description: 'Bonds' }));

export type Bonds = Type.Static<typeof BondsSchema>;
export const FlawsSchema = Type.Optional(Type.String({ description: 'Flaws' }));

export type Flaws = Type.Static<typeof FlawsSchema>;
// ── Narrative Traits (Marinara-inspired) ─════════════════════════════════

export const NarrativeTraitsSchema = Type.Optional(
  Type.Object(
    {
      likes: Type.Array(Type.String(), {
        description: 'Things the character likes (e.g., Gold, Ancient Lore)',
        default: [],
      }),
      temptations: Type.Array(Type.String(), {
        description: 'Temptations that draw the character (e.g., Power, Revenge)',
        default: [],
      }),
      keys: Type.Array(Type.String(), {
        description: 'Plot hook keys (e.g., Lost Sister, The Crown of Aldren)',
        default: [],
      }),
    },
    { description: 'Narrative traits that influence AI behavior and plot hooks' },
  ),
);

export type NarrativeTraits = Type.Static<typeof NarrativeTraitsSchema>;
// ── Background ──────────────────────────────────────────────────────────

export const BackgroundSchema = Type.Optional(
  Type.String({ description: 'Character background story / origin' }),
);

export type Background = Type.Static<typeof BackgroundSchema>;
// ── Notes ───────────────────────────────────────────────────────────────

export const NotesSchema = Type.Optional(Type.String({ description: 'Additional Notes' }));

export type Notes = Type.Static<typeof NotesSchema>;
// ── Full Character Sheet (composed from sub-schemas) ───────────────────

export const BaseCharacterSheetSchema = Type.Object(
  {
    name: Type.String({ description: 'Character Name (Required, max 100 characters)' }),

    race: RaceSchema,
    class: ClassSchema,
    subclass: SubclassSchema,
    level: LevelSchema,
    experiencePoints: Type.Optional(ExperiencePointsSchema),

    abilityScores: Type.Optional(AbilityScoresSchema),

    hitPoints: Type.Optional(HitPointsSchema),
    hitPointsMax: HitPointsMaxSchema,
    temporaryHitPoints: Type.Optional(TemporaryHitPointsSchema),
    armorClass: Type.Optional(ArmorClassSchema),
    speed: Type.Optional(SpeedSchema),
    initiative: InitiativeSchema,

    proficiencyBonus: ProficiencyBonusSchema,

    savingThrows: Type.Optional(
      Type.Array(SavingThrowSchema, {
        description: 'Saving throw proficiencies',
        default: DEFAULT_SAVING_THROWS,
      }),
    ),

    skills: Type.Optional(
      Type.Array(SkillSchema, {
        description: 'Skill proficiencies',
        default: DEFAULT_SKILLS,
      }),
    ),

    alignment: AlignmentSchema,
    background: BackgroundSchema,

    proficiencies: Type.Optional(ProficienciesSchema),
    languages: Type.Optional(LanguagesSchema),

    equipment: Type.Optional(EquipmentSchema),
    inventory: Type.Optional(InventorySchema),

    personalityTraits: PersonalityTraitsSchema,
    ideals: IdealsSchema,
    bonds: BondsSchema,
    flaws: FlawsSchema,

    appearance: Type.Optional(AppearanceSchema),
    notes: NotesSchema,

    narrativeTraits: NarrativeTraitsSchema,

    // ── Class Progression (C-337) ──

    classId: Type.Optional(
      Type.String({ description: 'Class definition ID — "fighter", "wizard", "rogue", "cleric"' }),
    ),
    classFeatures: Type.Optional(
      Type.Array(
        Type.Object({
          featureId: Type.String({ minLength: 1 }),
          source: Type.Object({
            classId: Type.String({ minLength: 1 }),
            level: Type.Integer({ minimum: 1 }),
          }),
        }),
        { description: 'Features the character has unlocked' },
      ),
    ),
    hotbarSlots: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Active abilities currently slotted on the hotbar (feature IDs, max 6)',
      }),
    ),
    abilityUses: Type.Optional(
      Type.Record(Type.String(), Type.Integer({ minimum: 0 }), {
        description: 'Usage tracking for limited-use abilities (featureId → uses remaining)',
      }),
    ),
  },
  { description: 'D&D Character Sheet' },
);

export type BaseCharacterSheet = Type.Static<typeof BaseCharacterSheetSchema>;
