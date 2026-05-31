// apps/frontend/pwa/src/routes/api/auth/session/+server.ts
import { onSvelteKitAPICall } from '@aikami/backend/svelte-kit/api.ts';
import { deleteCookie, sessionAge, setCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import {
  createSessionCookie,
  toUserSessionDataFromToken,
  verifyIdToken,
} from '@aikami/backend/utils/auth.ts';
import type { PWACalls } from '@aikami/types';
import { logger } from '$logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
  onSvelteKitAPICall<PWACalls, 'auth/session'>('auth/session', event, async ({ token }) => {
    logger.debug('/api/auth/session', { token: !!token });
    if (token) {
      const [session, decodedIdToken] = await Promise.all([
        createSessionCookie({
          token,
          expiresIn: sessionAge,
        }),
        verifyIdToken(token),
      ]);
      setCookie('__session', session, {
        maxAge: sessionAge,
        ...event,
      });
      event.locals.userSession = toUserSessionDataFromToken(decodedIdToken);
    } else {
      deleteCookie('__session', event);
      event.locals.userSession = undefined;
    }
  });
