// apps/backend/firebase/src/controllers/callable/prompt_npc_dialogue.ts

import type { CallableFunctions } from '@aikami/types';
import { onCall } from '@snorreks/firestack';
import { z } from 'zod';
import { createAiService } from '@aikami/backend-ai';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// NPC dialogue input / output schemas
// ---------------------------------------------------------------------------

const dialogueMessageSchema = z.object({
  role: z.enum(['npc', 'player', 'system']),
  text: z.string(),
});

const promptNpcDialogueInputSchema = z.object({
  npcId: z.string().min(1),
  personaId: z.string().min(1),
  npcName: z.string().min(1),
  playerData: z.record(z.string(), z.unknown()).default({}),
  relationshipValue: z.number().int().min(-100).max(100).default(0),
  messageHistory: z.array(dialogueMessageSchema).default([]),
});

/**
 * System prompt template for NPC dialogue generation.
 *
 * Injects the NPC's persona rules, the player's character data, and the
 * current relationship value to dynamically adjust the response tone.
 *
 * @param npcName - Display name of the NPC.
 * @param personaId - Identifier for the NPC's persona definition.
 * @param relationshipValue - Current relationship (-100 to 100).
 * @param playerData - The player's character data.
 */
const buildSystemPrompt = (options: {
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

  const playerName = (playerData['name'] as string) || 'a traveler';

  return [
    `You are ${npcName}, a character in a fantasy role-playing game.`,
    '',
    `## Persona: ${personaId}`,
    `You embody this persona archetype. Stay in character at all times.`,
    '',
    `## Relationship`,
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
    'Respond ONLY with the NPC\'s dialogue. Do not include narration or actions in asterisks unless it is essential context.',
  ].join('\n');
};

/**
 * Callable: promptNpcDialogue
 *
 * Generates context-aware NPC dialogue responses using the AI service.
 * Called by the game client via Firebase REST API.
 */
export default onCall<CallableFunctions, 'promptNpcDialogue'>(async (request) => {
  logger.debug('promptNpcDialogue', { npcId: request.data?.npcId });

  // Parse and validate input
  const parsed = promptNpcDialogueInputSchema.safeParse(request.data);
  if (!parsed.success) {
    logger.warn('promptNpcDialogue: invalid input', { errors: parsed.error.issues });
    return {
      reply: '...',
      relationshipDelta: 0,
    };
  }

  const { npcId, personaId, npcName, playerData, relationshipValue, messageHistory } = parsed.data;

  try {
    const provider = (process.env['AI_PROVIDER'] as 'openai' | 'gemini' | undefined) ?? 'gemini';
    const aiService = createAiService({ provider });

    // Build the system prompt with dynamic persona + relationship injection
    const systemPrompt = buildSystemPrompt({
      npcName,
      personaId,
      relationshipValue,
      playerData,
    });

    // Convert message history to AI chat format
    const historyMessages = messageHistory.slice(-15).map((m) => ({
      role: m.role === 'player'
        ? ('user' as const)
        : m.role === 'system'
          ? ('system' as const)
          : ('assistant' as const),
      content: m.text,
    }));

    const response = await aiService.generateChat([
      { role: 'system', content: systemPrompt },
      ...historyMessages,
    ]);

    const replyText = response.text || '*The NPC stares at you silently.*';

    // Calculate a small random relationship delta for dynamic tone shifts
    const relationshipDelta = Math.floor(Math.random() * 5) - 2; // -2 to +2

    return {
      reply: replyText,
      relationshipDelta,
    };
  } catch (error) {
    logger.error('promptNpcDialogue: AI service error', { error, npcId });
    return {
      reply: '*The NPC seems distracted and unable to speak right now.*',
      relationshipDelta: 0,
    };
  }
}, {
  region: 'europe-west1',
  memory: '256MiB',
  timeoutSeconds: 30,
});
