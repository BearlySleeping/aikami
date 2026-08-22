// apps/frontend/client/src/lib/services/auth/better_auth_client.ts
//
// C-426 AC-5: client-side Better Auth transport against the hub's `/api/auth/*`
// endpoints (mounted in the hub Elysia app — see
// apps/frontend/hub/src/lib/server/api/index.ts). Replaces the Firebase Auth
// SDK path when `PUBLIC_AUTH_BACKEND=better-auth`.

// biome-ignore-all lint/style/useNamingConvention: Better Auth's device-authorization API uses snake_case fields (device_code, user_code, …)
//
// The hub's Better Auth instance (packages/backend/auth) owns email/password,
// Google OAuth, session cookies, and device authorization. This client talks to
// those endpoints and maps Better Auth's user shape onto the app's `CurrentUser`
// so the rest of the client is unchanged.
//
// Sessions are cookie-based, so every request uses `credentials: 'include'`
// (the hub sets `Access-Control-Allow-Credentials` for first-party origins).
//
// Device handoff (Tauri can't OAuth-popup): the client requests a device
// authorization from the hub, opens the verification URI (the /link page) in
// the system browser, and polls until the user approves — the same polling UX
// the Firebase path used, but exchanging a Better Auth session instead of a
// `customFirebaseSignInToken`.

import type { CurrentUser, FirebaseSignInProviderName, SignInProvider } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { hubApiBase } from '../api/hub_api_client';

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

/** Result of requesting a device authorization from the hub. */
export type DeviceHandoffStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** RFC 8628 polling interval (seconds) — how often to poll /device/token. */
  interval: number;
  /** Expiration (seconds from now) — deadline for completing the device auth. */
  expiresIn: number;
};

const jsonHeaders = { 'Content-Type': 'application/json' };

/** Map a Better Auth user onto the app's `CurrentUser` shape. */
export const toCurrentUser = (
  user: BetterAuthSessionUser,
  provider: SignInProvider = 'email',
): CurrentUser => ({
  id: user.id,
  email: user.email ?? undefined,
  displayName: user.name ?? undefined,
  photoURL: user.image ?? undefined,
  createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
  currentSignInProvider: provider,
  signInProviders: [provider],
  userRole: 'member',
  status: 'active',
  fetchedUserData: true,
});

