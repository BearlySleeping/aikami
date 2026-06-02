// packages/backend/chat/src/lib/api_handler.ts

import { createAiService } from '@aikami/backend/ai';
import type { ChatApiEvents, ChatMessageType } from '@aikami/types';
import { createApiHandler } from '@aikami/utils';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildNpcSystemPrompt = (options: {
  npcName: string;
  personaId: string;
  relationshipValue: number;
  playerData: Record<string, unknown>;
}): string => {
  const { npcName, personaId, relationshipValue, playerData } = options;

  const tone =
    relationshipValue < -30
      ? 'hostile and suspicious'
      : relationshipValue > 30
        ? 'warm and friendly'
        : 'neutral and guarded';

  const playerName = (playerData.name as string) || 'a traveler';

  return [
    `You are ${npcName}, a character in a fantasy role-playing game.`,
    '',
    `## Persona: ${personaId}`,
    'You embody this persona archetype. Stay in character at all times.',
    '',
    '## Relationship',
    `Your current relationship with ${playerName} is ${tone} (value: ${relationshipValue}/100).`,
    'Adjust your responses accordingly.',
    '',
    '## Rules',
    '- Respond in character as the NPC.',
    '- Keep responses concise (2-4 sentences).',
    '- React naturally to what the player says.',
    '- Never break character or reference being an AI.',
    '- If the player is hostile, respond defensively.',
    '- If the player is friendly, be more open.',
    '- You may reveal information about quests, the world, or your personal story.',
    '',
    "Respond ONLY with the NPC's dialogue. Do not include narration or actions in asterisks unless it is essential context.",
  ].join('\n');
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const promptCharacterCreation = async (payload: {
  messages: Array<{ role: string; text: string }>;
  userMessage: string;
  phase: string;
}): Promise<{ reply: string; complete: boolean; characterJson?: Record<string, unknown> }> => {
  logger.debug('promptCharacterCreation', { phase: payload.phase });

  const { userMessage, messages } = payload;

  if (!userMessage) {
    logger.warn('promptCharacterCreation: invalid input — missing userMessage');
    return { reply: 'Invalid request. Please try again.', complete: false };
  }

  const recentMessages = messages.slice(-15);
  const chatMessages = recentMessages.map((m) => ({
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
          return { reply: replyText, complete: true, characterJson };
        }
      } catch {
        logger.warn('promptCharacterCreation: failed to parse character JSON');
      }
    }

    return { reply: replyText, complete: false };
  } catch (error) {
    logger.error('promptCharacterCreation: AI service error', { error });
    return {
      reply: 'The mystical forces are clouded... Please try again in a moment.',
      complete: false,
    };
  }
};

const promptNpcDialogue = async (payload: {
  npcId: string;
  personaId: string;
  npcName: string;
  playerData: Record<string, unknown>;
  relationshipValue: number;
  messageHistory: Array<{ role: string; text: string }>;
}): Promise<{ reply: string; relationshipDelta: number }> => {
  logger.debug('promptNpcDialogue', { npcId: payload.npcId });

  const { npcId, personaId, npcName, playerData, relationshipValue, messageHistory } = payload;

  if (!npcId || !personaId || !npcName) {
    logger.warn('promptNpcDialogue: invalid input');
    return { reply: '...', relationshipDelta: 0 };
  }

  try {
    const provider = (process.env.AI_PROVIDER as 'openai' | 'gemini' | undefined) ?? 'gemini';
    const aiService = createAiService({ provider });

    const systemPrompt = buildNpcSystemPrompt({
      npcName,
      personaId,
      relationshipValue,
      playerData,
    });

    const historyMessages = messageHistory.slice(-15).map((m) => ({
      role:
        m.role === 'player'
          ? ('user' as const)
          : m.role === 'system'
            ? ('system' as const)
            : ('assistant' as const),
      content: String(m.text ?? ''),
    }));

    const response = await aiService.generateChat([
      { role: 'system', content: systemPrompt },
      ...historyMessages,
    ]);

    const replyText = response.text || '*The NPC stares at you silently.*';
    const relationshipDelta = Math.floor(Math.random() * 5) - 2;

    return { reply: replyText, relationshipDelta };
  } catch (error) {
    logger.error('promptNpcDialogue: AI service error', { error, npcId });
    return {
      reply: '*The NPC seems distracted and unable to speak right now.*',
      relationshipDelta: 0,
    };
  }
};

// ---------------------------------------------------------------------------
// Handler registry & export
// ---------------------------------------------------------------------------

const chatApiHandler = createApiHandler<ChatApiEvents>({
  promptCharacterCreation,
  promptNpcDialogue,
});

export const handleChatEndpoint = async <T extends ChatMessageType>(options: {
  payload: ChatApiEvents[T][0];
  type: T;
}): Promise<ChatApiEvents[T][1]> => {
  return await chatApiHandler({ type: options.type, payload: options.payload }, undefined);
};
