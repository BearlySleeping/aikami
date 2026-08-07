// apps/frontend/hub/src/lib/server/api/index.ts
//
// Internal API service — Elysia + TypeBox.
// All routes are prefixed with `/api` and mounted via the SvelteKit
// catch-all route (src/routes/api/[...slugs]/+server.ts).
// The client consumes this server with the Eden treaty client
// (src/lib/client/services/api/internal.svelte.ts).

import { sessionAge } from '@aikami/backend/svelte-kit/cookies.ts';
import { createSessionCookie, verifyIdToken } from '@aikami/backend/utils/auth.ts';
import { AUTH_COOKIE_NAME } from '@aikami/constants';
import { Elysia, t } from 'elysia';
import { logger } from '$logger';

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

export const app = new Elysia({ prefix: '/api' }).post('/auth/session', handleSession, {
  body: sessionRequestSchema,
  response: t.Null(),
});

export type App = typeof app;
