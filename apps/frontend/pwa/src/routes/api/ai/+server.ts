import { handleAIEndpoint } from '@aikami/backend/ai/index.ts';
import { onSvelteKitAPICall } from '@aikami/backend/svelte-kit/api.ts';
import type { PWACalls } from '@aikami/types/index.ts';
import { toAppError } from '@aikami/utils/index.ts';
import { getUserSessionFromLocalesOrURL } from '$lib/server/utils/auth.ts';
import logger from '$logger/index.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
  onSvelteKitAPICall<PWACalls, 'ai'>('ai', event, async (data) => {
    const userSession = await getUserSessionFromLocalesOrURL(event);

    if (!userSession) {
      throw toAppError('unauthenticated', 'Current user not found');
    }
    const { payload, type } = data;

    logger.debug('AI endpoint called', {
      userSession,
      payload,
      type,
    });

    return handleAIEndpoint({
      currentUser: userSession,
      payload,
      type,
    });
  });
