// packages/backend/auth/src/lib/better_auth.ts
//
// C-426 AC-2/AC-4: Better Auth instance for the hub, backed by Cloudflare D1
// (via the Drizzle sqlite adapter). Replaces Firebase Auth for hub + client
// sign-in.
//
// The instance is created by a factory so the caller supplies the Drizzle
// database instance — in the Worker that is `drizzle(env.DB, { schema })`
// from `drizzle-orm/d1`; in local tests it is an in-memory libsql database.
// Google client secret is a Wrangler secret, never an env file (the Worker
// runtime does not read `.env` at request time).

import { d1 } from '@aikami/backend-database';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

const { users, sessions, accounts, verifications } = d1;

/** The Better Auth tables, keyed by the singular model names the adapter expects. */
export const betterAuthSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
} as const;

export type BetterAuthEnv = {
  /** Public base URL of the hub (e.g. https://hub.bearlysleeping.com). */
  baseURL: string;
  /** Better Auth session secret (Wrangler secret in production). */
  secret: string;
  /** Google OAuth client id (Wrangler secret in production). */
  googleClientId?: string;
  /** Google OAuth client secret (Wrangler secret in production). */
  googleClientSecret?: string;
  /** Extra trusted origins for cross-origin session cookies. */
  trustedOrigins?: string[];
};

/**
 * Create a Better Auth instance bound to the given Drizzle sqlite database.
 *
 * Email/password is enabled (Open Question 1 resolved: keep it) and Google
 * OAuth is configured when credentials are supplied. The returned `auth`
 * exposes `.handler` (a fetch handler) to mount at `/api/auth/*` and
 * `.api.getSession()` for server-side session checks.
 */
export const createBetterAuth = (db: Record<string, unknown>, env: BetterAuthEnv) =>
  betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: betterAuthSchema }),
    baseURL: env.baseURL,
    secret: env.secret,
    trustedOrigins: env.trustedOrigins ?? [],
    emailAndPassword: {
      enabled: true,
    },
    // Only configure Google OAuth when BOTH credentials are present — Better
    // Auth 1.7.1 treats a provider with empty-string credentials as configured
    // and throws CLIENT_ID_AND_SECRET_REQUIRED when the flow starts.
    ...(env.googleClientId && env.googleClientSecret
      ? {
          socialProviders: {
            google: {
              clientId: env.googleClientId,
              clientSecret: env.googleClientSecret,
            },
          },
        }
      : {}),
  });

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
