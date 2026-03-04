import { getAuth } from '@aikami/backend/configs/auth.ts';
import { onSvelteKitAPICall } from '@aikami/backend/svelte-kit/api.ts';
import { deleteCookie, sessionAge, setCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import type { PWACalls } from '@aikami/types';
import logger from '$logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
  onSvelteKitAPICall<PWACalls, 'auth/session'>('auth/session', event, async ({ token }) => {
    logger.debug('/api/auth/session', { token: !!token });
    if (token) {
      const session = await getAuth().createSessionCookie(token, {
        expiresIn: sessionAge,
      });
      setCookie('__session', session, {
        maxAge: sessionAge,
        ...event,
      });
    } else {
      deleteCookie('__session', event);
      delete event.locals.userSession;
    }
  });
