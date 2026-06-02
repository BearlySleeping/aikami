// apps/backend/firebase/src/controllers/callable/ai.ts

import { handleAIEndpoint } from '@aikami/backend/ai';
import type { CallableFunctions, UserSessionData } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { onCall } from '@snorreks/firestack';
import { logger } from '$logger';

/**
 * AI callable function — handles all AI-related operations.
 *
 * Routes to the appropriate handler based on `data.type` via
 * the shared `handleAIEndpoint` from @aikami/backend/ai.
 * The authenticated user is extracted from the Firebase callable context.
 */
export default onCall<CallableFunctions, 'ai'>(
  async (request) => {
    const data = request.data;
    if (!data || typeof data.type !== 'string') {
      logger.warn('callable/ai: invalid request — missing type');
      throw toAppError({
        errorType: 'invalid-argument',
        errorMessage: 'Missing or invalid type field',
      });
    }

    logger.debug('callable/ai', { type: data.type });

    // Extract user claims from the Firebase Auth context (available in callable functions)
    const authUser = request.auth;
    const currentUser = authUser
      ? ({ id: authUser.uid, email: authUser.token.email ?? undefined } as UserSessionData)
      : undefined;

    return await handleAIEndpoint({
      currentUser,
      payload: data.payload,
      type: data.type,
    });
  },
  {
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
);
