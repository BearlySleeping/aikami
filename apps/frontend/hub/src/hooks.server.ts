// apps/frontend/hub/src/hooks.server.ts

import { getUserSession } from '@aikami/backend/svelte-kit/auth.ts';
import { getCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import {
  apiMethodGuard,
  buildLogContext,
  detectDevice,
  getClientIp,
  isAikamiWebOrigin,
  isPathExcluded,
  manageSessionId,
  rewriteForwardedHost,
} from '@aikami/backend/svelte-kit/hooks_helpers';
import { SSRLogSink } from '@aikami/backend/svelte-kit/log_sink';
import { verifyAppCheck } from '@aikami/backend/svelte-kit/verify_app_check';
import { isAppCheckEnabled } from '@aikami/frontend/configs';
import type { LogContext } from '@aikami/types';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { logger } from '$logger';
import { logContextStore } from '$loggerServer';
import { toRoutePathFromRouteId, toRoutePathFromURL } from '$router';

const allowExtensionCors = true;

// The `client` app (Firebase Hosting, no server of its own) forwards its
// browser logger's HTTP sink here cross-origin — see
// packages/shared/logger/src/lib/logger_browser.ts and
// apps/frontend/client's PUBLIC_LOG_ENDPOINT. Any first-party
// *.bearlysleeping.com origin is allowed for this endpoint only (never a
// wildcard, and no credentials — this route needs none). The origin check
// lives in packages/backend/svelte-kit/src/lib/hooks_helpers.ts
// (isAikamiWebOrigin), shared with tests.

// App Check is enabled via the shared predicate in
// packages/frontend/configs/environment.ts (isAppCheckEnabled) — the same
// rules the client uses: not explicitly disabled (PUBLIC_DISABLE_APP_CHECK
// = 1 or true), a real reCAPTCHA site key is configured, and the mode is
// production. Aligning server and client prevents the hub from demanding
// tokens the client cannot produce (e.g. non-production modes or no
// recaptcha key).
const enforceAppCheck = isAppCheckEnabled();

// Browser log ingestion must never be gated on App Check — the logger's
// HTTP sink is fire-and-forget and cannot attach an App Check token.
const appCheckExcludePaths = ['/api/internal_logging'];

// C-418 Feature D: hub-hosted auth endpoints that replaced the Firebase
// Callable Functions `auth` / `poll_device_handoff`. The client app calls
// them cross-origin in staging/production (the client runs on Firebase
// Hosting, the hub on Cloud Run), so CORS is allowed for first-party
// *.bearlysleeping.com origins on exactly these two paths — never a
// wildcard, and never on any other /api route. Credentials are NOT
// included: the auth route authenticates via the Authorization header
// (Firebase ID token), not cookies.
const clientAuthApiPaths = ['/api/auth/action', '/api/auth/poll-device-handoff'];

const isClientAuthPath = (pathname: string): boolean => clientAuthApiPaths.includes(pathname);

// Register the SSR stdout sink once at module boot.
// Logs are written to stdout/stderr (Cloud Run console).
logger.addSink(new SSRLogSink(logContextStore));

// Eagerly trigger the lazy SSR logger to load BEFORE the first request.
void logger.write({ logLevel: 'DEBUG', logType: 'debug', message: 'ssr-logger-init' });

/**
 * SvelteKit handleError hook: log the error with SSR context (session,
 * user, IP, route) and return a safe error payload.
 */
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

  // ── 2. Auth: resolve user session from the __session cookie ──
  // The session value inside the session cookie is set by the Elysia
  // internal API (POST /api/auth/session).
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

  // ── 7. API route: method guard + extension/logging CORS ──
  if (pathname.startsWith('/api/')) {
    const method = request.method;
    // Only /api/internal_logging gets the *.bearlysleeping.com allowance —
    // scoped narrowly so other /api/ routes don't inherit broadened CORS.
    const isLoggingEndpoint = isPathExcluded(pathname, appCheckExcludePaths);
    const isClientAuthRoute = isClientAuthPath(pathname);

    if (method === 'OPTIONS' && (allowExtensionCors || isLoggingEndpoint || isClientAuthRoute)) {
      const origin = request.headers.get('origin');
      // Only answer preflight for trusted origins — never fall back to a
      // wildcard, and omit CORS headers for disallowed origins.
      const isExtensionOrigin = origin?.startsWith('chrome-extension://') || origin === 'null';
      const isLoggingOrigin = isLoggingEndpoint && isAikamiWebOrigin(origin);
      const isClientAuthOrigin = isClientAuthRoute && isAikamiWebOrigin(origin);
      const preflightHeaders = new Headers();
      if (origin && (isExtensionOrigin || isLoggingOrigin || isClientAuthOrigin)) {
        preflightHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        preflightHeaders.set(
          'Access-Control-Allow-Headers',
          isClientAuthOrigin
            ? 'Content-Type, Authorization, X-Firebase-AppCheck'
            : 'Content-Type, Cookie, x-aikami-session',
        );
        preflightHeaders.set('Access-Control-Allow-Origin', origin);
        // The logging endpoint needs no cookies/credentials — only grant
        // Allow-Credentials for the extension case, which does.
        if (isExtensionOrigin) {
          preflightHeaders.set('Access-Control-Allow-Credentials', 'true');
        }
      }
      return new Response(null, { status: 204, headers: preflightHeaders });
    }

    const guardResponse = apiMethodGuard(pathname, method);
    if (guardResponse) {
      return guardResponse;
    }

    // ── App Check verification (skip OPTIONS + excluded paths) ──
    // Exclude /api/internal_logging only when the pathname is EXACTLY that
    // endpoint or begins with it followed by '/' — never a bare unbounded
    // startsWith() so similarly prefixed routes stay protected.
    if (enforceAppCheck && method !== 'OPTIONS' && !isLoggingEndpoint) {
      try {
        await verifyAppCheck(request);
      } catch {
        return new Response('Unauthorized: Invalid App Check token', { status: 401 });
      }
    }

    const response = await logContextStore.run(logContext, () => resolve(event));

    // Attach CORS headers for extension origins and (logging endpoint only)
    // first-party *.bearlysleeping.com origins.
    const origin = request.headers.get('origin');
    if (allowExtensionCors && (origin?.startsWith('chrome-extension://') || origin === 'null')) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    } else if (isLoggingEndpoint && isAikamiWebOrigin(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    } else if (isClientAuthRoute && isAikamiWebOrigin(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
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

/** Resolve the route path from the SvelteKit route id, falling back to the URL. */
const resolveRoute = (event: Parameters<Handle>[0]['event']) => {
  const routeId = event.route.id;
  if (routeId) {
    return toRoutePathFromRouteId(routeId);
  }
  return toRoutePathFromURL(event.url);
};
