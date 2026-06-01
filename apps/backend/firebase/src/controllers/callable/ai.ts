// apps/backend/firebase/src/controllers/callable/ai.ts

import { createAiService } from '@aikami/backend-ai';
import type { CallableFunctions } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { onCall } from '@snorreks/firestack';
import { logger } from '$logger';

/**
 * AI callable function — handles all AI-related operations.
 *
 * Dispatches based on `data.type` to the appropriate AI service method.
 * Supported types:
 *   - `sendMessage`: Generates a chat response with optional context.
 *   - `createPersona`: Generates a persona from a prompt.
 */
export default onCall<CallableFunctions, 'ai'>(
  async (request) => {
    const data = request.data;
    if (!data || typeof data.type !== 'string') {
      logger.warn('callable/ai: invalid request — missing type');
      throw toAppError('invalid-argument', 'Missing or invalid type field');
    }

    logger.debug('callable/ai', { type: data.type });

    const provider = (process.env['AI_PROVIDER'] as 'openai' | 'gemini' | undefined) ?? 'gemini';
    const aiService = createAiService({ provider });

    switch (data.type) {
      case 'sendMessage': {
        const { text, context } = data.payload;

        const systemPrompt = context?.systemPrompt ?? 'You are a helpful assistant.';
        const messages =
          context?.messages?.map((m) => ({
            role: m.role as 'system' | 'user' | 'assistant',
            content: m.content,
          })) ?? [];

        const response = await aiService.generateChat([
          { role: 'system', content: systemPrompt },
          ...messages,
          { role: 'user', content: text },
        ]);

        return {
          text: response.text,
          usage: response.usage,
        };
      }

      case 'createPersona': {
        const { prompt } = data.payload;

        const response = await aiService.generateChat([
          {
            role: 'system',
            content:
              'You are a creative character generator. Create a detailed persona based on the prompt. Respond ONLY with valid JSON matching the PersonaData schema.',
          },
          { role: 'user', content: prompt },
        ]);

        try {
          const jsonMatch = response.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return { persona: JSON.parse(jsonMatch[0]) };
          }
        } catch {
          logger.warn('callable/ai: failed to parse persona JSON');
        }

        return { persona: { name: prompt, description: response.text } };
      }

      default: {
        logger.warn('callable/ai: unknown type', { type: data.type });
        throw toAppError('invalid-argument', `Unknown AI message type: ${data.type}`);
      }
    }
  },
  {
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
);
