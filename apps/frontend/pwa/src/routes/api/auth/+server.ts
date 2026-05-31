// apps/frontend/pwa/src/routes/api/auth/+server.ts
import { onSvelteKitAPICall } from '@aikami/backend/svelte-kit/api.ts';
import type { PWACalls } from '@aikami/types';
import { getUserSessionFromLocalesOrURL } from '$lib/server/utils/auth.ts';
import { logger } from '$logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
  onSvelteKitAPICall<PWACalls, 'auth'>('auth', event, async (data) => {
    logger.log('API Auth Endpoint', { type: data.type });

    const userSession = await getUserSessionFromLocalesOrURL(event);

    const { handleAuthEndpoint } = await import('@aikami/backend/auth/api_handler');
    return handleAuthEndpoint({
      currentUser: userSession,
      payload: data.payload,
      type: data.type,
    });
  });
