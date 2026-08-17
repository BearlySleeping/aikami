// apps/frontend/hub/src/lib/server/api/index.ts
//
// Internal API service — Elysia + TypeBox.
// All routes are prefixed with `/api` and mounted via the SvelteKit
// catch-all route (src/routes/api/[...slugs]/+server.ts).
// The client consumes this server with the Eden treaty client
// (src/lib/client/services/api/internal.svelte.ts).

import { handleAuthEndpoint, pollDeviceHandoff } from '@aikami/backend/auth';
import { sessionAge } from '@aikami/backend/svelte-kit/cookies.ts';
import { createSessionCookie, verifyIdToken } from '@aikami/backend/utils/auth.ts';
import { AUTH_COOKIE_NAME } from '@aikami/constants';
import { AssetStatsSchema, CategoryStatsSchema } from '@aikami/schemas';
import { Elysia, t } from 'elysia';
import { logger } from '$logger';
import { handleAsk } from './ask.ts';
import { handleCatalogStats } from './catalog_stats.ts';
import { handleDbHealth } from './health_db.ts';

// ─── Session cookie helpers ──────────────────────────────────────────
// Mirrors the aikami session store shape: the `__session` cookie
// (AUTH_COOKIE_NAME, see @aikami/constants) holds a JSON blob
// `{ session: <firebase session cookie jwt>, ... }`
// (see @aikami/backend/svelte-kit/cookies.ts getStore/saveStore).
//
// 🔴 The blob is SHARED with SvelteKit's hooks (manageSessionId stores the
// `aikamiSessionId` key there). Writes MUST merge the existing store instead
// of replacing the whole blob, otherwise the next request re-sets
// `aikamiSessionId` and its Set-Cookie header clobbers the session.

const SESSION_COOKIE_MAX_AGE_SECONDS = sessionAge;

/** Decode and parse the existing `__session` blob from a request. */
const parseExistingStore = (cookieValue: unknown): Record<string, string> => {
  if (typeof cookieValue !== 'string' || !cookieValue) {
    return {};
  }
  try {
    const parsed = JSON.parse(cookieValue) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, string>;
    }
  } catch {
    // Not a JSON blob — treat as empty (a legacy raw-JWT cookie).
  }
  return {};
};

const serializeSessionCookie = (value: string, existingStore: Record<string, string>): string => {
  const store = JSON.stringify({ ...existingStore, session: value });
  return [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(store)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
    'Secure',
  ].join('; ');
};

const clearSessionCookieHeader = (existingStore: Record<string, string>): string => {
  const { session: _session, ...rest } = existingStore;
  const store = JSON.stringify(rest);
  return [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(store)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
    'Secure',
  ].join('; ');
};

// ─── Schemas (TypeBox) ───────────────────────────────────────────────

const sessionRequestSchema = t.Object({
  token: t.Optional(t.String()),
});

// ─── Auth action + device handoff (C-418 Feature D) ───────────────────────
//
// These two routes replace the Firebase Callable Functions `auth` and
// `poll_device_handoff` (apps/backend/firebase/src/controllers/callable/*).
// Transport changes only — the same shared handlers are invoked, and the
// same request/response shapes are preserved.

/**
 * POST /api/auth/action
 *
 * Multiplexed auth endpoint, formerly the `auth` callable. The caller's
 * Firebase ID token is verified from the Authorization header; an anonymous
 * caller (no header) reaches `handleAuthEndpoint` with no currentUser, which
 * yields the same `unauthorized` result the callable produced for missing
 * auth context. Error mapping follows the callable's `toAppError` taxonomy.
 */
const authActionRequestSchema = t.Object({
  type: t.String(),
  payload: t.Unknown(),
});

const authErrorSchema = t.Object({
  errorType: t.String(),
  errorMessage: t.String(),
});

const AUTH_ERROR_STATUS: Record<string, number> = {
  'invalid-argument': 400,
  'failed-precondition': 400,
  unauthorized: 401,
  'not-found': 404,
  'already-exists': 409,
  'resource-exhausted': 429,
  internal: 500,
};

const extractBearerToken = (header: string | undefined): string | undefined => {
  if (!header) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
};

