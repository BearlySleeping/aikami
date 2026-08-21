// apps/frontend/hub/src/lib/server/api/better_auth.ts
//
// C-426 AC-4: wires the shared Better Auth instance (packages/backend/auth)
// to the hub's Cloudflare D1 database and exposes it to the Elysia app.
//
// The D1 database is only available per-request via `platform.env.DB` (the
// Worker binding). The Elysia app is a module-level singleton, so the env is
// injected per-request by the catch-all route (src/routes/api/[...slugs]/+server.ts)
// via `setBetterAuthEnv`, and the Better Auth instance is created lazily and
// cached. When no D1 env is present (e.g. the hub still running on Cloud Run
// during the migration window) `getBetterAuth()` returns undefined and the
// mounted handler responds 503 — the existing Firebase auth path keeps
// serving until the cutover completes.

import { createBetterAuth } from '@aikami/backend/auth';
import { d1 } from '@aikami/backend-database';
import { drizzle } from 'drizzle-orm/d1';
import { env } from '$env/dynamic/private';

type BetterAuthEnv = {
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  DB: import('@cloudflare/workers-types').D1Database;
};

let _env: BetterAuthEnv | undefined;
let _auth: ReturnType<typeof createBetterAuth> | undefined;

/** Inject the per-request Worker env (called by the catch-all route). */
export const setBetterAuthEnv = (envValue: BetterAuthEnv | undefined): void => {
  _env = envValue;
  // A changed env invalidates the cached instance (e.g. test reset).
  _auth = undefined;
};

/** The Better Auth instance bound to D1, or undefined when D1 is unavailable. */
export const getBetterAuth = (): ReturnType<typeof createBetterAuth> | undefined => {
  if (!_env) {
    return undefined;
  }
  if (!_auth) {
    const baseURL = env.BETTER_AUTH_URL;
    const secret = env.BETTER_AUTH_SECRET;
    // Never fall back to a hardcoded secret or a localhost base URL in
    // production — a missing secret would let anyone forge sessions. The
    // dev-only fallbacks are gated behind an explicit non-production check.
    const isProduction = baseURL?.includes('bearlysleeping.com') ?? false;
    if (isProduction && (!baseURL || !secret)) {
      throw new Error('BETTER_AUTH_URL and BETTER_AUTH_SECRET are required in production');
    }
    const db = drizzle(_env.DB, { schema: d1 });
    _auth = createBetterAuth(db, {
      baseURL: baseURL ?? 'http://localhost:5173',
      secret: secret ?? 'dev-secret-not-for-production',
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    });
  }
  return _auth;
};
