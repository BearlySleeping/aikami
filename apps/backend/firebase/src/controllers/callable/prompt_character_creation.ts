// apps/backend/firebase/src/controllers/callable/prompt_character_creation.ts

import { createAiService } from '@aikami/backend/ai';
import type { CallableFunctions } from '@aikami/types';
import { onCall } from '@snorreks/firestack';
import Type from 'typebox';
import { logger } from '$logger';

const chatMessageSchema = Type.Object({
  role: Type.Union([Type.Literal('dm'), Type.Literal('user'), Type.Literal('system')]),
  text: Type.String(),
});

const _characterCreationInputSchema = Type.Object({
  messages: Type.Array(chatMessageSchema),
  userMessage: Type.String({ minLength: 1 }),
  phase: Type.String(),
});

const abilityScoresSchema = Type.Object({
  strength: Type.Integer({ minimum: 8, maximum: 18 }),
  dexterity: Type.Integer({ minimum: 8, maximum: 18 }),
  constitution: Type.Integer({ minimum: 8, maximum: 18 }),
  intelligence: Type.Integer({ minimum: 8, maximum: 18 }),
  wisdom: Type.Integer({ minimum: 8, maximum: 18 }),
  charisma: Type.Integer({ minimum: 8, maximum: 18 }),
});

const _characterJsonSchema = Type.Object({
  name: Type.String(),
  race: Type.String(),
  class: Type.String(),
  level: Type.Integer(),
  abilityScores: abilityScoresSchema,
  appearanceDescription: Type.String(),
  background: Type.String(),
  alignment: Type.String(),
  personalityTraits: Type.String(),
  ideals: Type.String(),
  bonds: Type.String(),
  flaws: Type.String(),
});

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

export default onCall<CallableFunctions, 'promptCharacterCreation'>(
  async (request) => {
    logger.debug('promptCharacterCreation', { phase: request.data?.phase });

    // Validate input — basic structural check
    const input = request.data;
    if (!input || typeof input !== 'object') {
      return { reply: 'Invalid request. Please try again.', complete: false };
    }

    const userMessage = typeof input.userMessage === 'string' ? input.userMessage : '';
    const _phase = typeof input.phase === 'string' ? input.phase : '';

    if (!userMessage) {
      logger.warn('promptCharacterCreation: invalid input — missing userMessage');
      return { reply: 'Invalid request. Please try again.', complete: false };
    }

    // Build conversation context (last 15 messages)
    const rawMessages = Array.isArray(input.messages) ? input.messages : [];
    const recentMessages = rawMessages.slice(-15);
    const chatMessages = recentMessages.map((m: Record<string, unknown>) => ({
      role: (m.role === 'dm' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: String(m.text ?? ''),
    }));

    try {
      const provider = (process.env.AI_PROVIDER as 'openai' | 'gemini' | undefined) ?? 'gemini';
      const aiService = createAiService({ provider });

      const response = await aiService.generateChat([
        { role: 'system', content: DM_SYSTEM_PROMPT },
        ...chatMessages,
        { role: 'user', content: userMessage },
      ]);

      const replyText = response.text || 'Hmm, I seem to be at a loss for words...';
      const isComplete = replyText.includes('YOUR CHARACTER IS READY');

      if (isComplete) {
        const extractionResponse = await aiService.generateChat([
          { role: 'system', content: DM_SYSTEM_PROMPT },
          ...chatMessages,
          { role: 'user', content: userMessage },
          { role: 'assistant', content: replyText },
          {
            role: 'user',
            content:
              'Based on the conversation above, output ONLY a valid JSON object with the character data.',
          },
        ]);

        try {
          const jsonMatch = extractionResponse.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const characterJson = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
            return {
              reply: replyText,
              complete: true,
              characterJson,
            };
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
  },
  {
    region: 'europe-west1',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
);
