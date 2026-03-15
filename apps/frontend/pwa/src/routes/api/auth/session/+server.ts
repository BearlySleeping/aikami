import { getAuth } from '@aikami/backend/configs/auth.ts';
import { onSvelteKitAPICall } from '@aikami/backend/svelte-kit/api.ts';
import { deleteCookie, sessionAge, setCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import type { PWACalls } from '@aikami/types';
import { logger } from '$logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
  onSvelteKitAPICall<PWACalls, 'auth/session'>('auth/session', event, async ({ token }) => {
    logger.debug('/api/auth/session - token present:', !!token);

    if (token) {
      try {
        // Verify the token first to see what we get
        const auth = getAuth();
        logger.debug('/api/auth/session - verifying token...');

        const decodedToken = await auth.verifyIdToken(token);
        logger.debug('/api/auth/session - token verified, uid:', decodedToken.uid);

        const session = await auth.createSessionCookie(token, {
          expiresIn: sessionAge,
        });
        setCookie('__session', session, {
          maxAge: sessionAge,
          ...event,
        });
        logger.debug('/api/auth/session - session created successfully');
      } catch (error) {
        logger.error('/api/auth/session - error:', error);
        throw error;
      }
    } else {
      deleteCookie('__session', event);
      delete event.locals.userSession;
    }
  });
