// apps/frontend/hub/src/hooks.server.ts

import { getCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import {
  apiMethodGuard,
  buildLogContext,
  detectDevice,
  getClientIp,
  isAikamiWebOrigin,
  isPathExcluded,
  isTauriWebviewOrigin,
  manageSessionId,
  rewriteForwardedHost,
} from '@aikami/backend/svelte-kit/hooks_helpers';
import { SSRLogSink } from '@aikami/backend/svelte-kit/log_sink';
import { toUserSessionData } from '@aikami/backend-auth/better-auth';
import type { LogContext, UserSessionData } from '@aikami/types';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getBetterAuth, setBetterAuthEnv } from '$lib/server/api/better_auth.ts';
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

// App Check enforcement was removed from the hub (C-426): it was the last
// remaining `firebase-admin` dependency in the Worker bundle, and the hub's
// sensitive endpoints are now session-gated by Better Auth. The client may
// still attach App Check tokens; the hub simply no longer verifies them.

// Browser log ingestion must never be gated on App Check — the logger's
// HTTP sink is fire-and-forget and cannot attach an App Check token.
// /api/ask is also excluded: its caller (apps/frontend/site, a static
// Firebase Hosting page) has no Firebase app / App Check config of its own.

// /api/ask's cross-origin caller is specifically the landing page
// (production: bearlysleeping.com — the bare apex, which isAikamiWebOrigin's
// *.bearlysleeping.com pattern deliberately does NOT match; staging:
// stg.bearlysleeping.com) plus localhost for local dev. Narrower than
// isAikamiWebOrigin on purpose — every other *.bearlysleeping.com subdomain
// (docs, client, hub itself) has no reason to call this endpoint.
const askOriginPattern = /^https:\/\/(stg\.)?bearlysleeping\.com$|^http:\/\/localhost(:\d+)?$/i;
const isAskOrigin = (origin: string | null | undefined): origin is string =>
  !!origin && askOriginPattern.test(origin);

// C-426 AC-4: Better Auth auth endpoints under /api/auth/* (sign-in/email,
// get-session, sign-out, …). The client app calls them cross-origin in
// staging/production (the client runs on Firebase Hosting, the hub on a
// Cloudflare Worker), so CORS is allowed for first-party *.bearlysleeping.com
// origins and the Tauri webview origin on exactly these paths — never a
// wildcard, and never on any other /api route. Credentials ARE included
// (Better Auth uses a session cookie).
//
// These paths are ALSO excluded from App Check enforcement: the client's
// Better Auth transport attaches no App Check token, and enforcement must not
// depend on both deployments sharing the same PUBLIC_DISABLE_APP_CHECK/
// recaptcha configuration — an asymmetry would silently break auth with a
// misleading 401.
const isClientAuthPath = (pathname: string): boolean =>
  pathname === '/api/auth' || pathname.startsWith('/api/auth/');

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

  // ── 2. Auth: resolve user session from the Better Auth session cookie ──
  // The session cookie is set by Better Auth (mounted at /api/auth/*). The
  // D1 binding is only available per-request via `platform.env`, so inject it
  // before resolving the session. When D1 is unavailable (e.g. local dev
  // without a Worker platform) the user is simply unauthenticated.
  const platformEnv = event.platform?.env;
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  setBetterAuthEnv(platformEnv ? { DB: platformEnv.DB } : undefined);
  const auth = getBetterAuth();
  let userSession: UserSessionData | undefined;
  if (auth) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user) {
      userSession = toUserSessionData(session.user);
    }
  }
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

  // ── 7. API route: method guard + extension/logging/ask CORS ──
  if (pathname.startsWith('/api/')) {
    const method = request.method;
    // Path-exact matches only (isPathExcluded), never a bare unbounded
    // startsWith(), so similarly prefixed routes stay protected.
    const isLoggingEndpoint = isPathExcluded(pathname, ['/api/internal_logging']);
    const isAskEndpoint = isPathExcluded(pathname, ['/api/ask']);
    const isClientAuthRoute = isClientAuthPath(pathname);

    if (
      method === 'OPTIONS' &&
      (allowExtensionCors || isLoggingEndpoint || isAskEndpoint || isClientAuthRoute)
    ) {
      const origin = request.headers.get('origin');
      // Only answer preflight for trusted origins — never fall back to a
      // wildcard, and omit CORS headers for disallowed origins.
      const isExtensionOrigin = origin?.startsWith('chrome-extension://') || origin === 'null';
      const isLoggingOrigin = isLoggingEndpoint && isAikamiWebOrigin(origin);
      const isAskOriginMatch = isAskEndpoint && isAskOrigin(origin);
      // The Better Auth paths are reached from the Tauri desktop webview
      // (tauri://localhost / http(s)://tauri.localhost) as well as first-party
      // browser origins. Scoped to exactly /api/auth/*.
      const isClientAuthOrigin =
        isClientAuthRoute && (isAikamiWebOrigin(origin) || isTauriWebviewOrigin(origin));
      const preflightHeaders = new Headers();
      if (
        origin &&
        (isExtensionOrigin || isLoggingOrigin || isAskOriginMatch || isClientAuthOrigin)
      ) {
        preflightHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        preflightHeaders.set(
          'Access-Control-Allow-Headers',
          isClientAuthOrigin ? 'Content-Type, Cookie' : 'Content-Type, Cookie, x-aikami-session',
        );
        preflightHeaders.set('Access-Control-Allow-Origin', origin);
        // Better Auth authenticates via a session cookie, so the client-auth
        // preflight must grant credentials (as must the extension case).
        if (isExtensionOrigin || isClientAuthOrigin) {
          preflightHeaders.set('Access-Control-Allow-Credentials', 'true');
        }
      }
      return new Response(null, { status: 204, headers: preflightHeaders });
    }

    const guardResponse = apiMethodGuard(pathname, method);
    if (guardResponse) {
      return guardResponse;
    }

    const response = await logContextStore.run(logContext, () => resolve(event));

    // Attach CORS headers for extension origins, logging's first-party
    // *.bearlysleeping.com origins, and ask's landing-page origins.
    const origin = request.headers.get('origin');
    if (allowExtensionCors && (origin?.startsWith('chrome-extension://') || origin === 'null')) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    } else if (isLoggingEndpoint && isAikamiWebOrigin(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    } else if (isAskEndpoint && isAskOrigin(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    } else if (isClientAuthRoute && (isAikamiWebOrigin(origin) || isTauriWebviewOrigin(origin))) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
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
