// apps/backend/firebase/src/controllers/callable/prompt_npc_dialogue.ts

import { createAiService } from '@aikami/backend-ai';
import type { CallableFunctions } from '@aikami/types';
import { onCall } from '@snorreks/firestack';
import Type from 'typebox';
import { logger } from '$logger';

const dialogueMessageSchema = Type.Object({
  role: Type.Union([Type.Literal('npc'), Type.Literal('player'), Type.Literal('system')]),
  text: Type.String(),
});

const promptNpcDialogueInputSchema = Type.Object({
  npcId: Type.String({ minLength: 1 }),
  personaId: Type.String({ minLength: 1 }),
  npcName: Type.String({ minLength: 1 }),
  playerData: Type.Record(Type.String(), Type.Unknown()),
  relationshipValue: Type.Integer({ minimum: -100, maximum: 100, default: 0 }),
  messageHistory: Type.Array(dialogueMessageSchema, { default: [] } as any),
});

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
    "Respond ONLY with the NPC's dialogue. Do not include narration or actions in asterisks unless it is essential context.",
  ].join('\n');
};

export default onCall<CallableFunctions, 'promptNpcDialogue'>(
  async (request) => {
    logger.debug('promptNpcDialogue', { npcId: request.data?.npcId });

    const input = request.data;
    if (!input || typeof input !== 'object') {
      return { reply: '...', relationshipDelta: 0 };
    }

    const npcId = typeof input.npcId === 'string' ? input.npcId : '';
    const personaId = typeof input.personaId === 'string' ? input.personaId : '';
    const npcName = typeof input.npcName === 'string' ? input.npcName : 'NPC';
    const playerData =
      typeof input.playerData === 'object' && input.playerData !== null
        ? (input.playerData as Record<string, unknown>)
        : {};
    const relationshipValue =
      typeof input.relationshipValue === 'number' ? input.relationshipValue : 0;
    const rawMessages = Array.isArray(input.messageHistory) ? input.messageHistory : [];

    if (!npcId || !personaId || !npcName) {
      logger.warn('promptNpcDialogue: invalid input');
      return { reply: '...', relationshipDelta: 0 };
    }

    try {
      const provider = (process.env['AI_PROVIDER'] as 'openai' | 'gemini' | undefined) ?? 'gemini';
      const aiService = createAiService({ provider });

      const systemPrompt = buildSystemPrompt({
        npcName,
        personaId,
        relationshipValue,
        playerData,
      });

      const historyMessages = rawMessages.slice(-15).map((m: Record<string, unknown>) => ({
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
  },
  {
    region: 'europe-west1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
);
