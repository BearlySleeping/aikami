// apps/backend/firebase/src/controllers/callable/auth.ts

import { handleAuthEndpoint } from '@aikami/backend/auth';
import type { CallableFunctions } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { onCall } from '@snorreks/firestack';
import { logger } from '$logger';

/**
 * Auth callable function — handles all auth-related operations.
 *
 * Routes to the appropriate handler based on `data.type` via
 * the shared `handleAuthEndpoint` from @aikami/backend-auth.
 * The authenticated user is extracted from the Firebase callable context.
 */
export default onCall<CallableFunctions, 'auth'>(
  async (request) => {
    const data = request.data;
    if (!data || typeof data.type !== 'string') {
      logger.warn('callable/auth: invalid request — missing type');
      throw toAppError('invalid-argument', 'Missing or invalid type field');
    }

    logger.debug('callable/auth', { type: data.type });

    // Extract user claims from the Firebase Auth context (available in callable functions)
    const authUser = request.auth;
    const currentUser = authUser
      ? { id: authUser.uid, email: authUser.token.email ?? undefined }
      : undefined;

    return await handleAuthEndpoint({
      currentUser,
      payload: data.payload,
      type: data.type,
    });
  },
  {
    region: 'europe-west1',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
);
