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

import { accounts, deviceCodes, sessions, users, verifications } from '@aikami/backend-database';
import type { UserSessionData } from '@aikami/types';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins/bearer';
import { deviceAuthorization } from 'better-auth/plugins/device-authorization';

/** The Better Auth tables, keyed by the singular model names the adapter expects. */
export const betterAuthSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  deviceCode: deviceCodes,
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
  /**
   * Root domain for cross-subdomain session cookies (e.g. `bearlysleeping.com`)
   * so the client (`aikami.`) and hub (`hub.`) share one SSO session. Omit to
   * keep cookies scoped to the exact host (single-app deployments).
   */
  cookieDomain?: string;
};

/**
 * Origins the Tauri desktop webview presents on its requests: `tauri://localhost`
 * on Linux/macOS, `http(s)://tauri.localhost` on Windows. Listed explicitly
 * rather than as a `localhost` wildcard so a plain browser on localhost gains
 * nothing from it.
 */
const TAURI_WEBVIEW_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
] as const;

/**
 * Create a Better Auth instance bound to the given Drizzle sqlite database.
 *
 * Email/password is enabled (Open Question 1 resolved: keep it) and Google
 * OAuth is configured when credentials are supplied. The returned `auth`
 * exposes `.handler` (a fetch handler) to mount at `/api/auth/*` and
 * `.api.getSession()` for server-side session checks.
 */
export const createBetterAuth = (db: object, env: BetterAuthEnv) => {
  // When cookieDomain is set (production cross-subdomain SSO) and no explicit
  // trustedOrigins are configured, default to allowing all subdomains of the
  // cookie domain (e.g. https://*.bearlysleeping.com).
  const defaultTrustedOrigins =
    env.cookieDomain && (!env.trustedOrigins || env.trustedOrigins.length === 0)
      ? [`https://*.${env.cookieDomain}`]
      : [];

  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: betterAuthSchema }),
    baseURL: env.baseURL,
    secret: env.secret,
    // The desktop webview's origin is appended to every configuration, not just
    // the defaults: the Tauri client exists in all deployments, and Better
    // Auth's origin check rejects state-changing POSTs from an untrusted origin
    // with a bare "Invalid origin". GET /get-session is NOT origin-checked, so
    // omitting these fails in a confusing half-working way — the desktop app
    // reads its session fine and only dies when it starts the device flow.
    // Mirrors isTauriWebviewOrigin in @aikami/backend-svelte-kit, which grants
    // the same origins CORS on /api/auth/* — both layers must agree or the
    // request is rejected at one of them.
    trustedOrigins: [...(env.trustedOrigins ?? defaultTrustedOrigins), ...TAURI_WEBVIEW_ORIGINS],
    // SSO across the client (`aikami.bearlysleeping.com`) and hub
    // (`hub.bearlysleeping.com`): scope the session cookie to the shared root
    // domain so both apps read the same session.
    ...(env.cookieDomain
      ? {
          advanced: {
            crossSubDomainCookies: {
              enabled: true,
              domain: env.cookieDomain,
            },
          },
        }
      : {}),
    emailAndPassword: {
      enabled: true,
    },
    // C-426 AC-5: device-authorization flow for the Tauri desktop client (it
    // cannot OAuth-popup). The client requests a code, the user approves it on
    // the /link page, and the client polls for a session token.
    //
    // `bearer` is what makes that token usable. The desktop webview's origin is
    // `tauri://localhost`, so every hub request from it is cross-SITE: the
    // session cookie (SameSite=Lax, domain bearlysleeping.com) is never sent,
    // and the webview cannot write a cookie for another domain either. Bearer
    // lets the client present the same session token as an Authorization header
    // instead. Browser clients are unaffected — the plugin only engages when an
    // Authorization header is present, and falls back to cookies otherwise.
    plugins: [deviceAuthorization(), bearer()],
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
};

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

/**
 * Map a Better Auth user to the app's `UserSessionData` shape (the type the
 * hub's `locals.userSession` and the client's `CurrentUser` are built on).
 *
 * The D1 `users` table has no `role` column, so every user is `member` for
 * now — the hub is a community app, not restricted to super admins.
 */
export const toUserSessionData = (
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  },
  provider?: string | null,
): UserSessionData => ({
  id: user.id,
  email: user.email ?? undefined,
  displayName: user.name ?? undefined,
  photoURL: user.image ?? undefined,
  userRole: 'member',
  // Use the provided sign-in provider if known (google, email), otherwise default to email.
  currentSignInProvider: (provider as UserSessionData['currentSignInProvider']) ?? 'email',
});
