// apps/backend/firebase/src/controllers/callable/chat.ts

import { handleChatEndpoint } from '@aikami/backend/chat';
import type { CallableFunctions } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { onCall } from '@snorreks/firestack';
import { logger } from '$logger';

/**
 * Chat callable function — handles all chat-related operations.
 *
 * Routes to the appropriate handler based on `data.type` via
 * the shared `handleChatEndpoint` from @aikami/backend/chat.
 * Supports:
 *   - `promptCharacterCreation`: D&D character creation DM conversation.
 *   - `promptNpcDialogue`: NPC dialogue generation.
 */
export default onCall<CallableFunctions, 'chat'>(
  async (request) => {
    const data = request.data;
    if (!data || typeof data.type !== 'string') {
      logger.warn('callable/chat: invalid request — missing type');
      throw toAppError({
        errorType: 'invalid-argument',
        errorMessage: 'Missing or invalid type field',
      });
    }

    logger.debug('callable/chat', { type: data.type });

    return await handleChatEndpoint({
      payload: data.payload,
      type: data.type,
    });
  },
  {
    region: 'europe-west1',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
);
