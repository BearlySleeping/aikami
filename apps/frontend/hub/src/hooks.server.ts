// apps/frontend/hub/src/hooks.server.ts

import { getUserSession } from '@aikami/backend/svelte-kit/auth.ts';
import { getCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import {
  apiMethodGuard,
  buildLogContext,
  detectDevice,
  getClientIp,
  manageSessionId,
  rewriteForwardedHost,
} from '@aikami/backend/svelte-kit/hooks_helpers';
import { SSRLogSink } from '@aikami/backend/svelte-kit/log_sink';
import { verifyAppCheck } from '@aikami/backend/svelte-kit/verify_app_check';
import type { LogContext } from '@aikami/types';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { logger } from '$logger';
import { logContextStore } from '$loggerServer';
import { toRoutePathFromRouteId, toRoutePathFromURL } from '$router';

const allowExtensionCors = true;

const enforceAppCheck = false;

const appCheckExcludePaths: string[] = [];

// Register the SSR stdout sink once at module boot.
// Logs are written to stdout/stderr (Cloud Run console).
logger.addSink(new SSRLogSink(logContextStore));

// Eagerly trigger the lazy SSR logger to load BEFORE the first request.
void logger.write({ logLevel: 'DEBUG', logType: 'debug', message: 'ssr-logger-init' });

export const handleError = (({ error, event }) => {
  const pwaError = error as App.Error | undefined;
  const sessionId =
    event.locals.sessionId ?? getCookie('aikamiSessionId', { cookies: event.cookies }) ?? 'unknown';

  logContextStore.run(
    {
      source: 'ssr',
      sessionId,
      userId: event.locals.userSession?.id,
      ip:
        event.request.headers.get('x-forwarded-for') ??
        event.request.headers.get('x-real-ip') ??
        undefined,
      route: event.url.pathname,
      userAgent: event.request.headers.get('user-agent') ?? undefined,
    },
    () => {
      logger.error('hooks.server:handleError', { sessionId, error });
    },
  );

  return {
    errorId: sessionId,
    message: pwaError?.message ?? 'Internal Server Error',
    type: pwaError?.type ?? 'unknown-error',
  };
}) satisfies HandleServerError;

export const handle: Handle = async ({ event, resolve }) => {
  // ── 1. Rewrite event URL for Firebase Hosting proxy ──
  event = rewriteForwardedHost(event);

  const { request, url } = event;
  const { pathname } = url;
  const routeId = event.route.id;

  // Single cast: locals is the SvelteKit App.Locals object.
  // TLocals extends CoreLocals, so all CoreLocals fields are writable.
  // The app's own app.d.ts declaration merges additional fields.
  const locals = event.locals;

  // ── 2. Auth: resolve user session from the __aikami_session cookie ──
  // The cookie is set by the Elysia internal API (POST /api/auth/session).
  const { userSession } = await getUserSession({
    cookies: event.cookies,
    request,
    url,
  });
  locals.userSession = userSession;

  // ── 3. Device detection ──
  if (!locals.device) {
    locals.device = detectDevice(request);
  }

  // ── 4. Client IP ──
  const clientIp = getClientIp(request, () => {
    try {
      return event.getClientAddress();
    } catch {
      return undefined;
    }
  });

  // ── 5. Session ID cookie ──
  const sessionId = manageSessionId({
    cookies: event.cookies,
    request,
    url,
  });
  locals.sessionId = sessionId;

  // ── 6. Build log context ──
  const logContext = buildLogContext({
    device: locals.device,
    ip: clientIp,
    route: routeId ?? pathname,
    sessionId,
    userAgent: request.headers.get('user-agent') ?? undefined,
    userId: userSession?.id,
  }) as LogContext;

  // ── 7. API route: method guard + extension CORS ──
  if (pathname.startsWith('/api/')) {
    const method = request.method;

    if (allowExtensionCors && method === 'OPTIONS') {
      const origin = request.headers.get('origin');
      const preflightHeaders = new Headers();
      preflightHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      preflightHeaders.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Cookie, x-aikami-session',
      );
      // Only allow extension origins (matching the later CORS check)
      if (origin?.startsWith('chrome-extension://') || origin === 'null') {
        preflightHeaders.set('Access-Control-Allow-Origin', origin);
        preflightHeaders.set('Access-Control-Allow-Credentials', 'true');
      }
      return new Response(null, { status: 204, headers: preflightHeaders });
    }

    const guardResponse = apiMethodGuard(pathname, method);
    if (guardResponse) {
      return guardResponse;
    }

    // ── App Check verification (skip OPTIONS + excluded paths) ──
    if (
      enforceAppCheck &&
      method !== 'OPTIONS' &&
      !appCheckExcludePaths?.some((prefix) => pathname.startsWith(prefix))
    ) {
      try {
        await verifyAppCheck(request);
      } catch {
        return new Response('Unauthorized: Invalid App Check token', { status: 401 });
      }
    }

    const response = await logContextStore.run(logContext, () => resolve(event));

    // Attach CORS headers for extension origins
    if (allowExtensionCors) {
      const origin = request.headers.get('origin');
      if (origin?.startsWith('chrome-extension://') || origin === 'null') {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Credentials', 'true');
      }
    }

    return response;
  }

  // ── 8. SSR: resolve page in log context ──
  locals.currentRoute = resolveRoute(event);
  const response = await logContextStore.run(logContext, () => resolve(event));

  logger.log('hooks:route', {
    pathname: url.pathname,
    routeId,
  });

  return response;
};

const resolveRoute = (event: Parameters<Handle>[0]['event']) => {
  const routeId = event.route.id;
  if (routeId) {
    return toRoutePathFromRouteId(routeId);
  }
  return toRoutePathFromURL(event.url);
};
