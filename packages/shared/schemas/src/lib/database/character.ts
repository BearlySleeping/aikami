// packages/shared/schemas/src/lib/database/character.ts
import Type from 'typebox';
import { AppearanceSchema } from './appearance.ts';
import { DEFAULT_SAVING_THROWS, DEFAULT_SKILLS, SavingThrowSchema, SkillSchema } from './skills.ts';

export const BaseCharacterSheetSchema = Type.Object(
  {
    name: Type.String({ description: 'Character Name (Required, max 100 characters)' }),
    race: Type.Optional(Type.String({ description: 'Character Race' })),
    class: Type.Optional(Type.String({ description: 'Character Class' })),
    subclass: Type.Optional(Type.String({ description: 'Character Subclass (Optional)' })),
    level: Type.Optional(
      Type.Integer({ description: 'Character Level (integer between 1 and 20)' }),
    ),
    experiencePoints: Type.Number({
      description: 'Experience Points (non-negative integer)',
      default: 0,
    }),

    abilityScores: Type.Optional(
      Type.Object(
        {
          strength: Type.Optional(
            Type.Integer({ description: 'Strength Score (integer between 1 and 30)' }),
          ),
          dexterity: Type.Optional(
            Type.Integer({ description: 'Dexterity Score (integer between 1 and 30)' }),
          ),
          constitution: Type.Optional(
            Type.Integer({ description: 'Constitution Score (integer between 1 and 30)' }),
          ),
          intelligence: Type.Optional(
            Type.Integer({ description: 'Intelligence Score (integer between 1 and 30)' }),
          ),
          wisdom: Type.Optional(
            Type.Integer({ description: 'Wisdom Score (integer between 1 and 30)' }),
          ),
          charisma: Type.Optional(
            Type.Integer({ description: 'Charisma Score (integer between 1 and 30)' }),
          ),
        },
        { description: 'Ability Scores' },
      ),
    ),

    hitPoints: Type.Integer({ description: 'Hit Points', default: 10 }),
    hitPointsMax: Type.Optional(Type.Integer({ description: 'Maximum Hit Points' })),
    temporaryHitPoints: Type.Integer({ description: 'Temporary Hit Points', default: 0 }),
    armorClass: Type.Integer({ description: 'Armor Class', default: 10 }),
    speed: Type.Integer({ description: 'Speed', default: 30 }),
    initiative: Type.Optional(Type.Integer({ description: 'Initiative modifier' })),

    proficiencyBonus: Type.Optional(
      Type.Integer({ description: 'Proficiency bonus (derived from level)' }),
    ),

    savingThrows: Type.Array(SavingThrowSchema, {
      description: 'Saving throw proficiencies',
      default: DEFAULT_SAVING_THROWS,
    }),

    skills: Type.Array(SkillSchema, {
      description: 'Skill proficiencies',
      default: DEFAULT_SKILLS,
    }),

    alignment: Type.Optional(
      Type.String({
        description:
          'Alignment (one of: Lawful Good, Neutral Good, Chaotic Good, Lawful Neutral, Neutral, Chaotic Neutral, Lawful Evil, Neutral Evil, Chaotic Evil)',
      }),
    ),
    background: Type.Optional(Type.String({ description: 'Background' })),

    proficiencies: Type.Array(Type.String(), {
      description: 'Proficiencies (Array of strings)',
      default: [],
    }),
    languages: Type.Array(Type.String(), {
      description: 'Languages (Array of strings)',
      default: ['Common'],
    }),

    equipment: Type.Array(Type.String(), {
      description: 'Equipment (Array of strings)',
      default: [],
    }),
    inventory: Type.Array(Type.String(), {
      description: 'Inventory (Array of strings)',
      default: [],
    }),

    personalityTraits: Type.Optional(
      Type.String({ description: 'Personality Traits (Optional, max 500 characters)' }),
    ),
    ideals: Type.Optional(Type.String({ description: 'Ideals (Optional, max 500 characters)' })),
    bonds: Type.Optional(Type.String({ description: 'Bonds (Optional, max 500 characters)' })),
    flaws: Type.Optional(Type.String({ description: 'Flaws (Optional, max 500 characters)' })),

    appearance: Type.Optional(AppearanceSchema),

    notes: Type.Optional(
      Type.String({ description: 'Additional Notes (Optional, max 1000 characters)' }),
    ),
  },
  { description: 'D&D Character Sheet' },
);
