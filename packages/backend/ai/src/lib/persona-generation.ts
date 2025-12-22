import { personaRepository } from '@aikami/backend/database/persona.ts'
import type {
  AIMessagePayload,
  PersonaCreateData,
  PersonaData,
  UserSessionData,
} from '@aikami/types'
import { genkit, z } from 'genkit'
import { googleAI } from '@genkit-ai/googleai'
import { getBucket } from '@aikami/backend/configs/bucket.ts'
import { toAppError } from '@aikami/utils'
import { Buffer } from 'node:buffer'
import logger from '$logger'

const ai = genkit({
  plugins: [googleAI()], // set the GOOGLE_API_KEY env variable
  model: googleAI.model('gemini-2.5-flash'),
})

export const PersonaSheetSchema = z
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
    speed: z.coerce.number().int().describe('Speed (Required, non-negative integer)'),

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

/**
 * Generates and stores a character image.
 * @param characterSheet The character sheet data.
 * @param user The user session data.
 * @returns The public URL of the generated image.
 */
const _generateAndStoreImage = async (
  persona: z.infer<typeof PersonaSheetSchema>,
  user: UserSessionData,
): Promise<string> => {
  const imagePrompt =
    `A portrait of a ${persona.race} ${persona.class} named ${persona.name}. ${persona.personalityTraits}`
  logger.debug(`Generating image with prompt: "${imagePrompt}"`)
  const imageResponse = await ai.generate({
    model: googleAI.model('imagen-3.0-generate-002'),
    prompt: imagePrompt,
  })

  const generatedImage = imageResponse.media
  if (!generatedImage?.url) {
    logger.warn('Failed to generate image from AI. Media or URL was null.')
    throw toAppError('internal', 'Failed to generate image')
  }

  const bucket = getBucket()
  const fileName = `character-images/${user.id}/${crypto.randomUUID()}.png`
  const file = bucket.file(fileName)

  logger.log(`Saving character image to bucket at ${fileName}`)
  const imageFetch = await fetch(generatedImage.url)
  const imageBuffer = await imageFetch.arrayBuffer()

  await file.save(Buffer.from(imageBuffer), {
    metadata: {
      contentType: generatedImage.contentType,
    },
  })
  await file.makePublic()

  const imageUrl = file.publicUrl()
  logger.debug(`Image saved and public URL is ${imageUrl}`)
  return imageUrl
}

/**
 * Generates a character sheet using the AI model.
 * @param prompt The user's prompt for character generation.
 * @returns The generated character sheet.
 */
const _generatePersona = async (prompt: string) => {
  const result = await ai.generate({
    model: googleAI.model('gemini-2.5-flash'),
    prompt:
      `Generate an interesting Dungeons & Dragons character based on the following prompt: ${prompt}`,
    output: {
      schema: PersonaSheetSchema,
    },
  })

  const persona = result.output
  if (!persona) {
    logger.warn('Failed to generate character sheet from AI. Result output was null.')
    throw toAppError('internal', 'Failed to generate character sheet')
  }
  logger.log('Generated persona sheet:', persona)
  return persona
}

/**
 * Saves the character data to the database.
 * @param user The user session data.
 * @param characterCreateData The character data to save.
 * @returns The created character data.
 */
const _saveCharacter = async (
  user: UserSessionData,
  personaCreateData: PersonaCreateData,
): Promise<PersonaData> => {
  logger.log(`Creating persona document for user ${user.id}`)
  const personaId = await personaRepository.addDocument({
    createData: personaCreateData,
    getCollectionPathArgument: { uid: user.id },
  })
  if (!personaId) {
    logger.error('Failed to create persona in database. addDocument returned no ID.')
    throw toAppError('data-loss', 'Failed to create character in database')
  }
  logger.debug(`Persona document created with id: ${personaId}`)

  return {
    ...personaCreateData,
    createdAt: null,
    id: personaId,
  }
}

export const createPersona = async (
  options: AIMessagePayload<'createPersona'>,
  user: UserSessionData,
): Promise<{ persona: PersonaData }> => {
  const { prompt } = options
  logger.log(`Starting character generation for user ${user.id} with prompt: "${prompt}"`)

  const personaSheet = await _generatePersona(prompt)
  // const imageUrl = await _generateAndStoreImage(characterSheet, user);
  const imageUrl =
    'https://storage.googleapis.com/aikami-prod.firebasestorage.app/banana.webp?GoogleAccessId=firebase-adminsdk-t1dwx%40aikami-prod.iam.gserviceaccount.com&Expires=1794172559&Signature=RL6Sb5A4DIb8e9qvT9GhnKcgU2Fk5QtDjPIXqYE2otiFjqcm9Er9Lc8eweTSEP3XFZru0%2FQ4WmmQsHNSaOekwaDYV8bYHqiuIaWI3hcCtWjR17%2FO20qIIqrcr8%2FnESPnLnWmIDWaWvzDn19Qz%2BvLhSxvqC9Gf3qXV4XXqvrhOkxSkRSBJK6uT7UjnNIwnQ89gUSnCtYg4j69G0g7d7R%2FVHaUqAXPwFJCYvV4s%2FOUI%2BQneXJeB0EwGus0PNSHGGluVL37cWj3AdZD0pezvQoBO0n4T8z7GeZPP8mI2T%2FLbenku4MjdH2MCI8cMOrHu3AEhSpCF9HuJZEv49e7tbYLZw%3D%3D'

  const persona = await _saveCharacter(user, {
    ...personaSheet,
    avatarUrl: imageUrl,
    uid: user.id,
  })

  logger.log(`Successfully created character ${persona.id} for user ${user.id}`)
  return { persona }
}
