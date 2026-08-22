// apps/frontend/hub/src/lib/client/services/api/better_auth_client.ts
//
// Client-side Better Auth transport against the hub's own `/api/auth/*`
// endpoints (mounted in apps/frontend/hub/src/routes/api/auth/[...auth]/+server.ts).
// Replaces the Firebase Auth SDK path for the hub's Google sign-in.
//
// The hub is same-origin, so every request uses relative `/api/auth/*` paths
// with `credentials: 'include'` (Better Auth authenticates via a session
// cookie set by the server). Google sign-in is a full-page redirect to the
// Better Auth social handler, which sets the session cookie and redirects
// back to the callback URL (the hub's login page) — where hooks.server.ts
// resolves the session and the app routes the now-authenticated user to the
// dashboard.

import type { CurrentUser } from '@aikami/types';

/** Better Auth's session user shape (the subset we consume). */
export type BetterAuthSessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  emailVerified?: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

export type BetterAuthSession = {
  user: BetterAuthSessionUser;
  session: { id: string; expiresAt: string | Date };
};

const jsonHeaders = { 'Content-Type': 'application/json' };

/** Map a Better Auth user onto the app's `CurrentUser` shape. */
export const toCurrentUser = (user: BetterAuthSessionUser): CurrentUser => ({
  id: user.id,
  email: user.email ?? undefined,
  displayName: user.name ?? undefined,
  photoURL: user.image ?? undefined,
  currentSignInProvider: 'google',
  userRole: 'member',
  status: 'active',
  fetchedUserData: true,
});

const toAppErrorFromResponse = async (response: Response): Promise<Error> => {
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
  };
  return new Error(body.message ?? `Request failed (HTTP ${response.status})`);
};

const parseSession = async (response: Response): Promise<CurrentUser | undefined> => {
  const body = (await response.json().catch(() => null)) as BetterAuthSession | null;
  if (!body?.user) {
    return undefined;
  }
  return toCurrentUser(body.user);
};

/**
 * Resolve the current Better Auth session, or undefined when signed out.
 * A 401/404 from get-session simply means "no session" — not an error.
 */
export const getBetterAuthSession = async (): Promise<CurrentUser | undefined> => {
  const response = await fetch('/api/auth/get-session', {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 404) {
      return undefined;
    }
    throw await toAppErrorFromResponse(response);
  }
  return await parseSession(response);
};

/**
 * Google OAuth via redirect to the hub's Better Auth social sign-in. The hub
 * redirects back to `callbackURL` with the session cookie set. The callback is
 * the hub's login page — hooks.server.ts resolves the session on load and the
 * app routes the authenticated user to the dashboard.
 */
export const signInWithGoogleRedirect = (): void => {
  const callbackURL = `${window.location.origin}/login`;
  window.location.assign(
    `/api/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(callbackURL)}`,
  );
};

/** Sign out of the hub's Better Auth session. */
export const signOutBetterAuth = async (): Promise<void> => {
  const response = await fetch('/api/auth/sign-out', {
    method: 'POST',
    headers: jsonHeaders,
    credentials: 'include',
  });
  if (!response.ok) {
    throw await toAppErrorFromResponse(response);
  }
};