const toAppErrorFromResponse = async (response: Response): Promise<Error> => {
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
  };
  return toAppError({
    errorType: 'invalid-argument',
    errorMessage: body.message ?? `Request failed (HTTP ${response.status})`,
  });
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
  const response = await fetch(`${hubApiBase()}/auth/get-session`, {
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

/** Sign in with email + password against the hub's Better Auth. */
export const signInWithEmailAndPassword = async (options: {
  email: string;
  password: string;
}): Promise<CurrentUser> => {
  const response = await fetch(`${hubApiBase()}/auth/sign-in/email`, {
    method: 'POST',
    headers: jsonHeaders,
    credentials: 'include',
    body: JSON.stringify({ email: options.email, password: options.password }),
  });
  if (!response.ok) {
    throw await toAppErrorFromResponse(response);
  }
  const user = await parseSession(response);
  if (!user) {
    throw toAppError({ errorType: 'unauthorized', errorMessage: 'Sign-in failed' });
  }
  return user;
};

/** Sign up with email + password against the hub's Better Auth. */
export const signUpWithEmailAndPassword = async (options: {
  name: string;
  email: string;
  password: string;
}): Promise<CurrentUser> => {
  const response = await fetch(`${hubApiBase()}/auth/sign-up/email`, {
    method: 'POST',
    headers: jsonHeaders,
    credentials: 'include',
    body: JSON.stringify({
      name: options.name,
      email: options.email,
      password: options.password,
    }),
  });
  if (!response.ok) {
    throw await toAppErrorFromResponse(response);
  }
  const user = await parseSession(response);
  if (!user) {
    throw toAppError({ errorType: 'unauthorized', errorMessage: 'Sign-up failed' });
  }
  return user;
};

/** Sign out of the hub's Better Auth session. */
export const signOutBetterAuth = async (): Promise<void> => {
  const response = await fetch(`${hubApiBase()}/auth/sign-out`, {
    method: 'POST',
    headers: jsonHeaders,
    credentials: 'include',
  });
  if (!response.ok) {
    throw await toAppErrorFromResponse(response);
  }
};

/** Request a password reset email from the hub's Better Auth. */
export const sendPasswordResetEmail = async (email: string): Promise<void> => {
  const response = await fetch(`${hubApiBase()}/auth/forget-password`, {
    method: 'POST',
    headers: jsonHeaders,
    credentials: 'include',
    body: JSON.stringify({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    }),
  });
  if (!response.ok) {
    throw await toAppErrorFromResponse(response);
  }
};

/**
 * Google OAuth via redirect to the hub's Better Auth social sign-in. The hub
 * redirects back to `callbackURL` with a session cookie set. Used on the
 * browser path where a full-page redirect is viable.
 */
export const socialSignInRedirect = (provider: FirebaseSignInProviderName): void => {
  const callbackURL = `${window.location.origin}/auth/callback`;
  window.location.assign(
    `${hubApiBase()}/auth/sign-in/social?provider=${provider}&callbackURL=${encodeURIComponent(callbackURL)}`,
  );
};

/** Better Auth device-authorization client id (no validateClient on the hub). */
const DEVICE_CLIENT_ID = 'aikami-client';

/**
 * Request a device authorization from the hub (Better Auth device-authorization
 * flow). Returns the device code and the verification URI to open in the system
 * browser (the /link page), where the user signs in and approves the device.
 */
export const startDeviceHandoff = async (): Promise<DeviceHandoffStart> => {
  const response = await fetch(`${hubApiBase()}/auth/device/code`, {
    method: 'POST',
    headers: jsonHeaders,
    credentials: 'include',
    body: JSON.stringify({ client_id: DEVICE_CLIENT_ID }),
  });
  if (!response.ok) {
    throw await toAppErrorFromResponse(response);
  }
  const body = (await response.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    interval?: number;
    expires_in?: number;
  };
  if (!body.device_code || !body.user_code) {
    throw toAppError({ errorType: 'unavailable', errorMessage: 'Device authorization failed' });
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri_complete ?? body.verification_uri ?? '/device',
    interval: body.interval ?? 5,
    expiresIn: body.expires_in ?? 1800,
  };
};

/**
 * Poll the hub to check whether a device authorization was approved. Returns
 * the adopted `CurrentUser` once approved, `undefined` while still pending,
 * or signals slow_down when the server requests slower polling (RFC 8628).
 * On approval the session token is stored as the Better Auth session cookie
 * so subsequent requests are authenticated.
 */
export const pollDeviceHandoff = async (
  deviceCode: string,
): Promise<{ user: CurrentUser } | { slowDown: true } | undefined> => {
  const response = await fetch(`${hubApiBase()}/auth/device/token`, {
    method: 'POST',
    headers: jsonHeaders,
    credentials: 'include',
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: DEVICE_CLIENT_ID,
    }),
  });
  if (response.status === 400) {
    // RFC 8628: inspect the error field to distinguish pending/slow_down/denied.
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (body.error === 'authorization_pending') {
      return undefined;
    }
    if (body.error === 'slow_down') {
      return { slowDown: true };
    }
    // access_denied, expired_token, or unknown error — surface via error path.
    throw toAppError({
      errorType: 'unauthorized',
      errorMessage: body.error === 'access_denied' ? 'Device authorization denied' : 'Device authorization failed',
    });
  }
  if (!response.ok) {
    throw await toAppErrorFromResponse(response);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw toAppError({ errorType: 'unauthorized', errorMessage: 'Device authorization failed' });
  }
  setSessionCookie(body.access_token);
  const user = await getBetterAuthSession();
  return user ? { user } : undefined;
};

/**
 * Store the Better Auth session token as the session cookie so subsequent
 * `credentials: 'include'` requests are authenticated. Uses the hub origin
 * for the cookie (hub.bearlysleeping.com or localhost) so it matches the
 * server-set session cookie, avoiding conflicts between client and hub
 * domain cookies in Tauri webviews.
 */
const setSessionCookie = (token: string): void => {
  // No-op outside a browser (e.g. unit tests) — the cookie is only meaningful
  // in the Tauri webview / browser where `window.location` exists.
  if (typeof window === 'undefined' || !window.location) {
    return;
  }
  const hubBase = hubApiBase();
  const isSecure = hubBase.startsWith('https://');
  // Derive cookie name: __Secure- prefix required for Secure cookies per spec.
  const cookieName = isSecure ? '__Secure-better-auth.session_token' : 'better-auth.session_token';
  const secureAttr = isSecure ? 'Secure; ' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: adopting the Better Auth session cookie is the intended mechanism
  document.cookie = `${cookieName}=${encodeURIComponent(token)}; Path=/; ${secureAttr}SameSite=Lax; Max-Age=2592000`;
};
