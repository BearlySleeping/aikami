import { z } from 'zod';
import { AppearanceSchema } from './appearance.ts';
import { DEFAULT_SAVING_THROWS, DEFAULT_SKILLS, SavingThrowSchema, SkillSchema } from './skills.ts';

export const BaseCharacterSheetSchema = z
  .object({
    name: z.string().describe('Character Name (Required, max 100 characters)'),
    race: z.string().describe('Character Race').optional(),
    class: z.string().describe('Character Class').optional(),
    subclass: z.string().describe('Character Subclass (Optional)').optional(),
    level: z.number().int().describe('Character Level (integer between 1 and 20)').optional(),
    experiencePoints: z
      .number()
      .int()
      .describe('Experience Points (non-negative integer)')
      .default(0),

    abilityScores: z
      .object({
        strength: z.number().int().describe('Strength Score (integer between 1 and 30)').optional(),
        dexterity: z
          .number()
          .int()
          .describe('Dexterity Score (integer between 1 and 30)')
          .optional(),
        constitution: z
          .number()
          .int()
          .describe('Constitution Score (integer between 1 and 30)')
          .optional(),
        intelligence: z
          .number()
          .int()
          .describe('Intelligence Score (integer between 1 and 30)')
          .optional(),
        wisdom: z.number().int().describe('Wisdom Score (integer between 1 and 30)').optional(),
        charisma: z.number().int().describe('Charisma Score (integer between 1 and 30)').optional(),
      })
      .describe('Ability Scores')
      .optional(),

    hitPoints: z.number().int().describe('Hit Points').default(10),
    hitPointsMax: z.number().int().describe('Maximum Hit Points').optional(),
    temporaryHitPoints: z.number().int().describe('Temporary Hit Points').default(0),
    armorClass: z.number().int().describe('Armor Class').default(10),
    speed: z.number().int().describe('Speed').default(30),
    initiative: z.number().int().describe('Initiative modifier').optional(),

    proficiencyBonus: z
      .number()
      .int()
      .describe('Proficiency bonus (derived from level)')
      .optional(),

    savingThrows: SavingThrowSchema.array()
      .describe('Saving throw proficiencies')
      .default(DEFAULT_SAVING_THROWS),

    skills: SkillSchema.array().describe('Skill proficiencies').default(DEFAULT_SKILLS),

    alignment: z
      .string()
      .describe(
        'Alignment (one of: Lawful Good, Neutral Good, Chaotic Good, Lawful Neutral, Neutral, Chaotic Neutral, Lawful Evil, Neutral Evil, Chaotic Evil)',
      )
      .optional(),
    background: z.string().describe('Background').optional(),

    proficiencies: z.string().array().describe('Proficiencies (Array of strings)').default([]),
    languages: z.string().array().describe('Languages (Array of strings)').default(['Common']),

    equipment: z.string().array().describe('Equipment (Array of strings)').default([]),
    inventory: z.string().array().describe('Inventory (Array of strings)').default([]),

    personalityTraits: z
      .string()
      .describe('Personality Traits (Optional, max 500 characters)')
      .optional(),
    ideals: z.string().describe('Ideals (Optional, max 500 characters)').optional(),
    bonds: z.string().describe('Bonds (Optional, max 500 characters)').optional(),
    flaws: z.string().describe('Flaws (Optional, max 500 characters)').optional(),

    appearance: AppearanceSchema.describe('Character appearance details').optional(),

    notes: z.string().describe('Additional Notes (Optional, max 1000 characters)').optional(),
  })
  .describe('D&D Character Sheet');
