// packages/backend/svelte-kit/src/lib/hooks_helpers.ts

import { getCookie, setCookie } from '@aikami/backend/svelte-kit/cookies.ts';
import type { DeviceData } from '@aikami/types';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Detect device type from request headers.
 * Uses Client Hints (sec-ch-ua-mobile) for Chrome, regex fallback for others.
 */
export function detectDevice(request: Request): DeviceData {
  const userAgent = request.headers.get('user-agent');
  const secChUaMobile = request.headers.get('sec-ch-ua-mobile');
  const mobileRegex =
    /Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i;
  const isMobile =
    secChUaMobile !== null ? secChUaMobile === '?1' : mobileRegex.test(userAgent ?? '');
  return {
    type: isMobile ? 'smartphone' : 'desktop',
    os: { name: 'unknown', version: '' },
    browser: { type: 'browser', name: 'unknown', version: '' },
  };
}

/**
 * Guard /api/ routes to only accept allowed methods.
 * Returns a 405 Response if the method is not allowed, otherwise undefined.
 */
export function apiMethodGuard(
  pathname: string,
  method: string,
  corsOrigin?: string,
): Response | undefined {
  if (!pathname.startsWith('/api/')) {
    return undefined;
  }

  const allowed = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];
  if (!allowed.includes(method)) {
    return new Response('Method Not Allowed', {
      headers: {
        'Access-Control-Allow-Headers':
          'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Origin': corsOrigin ?? '*',
        // biome-ignore lint/style/useNamingConvention: standard HTTP header name
        Allow: 'GET, POST, PATCH, DELETE, OPTIONS',
      },
      status: 405,
    });
  }

  return undefined;
}

/**
 * Extract client IP from request headers.
 */
export function getClientIp(
  request: Request,
  getClientAddress?: () => string | undefined,
): string | undefined {
  return (
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    (() => {
      try {
        return getClientAddress?.();
      } catch {
        return undefined;
      }
    })() ??
    undefined
  );
}

/**
 * Log context shape for SSR request logging.
 * Mirrors the shape expected by AsyncLocalStorage-bound log sinks.
 */
export type SSRLogContext = {
  device?: DeviceData;
  ip?: string;
  route?: string;
  sessionId?: string;
  source?: string;
  userAgent?: string;
  userId?: string;
};

/**
 * Build a log context object for SSR log entries.
 */
export function buildLogContext(params: {
  device?: DeviceData;
  ip?: string;
  route?: string;
  sessionId?: string;
  source?: string;
  userAgent?: string;
  userId?: string;
}): SSRLogContext {
  return {
    device: params.device,
    ip: params.ip,
    route: params.route,
    sessionId: params.sessionId,
    source: params.source ?? 'ssr',
    userAgent: params.userAgent,
    userId: params.userId,
  };
}

/**
 * Manage the aikamiSessionId cookie: reuse existing or generate a new one.
 * Returns the session ID.
 */
export function manageSessionId(options: {
  cookies: import('@sveltejs/kit').Cookies;
  request: Request;
  url: URL;
}): string {
  let sessionId = getCookie('aikamiSessionId', options);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    setCookie('aikamiSessionId', sessionId, options);
  }
  return sessionId;
}

/**
 * Rewrite the event URL to use the original host from Firebase Hosting proxy.
 * Firebase Hosting sets X-Forwarded-Host and X-Forwarded-Proto when proxying
 * to Cloud Run. Without this, SSR renders with the Cloud Run URL causing
 * hydration mismatches with the public Firebase Hosting URL.
 */
export const rewriteForwardedHost = (event: RequestEvent): RequestEvent => {
  const forwardedHost = event.request.headers.get('x-forwarded-host');
  if (!forwardedHost) {
    return event;
  }
  const forwardedProto = event.request.headers.get('x-forwarded-proto') ?? 'https';
  const originalUrl = new URL(event.request.url);
  if (originalUrl.host === forwardedHost && originalUrl.protocol === `${forwardedProto}:`) {
    return event;
  }
  originalUrl.host = forwardedHost;
  originalUrl.protocol = forwardedProto;
  return {
    ...event,
    url: originalUrl,
    request: new Request(originalUrl.toString(), event.request),
  };
};

// ── Log-ingestion / CORS helpers ─────────────────────────────────────────

/**
 * Matches a pathname against a list of excluded paths. A path matches when
 * it is exactly an excluded path or starts with it followed by '/'
 * (never a bare unbounded startsWith(), so similarly prefixed routes stay
 * protected).
 */
export const isPathExcluded = (pathname: string, excludedPaths: string[]): boolean =>
  excludedPaths.some(
    (excludedPath) => pathname === excludedPath || pathname.startsWith(`${excludedPath}/`),
  );

/**
 * Matches first-party web origins: `https://*.bearlysleeping.com`
 * (e.g. https://aikami.bearlysleeping.com, https://hub.stg.bearlysleeping.com).
 * HTTPS only — `http://` and cross-site lookalikes (evil.com,
 * bearlysleeping.com.evil.com) fail.
 */
const aikamiWebOriginPattern = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.bearlysleeping\.com$/i;

/**
 * Whether an Origin header value is a trusted first-party Aikami web
 * origin. Returns false for null/undefined/empty values. Doubles as a type
 * predicate so callers get `origin: string` narrowed in the true branch.
 */
export const isAikamiWebOrigin = (origin: string | null | undefined): origin is string =>
  !!origin && aikamiWebOriginPattern.test(origin);

const tauriWebviewOriginPattern = /^(tauri|https?):\/\/(localhost|tauri\.localhost)$/i;

/**
 * Whether an Origin header value is the Tauri desktop webview origin
 * (`tauri://localhost`, `http(s)://tauri.localhost`). The webview is not a
 * first-party browser origin, but the desktop client (apps/frontend/client)
 * calls the hub's client-auth routes from inside it — C-418 Feature D.
 * Returns false for null/undefined/empty values.
 */
export const isTauriWebviewOrigin = (origin: string | null | undefined): origin is string =>
  !!origin && tauriWebviewOriginPattern.test(origin);

/**
 * Sanitize the `app` tag from a browser-log-ingestion request body.
 * Trims surrounding whitespace, then returns the tag when it is a non-empty
 * string of at most 64 characters; otherwise (or for whitespace-only input)
 * returns undefined (the tag is omitted entirely).
 */
export const sanitizeLogAppTag = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : undefined;
};
