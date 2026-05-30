// apps/backend/firebase/src/controllers/api/prompt_ai.ts
import type { RequestFunctions } from '@aikami/types';
import { createAiService } from '@aikami/backend-ai';
import { onRequest } from '@snorreks/firestack';
import { logger } from '$logger';

/**
 * POST /api/prompt_ai
 *
 * AI prompt endpoint using the vendor-agnostic AI service abstraction.
 * Provider is selected via the `AI_PROVIDER` environment variable
 * (`openai` or `gemini`), defaulting to `gemini`.
 *
 * Request body: `{ prompt: string }`
 * Response: `{ chatResponse: { text: string, ... }, user: UserData }`
 */
export default onRequest<RequestFunctions, 'prompt_ai'>(
  async (request, response) => {
    try {
      logger.log('Request body:', request.body);

      const provider = (process.env['AI_PROVIDER'] as 'openai' | 'gemini' | undefined) ?? 'gemini';
      logger.log('AI provider:', provider);

      const aiService = createAiService({ provider });

      const system = 'You are a helpful assistant. Keep your answers brief.';
      const prompt = request.body.prompt || 'Tell me a short fact.';

      const chatResponse = await aiService.generateChat([
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ]);

      response.send({
        chatResponse,
      });
    } catch (error) {
      logger.error(error);
      response.status(500).send({ error: 'AI service error', message: String(error) });
    }
  },
  {
    region: 'europe-west1',
  },
);
