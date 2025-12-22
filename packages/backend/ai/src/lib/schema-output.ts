import { genkit, z } from 'genkit'
import { googleAI } from '@genkit-ai/googleai'

const ai = genkit({
  plugins: [googleAI()], // set the GOOGLE_API_KEY env variable
  model: googleAI.model('gemini-2.0-flash'),
})

import genkitEndpoint from './endpoint.ts'

export const CharacterSheetSchema = z
  .object({
    name: z.string().describe('Character Name (Required, max 100 characters)'),
    race: z.string().describe('Character Race (Required, max 50 characters)'),
    class: z.string().describe('Character Class (Required, max 50 characters)'),
    level: z
      .number()
      .int()
      .describe('Character Level (Required, integer between 1 and 20)'),
    experiencePoints: z
      .number()
      .int()
      .describe('Experience Points (Required, non-negative integer)'),

    abilityScores: z
      .object({
        strength: z
          .number()
          .int()
          .describe('Strength Score (Required, integer between 1 and 30)'),
        dexterity: z
          .number()
          .int()
          .describe('Dexterity Score (Required, integer between 1 and 30)'),
        constitution: z
          .number()
          .int()
          .describe('Constitution Score (Required, integer between 1 and 30)'),
        intelligence: z
          .number()
          .int()
          .describe('Intelligence Score (Required, integer between 1 and 30)'),
        wisdom: z
          .number()
          .int()
          .describe('Wisdom Score (Required, integer between 1 and 30)'),
        charisma: z
          .number()
          .int()
          .describe('Charisma Score (Required, integer between 1 and 30)'),
      })
      .describe('Ability Scores'),

    hitPoints: z
      .number()
      .int()
      .describe('Hit Points (Required, non-negative integer)'),
    armorClass: z
      .number()
      .int()
      .describe('Armor Class (Required, non-negative integer)'),
    speed: z.number().int().describe('Speed (Required, non-negative integer)'),

    alignment: z
      .string()
      .describe(
        'Alignment (Required, one of: Lawful Good, Neutral Good, Chaotic Good, Lawful Neutral, Neutral, Chaotic Neutral, Lawful Evil, Neutral Evil, Chaotic Evil, max 50 characters)',
      ), // Example enum
    background: z.string().describe('Background (Required, max 50 characters)'), // Could also be an enum

    proficiencies: z
      .string()
      .array()
      .describe('Proficiencies (Array of strings)'),
    languages: z.string().array().describe('Languages (Array of strings)'),

    equipment: z.string().array().describe('Equipment (Array of strings)'),
    inventory: z.string().array().describe('Inventory (Array of strings)'),

    personalityTraits: z
      .string()
      .describe('Personality Traits (Optional, max 500 characters)')
      .optional(),
    ideals: z.string().describe('Ideals (Optional, max 500 characters)').optional(),
    bonds: z.string().describe('Bonds (Optional, max 500 characters)').optional(),
    flaws: z.string().describe('Flaws (Optional, max 500 characters)').optional(),

    notes: z
      .string()
      .describe('Additional Notes (Optional, max 1000 characters)')
      .optional(),
  })
  .describe('D&D Character Sheet')

export type CharacterSheet = z.infer<typeof CharacterSheetSchema>

export const POST = genkitEndpoint(
  { schema: z.object({ prompt: z.string() }) },
  ({ prompt }) =>
    ai.generateStream({
      prompt:
        `Generate an interesting Dungeons & Dragons character based on the following prompt: ${prompt}`,
      output: {
        schema: CharacterSheetSchema,
      },
    }),
)
