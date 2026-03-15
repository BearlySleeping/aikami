import { handleAuthEndpoint } from '@aikami/backend/auth';
import { onSvelteKitAPICall } from '@aikami/backend/svelte-kit/api.ts';
import type { PWACalls } from '@aikami/types';
import { getUserSessionFromLocalesOrURL } from '$lib/server/utils/auth.ts';
import { logger } from '$logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
  onSvelteKitAPICall<PWACalls, 'auth'>('auth', event, async (data) => {
    logger.log('API Auth Endpoint: Incoming Data Payload', data.payload); // <<< ADD THIS LOG
    logger.log('API Auth Endpoint: Incoming Data Type', data.type); // <<< ADD THIS LOG

    const userSession =
      // (await getUserFromTokenHeader(event.request)) ??
      await getUserSessionFromLocalesOrURL(event);

    const { payload, type } = data;

    return handleAuthEndpoint({
      currentUser: userSession,
      payload,
      type,
    });
  });
