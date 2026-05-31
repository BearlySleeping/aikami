// apps/backend/firebase/src/controllers/callable/prompt_character_creation.ts

import type { CallableFunctions } from '@aikami/types';
import { onCall } from '@snorreks/firestack';
import { z } from 'zod';
import { createAiService } from '@aikami/backend-ai';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Character creation input / output schemas
// ---------------------------------------------------------------------------

const chatMessageSchema = z.object({
  role: z.enum(['dm', 'user', 'system']),
  text: z.string(),
});

const characterCreationInputSchema = z.object({
  messages: z.array(chatMessageSchema),
  userMessage: z.string().min(1),
  phase: z.string(),
});

const abilityScoresSchema = z.object({
  strength: z.number().int().min(8).max(18),
  dexterity: z.number().int().min(8).max(18),
  constitution: z.number().int().min(8).max(18),
  intelligence: z.number().int().min(8).max(18),
  wisdom: z.number().int().min(8).max(18),
  charisma: z.number().int().min(8).max(18),
});

const characterJsonSchema = z.object({
  name: z.string(),
  race: z.string(),
  class: z.string(),
  level: z.number().int(),
  abilityScores: abilityScoresSchema,
  appearanceDescription: z.string(),
  background: z.string(),
  alignment: z.string(),
  personalityTraits: z.string(),
  ideals: z.string(),
  bonds: z.string(),
  flaws: z.string(),
});

/**
 * D&D 2024 Dungeon Master persona for character creation.
 * Guides the player through a natural conversation to create their character.
 */
const DM_SYSTEM_PROMPT = [
  'You are a Dungeon Master guiding a player through character creation using the D&D 2024 (5.5e) ruleset.',
  '',
  '## Your Role',
  'You are a friendly, engaging Dungeon Master having a conversation with a new player.',
  'Ask questions naturally, one or two at a time. Do not overwhelm the player with too many questions at once.',
  '',
  '## Character Creation Order (2024 Rules)',
  '1. **Concept & Origin**: Ask about concept, Species (Aasimar, Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc, Tiefling), and Background.',
  '2. **Class & Subclass**: Suggest fitting classes (Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard) based on playstyle.',
  '3. **Ability Scores**: Standard array: 15, 14, 13, 12, 10, 8. Primary stat = 15.',
  '4. **Personality & Story**: Alignment, Traits, Ideals, Bonds, Flaws, backstory.',
  '5. **Appearance**: Physical description for portrait generation.',
  '6. **Equipment**: Weapon and armor preference.',
  '',
  '## Rules',
  '- ALWAYS follow the 2024 D&D rules.',
  '- Keep responses concise and flavorful — 2-4 sentences.',
  '- Have a natural conversation. Do not force all questions at once.',
  '- When the character is ready, include "YOUR CHARACTER IS READY" and return the characterJson.',
  '',
  '## JSON Output Format',
  'When complete, return:',
  '{',
  '  "reply": "DM message to the player",',
  '  "complete": true,',
  '  "characterJson": {',
  '    "name": "string",',
  '    "race": "string",',
  '    "class": "string",',
  '    "level": 1,',
  '    "abilityScores": { "strength": 15, "dexterity": 14, "constitution": 13, "intelligence": 12, "wisdom": 10, "charisma": 8 },',
  '    "appearanceDescription": "concise visual description",',
  '    "background": "string",',
  '    "alignment": "e.g. Neutral Good",',
  '    "personalityTraits": "string",',
  '    "ideals": "string",',
  '    "bonds": "string",',
  '    "flaws": "string"',
  '  }',
  '}',
  '',
  'If NOT ready, return:',
  '{ "reply": "DM question", "complete": false }',
].join('\n');

/**
 * Callable: promptCharacterCreation
 *
 * Guides a player through D&D 2024 character creation via AI conversation.
 * Called by the game client via Firebase REST API.
 */
export default onCall<CallableFunctions, 'promptCharacterCreation'>(async (request) => {
  logger.debug('promptCharacterCreation', { phase: request.data?.phase });

  // Parse and validate input
  const parsed = characterCreationInputSchema.safeParse(request.data);
  if (!parsed.success) {
    logger.warn('promptCharacterCreation: invalid input', { errors: parsed.error.issues });
    return {
      reply: 'Invalid request. Please try again.',
      complete: false,
    };
  }

  const { messages, userMessage, phase } = parsed.data;

  // Build conversation context (last 15 messages for context window management)
  const recentMessages = messages.slice(-15);
  const chatMessages = recentMessages.map((m) => ({
    role: m.role === 'dm' ? ('assistant' as const) : ('user' as const),
    content: m.text,
  }));

  try {
    const provider = (process.env['AI_PROVIDER'] as 'openai' | 'gemini' | undefined) ?? 'gemini';
    const aiService = createAiService({ provider });

    const response = await aiService.generateChat([
      { role: 'system', content: DM_SYSTEM_PROMPT },
      ...chatMessages,
      { role: 'user', content: userMessage },
    ]);

    const replyText = response.text || 'Hmm, I seem to be at a loss for words. Let me gather my thoughts...';

    // Check if the response signals completion
    const isComplete = replyText.includes('YOUR CHARACTER IS READY');

    if (isComplete) {
      // Attempt to extract character JSON by asking the AI to output structured data
      const extractionResponse = await aiService.generateChat([
        { role: 'system', content: DM_SYSTEM_PROMPT },
        ...chatMessages,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: replyText },
        {
          role: 'user',
          content:
            'Based on the conversation above, output ONLY a valid JSON object with the character data. Do not include any other text. The JSON must have: name, race, class, level, abilityScores (strength, dexterity, constitution, intelligence, wisdom, charisma all as integers), appearanceDescription, background, alignment, personalityTraits, ideals, bonds, flaws.',
        },
      ]);

      try {
        // Extract JSON from the response
        const jsonMatch = extractionResponse.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const characterJson = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          const validated = characterJsonSchema.safeParse(characterJson);

          if (validated.success) {
            return {
              reply: replyText,
              complete: true,
              characterJson: validated.data,
            };
          }
        }
      } catch {
        logger.warn('promptCharacterCreation: failed to parse character JSON');
      }
    }

    return {
      reply: replyText,
      complete: false,
    };
  } catch (error) {
    logger.error('promptCharacterCreation: AI service error', { error });
    return {
      reply: 'The mystical forces are clouded... Please try again in a moment.',
      complete: false,
    };
  }
}, {
  region: 'europe-west1',
  memory: '256MiB',
  timeoutSeconds: 60,
});