const handleAuthAction = async ({
  body,
  headers,
  set,
}: {
  body: { type: string; payload: unknown };
  headers: { authorization?: string };
  set: { status: number };
}) => {
  if (!body || typeof body.type !== 'string') {
    set.status = 400;
    return { errorType: 'invalid-argument', errorMessage: 'Missing or invalid type field' };
  }

  const idToken = extractBearerToken(headers.authorization);
  let currentUser: { id: string; email?: string } | undefined;
  if (idToken) {
    try {
      const decoded = await verifyIdToken(idToken);
      currentUser = { id: decoded.uid, email: decoded.email ?? undefined };
    } catch {
      logger.warn('/api/auth/action: invalid id token');
      set.status = 401;
      return { errorType: 'unauthorized', errorMessage: 'Invalid or expired session token' };
    }
  }

  logger.debug('/api/auth/action', { type: body.type, authenticated: !!currentUser });

  try {
    return await handleAuthEndpoint({
      currentUser,
      payload: body.payload,
      type: body.type as never,
    });
  } catch (error) {
    // toAppError (packages/shared/utils/src/lib/common/error.ts) stores the
    // taxonomy in `error.cause`, not on the top-level Error — read it from
    // there so the hub returns the same `unauthorized` / `invalid-argument`
    // codes the Callable surfaced (C-418 Feature D parity).
    const err = error as { cause?: { errorType?: string }; message?: string };
    const errorType = err.cause?.errorType ?? 'internal';
    const errorMessage = err.message ?? 'Unknown error';
    set.status = AUTH_ERROR_STATUS[errorType] ?? 500;
    logger.warn('/api/auth/action:failed', {
      type: body.type,
      errorType,
      errorMessage,
    });
    return { errorType, errorMessage };
  }
};

/**
 * POST /api/auth/poll-device-handoff
 *
 * Unauthenticated single-use poll, formerly the `poll_device_handoff`
 * callable. Carries over the per-instance token bucket (App Check is
 * disabled for the Tauri client, so rate limiting is the abuse defense).
 */
const deviceHandoffRequestSchema = t.Object({
  code: t.String(),
});

const deviceHandoffResponseSchema = t.Object({
  customFirebaseSignInToken: t.Union([t.String(), t.Null()]),
});

const POLL_RATE_MAX_TOKENS = 30; // burst allowance
const POLL_RATE_REFILL_PER_SECOND = 2; // steady-state 2 req/s
let pollTokens = POLL_RATE_MAX_TOKENS;
let pollLastRefill = Date.now();

const tryConsumePollToken = (): boolean => {
  const now = Date.now();
  pollTokens = Math.min(
    POLL_RATE_MAX_TOKENS,
    pollTokens + ((now - pollLastRefill) / 1000) * POLL_RATE_REFILL_PER_SECOND,
  );
  pollLastRefill = now;
  if (pollTokens >= 1) {
    pollTokens -= 1;
    return true;
  }
  return false;
};

const handlePollDeviceHandoff = async ({
  body,
  set,
}: {
  body: { code: string };
  set: { status: number };
}) => {
  if (!body || typeof body.code !== 'string') {
    logger.warn('/api/auth/poll-device-handoff: invalid request — missing code');
    set.status = 400;
    return { errorType: 'invalid-argument', errorMessage: 'Missing or invalid code field' };
  }

  if (!tryConsumePollToken()) {
    logger.warn('/api/auth/poll-device-handoff: rate limited');
    set.status = 429;
    return {
      errorType: 'resource-exhausted',
      errorMessage: 'Too many polling requests — slow down and retry.',
    };
  }

  return await pollDeviceHandoff({ code: body.code });
};

// ─── Handlers ────────────────────────────────────────────────────────

/**
 * POST /api/auth/session
 *
 * Syncs the Firebase ID token with the SSR session cookie.
 * - No token  → clears the session cookie.
 * - Token     → verifies it and sets a Firebase session cookie. Any
 *   authenticated user gets a session — the hub is a community app, not
 *   restricted to super admins.
 */
