// apps/frontend/pwa/src/hooks.server.ts

import { getCookie, setCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getUserSession } from '$lib/server/utils/auth.ts';
import { logger } from '$logger';
import { toRoutePathFromRouteId, toRoutePathFromURL } from '$router';

// Eagerly trigger the lazy SSR logger to load BEFORE the first request.
// This avoids the buffer-replay-outside-context issue where buffered log
// calls are replayed outside the AsyncLocalStorage context, causing
// SSRLogSink to see undefined context and silently drop entries.
void logger.write({ logLevel: 'DEBUG', logType: 'debug', message: 'ssr-logger-init' });

export const handleError = (({ error, event }) => {
  const pwaError = error as App.Error | undefined;
  const sessionId =
    event.locals.sessionId ?? getCookie('sessionId', { cookies: event.cookies }) ?? 'unknown';

  logger.error('hooks.server:handleError', { sessionId, error });

  return {
    errorId: sessionId,
    message: pwaError?.message ?? 'Internal Server Error',
    type: pwaError?.type ?? 'unknown-error',
  };
}) satisfies HandleServerError;

export const handle = (async ({ event, resolve }) => {
  // Rewrite event URL to use the original host from Firebase Hosting proxy.
  // Firebase Hosting sets X-Forwarded-Host and X-Forwarded-Proto when proxying to Cloud Run.
  // Without this, SSR renders with the Cloud Run URL (e.g. pwa-xxx.a.run.app)
  // causing hydration mismatches with the public Firebase Hosting URL.
  const forwardedHost = event.request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const forwardedProto = event.request.headers.get('x-forwarded-proto') ?? 'https';
    const originalUrl = new URL(event.request.url);
    if (originalUrl.host !== forwardedHost || originalUrl.protocol !== `${forwardedProto}:`) {
      originalUrl.host = forwardedHost;
      originalUrl.protocol = forwardedProto;
      event = {
        ...event,
        url: originalUrl,
        request: new Request(originalUrl, event.request),
      };
    }
  }

  const { locals, request, route, url } = event;
  const { pathname } = url;
  const routeId = route.id;

  const { shouldReAuthenticate, userSession } = await getUserSession(event);

  if (shouldReAuthenticate) {
    // TODO: navigate the user to a loading page, where we fetch a new token from the firebase frontend sdk and update the backend JWT
    // If it fails, log the user off and go to /login page again.
  }

  locals.userSession = userSession;

  // Ultra-fast mobile detection: Client Hints for Chrome, regex fallback for others
  const userAgent = request.headers.get('user-agent');
  if (!locals.device) {
    const mobileRegex =
      /Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i;
    const secChUaMobile = request.headers.get('sec-ch-ua-mobile');
    const isMobile =
      secChUaMobile !== null ? secChUaMobile === '?1' : mobileRegex.test(userAgent ?? '');
    locals.device = {
      type: isMobile ? 'smartphone' : 'desktop',
      os: { name: 'unknown', version: '' },
      browser: { type: 'browser', name: 'unknown', version: '' },
    };
  }

  const clientIp =
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    (() => {
      try {
        return event.getClientAddress();
      } catch {
        return undefined;
      }
    })();

  // Reuse session ID from cookie store (wrapped inside __session for Firebase Hosting compatibility), or generate a new one.
  let sessionId = getCookie('sessionId', { cookies: event.cookies });
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    setCookie('sessionId', sessionId, {
      cookies: event.cookies,
      request: event.request,
      url: event.url,
    });
  }
  locals.sessionId = sessionId;

  const logContext = {
    device: locals.device,
    ip: clientIp ?? undefined,
    route: routeId ?? pathname,
    sessionId,
    source: 'ssr' as const,
    userAgent: userAgent ?? undefined,
    userId: userSession?.id,
  };

  // todo implemnt loggin storing (perhaps with dataconnect/firestore)
  logger.debug('logContext', logContext);

  if (pathname.startsWith('/api/')) {
    const method = request.method;
    if (method !== 'POST') {
      return new Response('Method Not Allowed. Only POST or OPTIONS is allowed.', {
        headers: {
          'Access-Control-Allow-Headers':
            'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
          'Access-Control-Allow-Methods': 'POST,OPTIONS',
          'Access-Control-Allow-Origin': '*',
          // biome-ignore lint/style/useNamingConvention: standard HTTP header name
          Allow: 'POST',
        },
        status: 405,
      });
    }

    return resolve(event);
  }

  const currentRoute = routeId ? toRoutePathFromRouteId(routeId) : toRoutePathFromURL(url);

  locals.currentRoute = currentRoute;

  // code above happens before the endpoint or page is called
  const response = await resolve(event);
  // code bellow happens after the endpoint or page is called

  // Note: Re-authentication logic can be added here if needed

  logger.log('hooks:route', {
    pathname: url.pathname,
    routeId,
  });

  logger.log('hooks:currentRoute', currentRoute);
  // Route groups now handle authentication logic
  // No need to manually check auth status here

  return response;
}) satisfies Handle;
