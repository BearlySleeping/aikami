// src/routes/api/[...slugs]/+server.ts
//
// Mounts the Elysia internal API service. Every /api/* request that does
// not match a dedicated SvelteKit route is handled by the Elysia app
// (see src/lib/server/api/index.ts).
//
// 🔴 /api/internal_logging is NOT handled here — it has its own dedicated
// route (src/routes/api/internal_logging/+server.ts) which SvelteKit
// matches with higher priority than this catch-all.

import { deleteCookie, setSessionCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import { AUTH_COOKIE_NAME } from '@aikami/constants';
import { app } from '$lib/server/api';
import { logger } from '$logger';

type RequestHandler = (v: {
  request: Request;
  cookies: import('@sveltejs/kit').Cookies;
  url: URL;
}) => Response | Promise<Response>;

/**
 * The Elysia session handler writes the session cookie as a raw
 * `Set-Cookie` header (host-only, no Domain), while hooks' manageSessionId
 * writes the same `__session` name with a `Domain=` attribute via
 * SvelteKit. That produces TWO cookies under the same name that shadow
 * each other — the session JWT can lose to the aikamiSessionId-only copy,
 * and a failed verify re-stamps the no-session copy newer so it wins
 * every subsequent parse.
 *
 * This fallback intercepts the raw session cookie and re-applies it
 * through SvelteKit's cookie store, so the session JWT merges into the
 * SAME cookie as aikamiSessionId (one cookie, consistent domain).
 *
 * Note: the cookie must be named `__session` — Firebase Hosting strips
 * every other cookie from requests forwarded to Cloud Run rewrites.
 */
export const fallback: RequestHandler = async ({ request, cookies, url }) => {
  const response = await app.handle(request);

  const setCookie = response.headers.get('set-cookie');
  if (setCookie?.startsWith(`${AUTH_COOKIE_NAME}=`)) {
    response.headers.delete('set-cookie');
    try {
      const rawValue = decodeURIComponent(
        setCookie.slice(AUTH_COOKIE_NAME.length + 1).split(';')[0] ?? '',
      );
      const store = JSON.parse(rawValue) as Record<string, string | undefined>;
      const session = store.session;
      if (session) {
        setSessionCookie(session, { cookies, request, url });
      } else {
        deleteCookie('__session', { cookies, request, url });
      }
    } catch (error) {
      // Malformed cookie value — drop it rather than fail the request.
      logger.error('api/[...slugs]: failed to re-apply session cookie', error);
    }
  }

  return response;
};