const handleSession = async ({
  body,
  cookie,
  set,
}: {
  body: { token?: string };
  cookie: Record<string, { value: unknown }>;
  set: { headers: Record<string, string | number> };
}) => {
  const { token } = body;
  logger.debug('/api/auth/session', { hasToken: !!token });

  // Preserve the existing store keys (e.g. aikamiSessionId) so the blob is
  // never replaced wholesale — see the cookie helper comment above.
  const existingStore = parseExistingStore(cookie[AUTH_COOKIE_NAME]?.value);

  if (!token) {
    set.headers['set-cookie'] = clearSessionCookieHeader(existingStore);
    return null;
  }

  try {
    // Verify the ID token first, then enforce login freshness before
    // minting a session cookie.
    const decodedIdToken = await verifyIdToken(token);

    if (!decodedIdToken.email) {
      logger.warn('/api/auth/session: user has no email — rejecting session', {
        uid: decodedIdToken.uid,
      });
      set.headers['set-cookie'] = clearSessionCookieHeader(existingStore);
      return null;
    }

    // Login-freshness policy: a session cookie is only minted from a token
    // whose auth_time is within the session lifetime, so an old login cannot
    // bootstrap a fresh session.
    const authTimeMs = (decodedIdToken.auth_time ?? 0) * 1000;
    if (!decodedIdToken.auth_time || Date.now() - authTimeMs > sessionAge * 1000) {
      logger.warn('/api/auth/session: login too old — rejecting session', {
        uid: decodedIdToken.uid,
      });
      set.headers['set-cookie'] = clearSessionCookieHeader(existingStore);
      return null;
    }

    const session = await createSessionCookie({ token, expiresIn: sessionAge * 1000 });
    set.headers['set-cookie'] = serializeSessionCookie(session, existingStore);
  } catch (error) {
    // Invalid / revoked / expired token — never leave a stale session.
    logger.warn('/api/auth/session: failed to establish session', { error });
    set.headers['set-cookie'] = clearSessionCookieHeader(existingStore);
  }

  return null;
};

// ─── App ─────────────────────────────────────────────────────────────

// GET /api/health/db — database reachability + version (C-394 AC-1).
// Unauthenticated on purpose; reports host only, never credentials.
const dbHealthResponseSchema = t.Union([
  t.Object({
    status: t.Literal('ok'),
    databaseVersion: t.String(),
    host: t.String(),
    roundTripMs: t.Number(),
  }),
  t.Object({
    status: t.Literal('unconfigured'),
  }),
  t.Object({
    status: t.Literal('unreachable'),
    host: t.Optional(t.String()),
  }),
]);

// GET /api/catalog/stats — streamed, Postgres-backed placeholder stats
// (C-396 AC-4). Public on purpose: anonymous visitors see exactly what
// signed-in visitors see on the catalog. Unconfigured/unreachable database
// resolves to `null` — never a 500.
const catalogStatsResponseSchema = t.Union([CategoryStatsSchema, AssetStatsSchema, t.Null()]);

// POST /api/ask — the one route in this file meant for a THIRD-PARTY origin
// (the static landing page, apps/frontend/site) rather than the hub's own
// client — see hooks.server.ts's narrowly-scoped CORS allowance for it.
const askRequestSchema = t.Object({ question: t.String({ minLength: 1, maxLength: 2000 }) });
const askResponseSchema = t.Union([
  t.Object({ answer: t.String() }),
  t.Object({
    error: t.Union([t.Literal('unconfigured'), t.Literal('rate_limited'), t.Literal('failed')]),
  }),
]);

export const app = new Elysia({ prefix: '/api' })
  .post('/auth/session', handleSession, {
    body: sessionRequestSchema,
    response: t.Null(),
  })
  .post('/auth/action', handleAuthAction, {
    body: authActionRequestSchema,
    response: t.Union([authErrorSchema, t.Unknown()]),
  })
  .post('/auth/poll-device-handoff', handlePollDeviceHandoff, {
    body: deviceHandoffRequestSchema,
    response: deviceHandoffResponseSchema,
  })
  .get('/health/db', handleDbHealth, {
    response: dbHealthResponseSchema,
  })
  .get('/catalog/stats', handleCatalogStats, {
    response: catalogStatsResponseSchema,
  })
  .post('/ask', handleAsk, {
    body: askRequestSchema,
    response: askResponseSchema,
  });

export type App = typeof app;
