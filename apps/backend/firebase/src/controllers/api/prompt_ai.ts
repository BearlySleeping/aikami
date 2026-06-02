// packages/backend/firebase/src/controllers/api/prompt_ai.ts

import { handleAIEndpoint } from '@aikami/backend/ai';
import type { RequestFunctions } from '@aikami/types';
import { onRequest } from '@snorreks/firestack';
import { logger } from '$logger';

/**
 * POST /api/prompt_ai
 *
 * AI prompt endpoint routed through the shared `handleAIEndpoint` from
 * @aikami/backend/ai. Dispatches based on `body.type` to the appropriate
 * handler (sendMessage, createPersona, getProviders).
 *
 * Request body: `{ type: string, payload: object }`
 * Falls back to `sendMessage` if no type is specified.
 */
export default onRequest<RequestFunctions, 'ai'>(
  async (request, response) => {
    try {
      const { body } = request;
      const { type, payload } = body;
      logger.debug('api/prompt_ai', { type });
      const result = await handleAIEndpoint({ payload, type });
      response.send(result);
    } catch (error) {
      logger.error('api/prompt_ai: error', error);
      // Express error response — typed outside the normal contract
      const res = response as { status: (code: number) => { send: (body: unknown) => void } };
      res.status(500).send({ error: String(error) });
    }
  },
  {
    region: 'europe-west1',
  },
);
