// apps/frontend/client/src/lib/services/auth/better_auth_client.svelte.ts
//
// C-426 AC-5: Better Auth client for the desktop/web client, replacing the
// Firebase Auth SDK path. Talks to the hub's Better Auth endpoints mounted at
// /api/auth/* (see apps/frontend/hub/src/lib/server/api/index.ts).
//
// The Better Auth session is a cookie (`better-auth.session_token`). In the
// Tauri webview we persist the raw token in localStorage so the session
// survives app restarts and can be replayed to the hub's get-session check.
//
// Device handoff (Tauri can't OAuth-popup): the client generates a code and
// opens the hub /link page in the system browser; the user signs in there via
// Better Auth; the client polls the hub's device-authorization endpoint and
// adopts the resulting Better Auth session — the same polling UX as the old
// Firebase flow, but exchanging a Better Auth session instead of a
// customFirebaseSignInToken.

import { getPublicMode } from '@aikami/frontend/configs';
import type { Mode } from '@aikami/types';

/** Hub base URL per deployment mode (mirrors hub_api_client.ts). */
const HUB_API_BASE: Record<Mode, string> = {
  emulator: '/api/hub',
  testing: '/api/hub',
  staging: 'https://hub.stg.bearlysleeping.com',
  production: 'https://hub.bearlysleeping.com',
};

const hubApiBase = (): string => {
  const mode = getPublicMode();
  return HUB_API_BASE[mode] ?? '/api/hub';
};

/** localStorage key for the persisted Better Auth session token. */
const SESSION_TOKEN_KEY = 'better_auth.session_token';

export type BetterAuthUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
};

export type BetterAuthSession = {
  user: BetterAuthUser;
  session: { id: string; expiresAt: string; token: string };
};

/** The signed-in user, or undefined. */
export const getStoredSessionToken = (): string | undefined => {
  if (typeof localStorage === 'undefined') {
    return undefined;
  }
  return localStorage.getItem(SESSION_TOKEN_KEY) ?? undefined;
};

const storeSessionToken = (token: string | undefined): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }
  if (token) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
};

const jsonHeaders = (token?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(token ? { cookie: `better-auth.session_token=${token}` } : {}),
});

/**
 * Sign in with email/password against the hub's Better Auth endpoint.
 * Returns the session token on success.
 */
export const signInWithEmailAndPassword = async (options: {
  email: string;
  password: string;
}): Promise<string> => {
  const res = await fetch(`${hubApiBase()}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: options.email, password: options.password }),
  });
  if (!res.ok) {
    throw new Error('Invalid email or password');
  }
  const setCookie = res.headers.get('set-cookie');
  const token = setCookie?.split(';')[0]?.split('=')[1];
  if (!token) {
    throw new Error('No session cookie returned');
  }
  storeSessionToken(token);
  return token;
};

/** Fetch the current session from the hub, or undefined when signed out. */
export const getSession = async (): Promise<BetterAuthSession | undefined> => {
  const token = getStoredSessionToken();
  if (!token) {
    return undefined;
  }
  const res = await fetch(`${hubApiBase()}/auth/get-session`, {
    headers: jsonHeaders(token),
  });
  if (!res.ok) {
    return undefined;
  }
  const body = (await res.json()) as BetterAuthSession | null;
  return body ?? undefined;
};

/** Sign out — clears the local session token. */
export const signOut = async (): Promise<void> => {
  const token = getStoredSessionToken();
  storeSessionToken(undefined);
  if (token) {
    await fetch(`${hubApiBase()}/auth/sign-out`, {
      method: 'POST',
      headers: jsonHeaders(token),
    }).catch(() => undefined);
  }
};

// ── Device handoff ──────────────────────────────────────────────────────
// The client can't OAuth-popup in the Tauri webview, so it opens the hub
// /link page in the system browser. The user signs in there; the client
// polls the hub's device-authorization endpoint for the resulting session.

export const DEVICE_LINK_URL = 'https://aikami.bearlysleeping.com/link';
export const DEVICE_POLL_INTERVAL_MS = 2000;
export const DEVICE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Start a device handoff: generate a code, open the hub /link page, and poll
 * until the user approves (or the timeout elapses). Resolves with the adopted
 * Better Auth session token.
 */
export const startDeviceHandoff = async (options: {
  openUrl: (url: string) => Promise<void>;
  poll: (code: string) => Promise<string | undefined>;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<string> => {
  const code = crypto.randomUUID().slice(0, 8);
  const intervalMs = options.intervalMs ?? DEVICE_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEVICE_TIMEOUT_MS;

  await options.openUrl(`${DEVICE_LINK_URL}?code=${code}`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const token = await options.poll(code);
    if (token) {
      storeSessionToken(token);
      return token;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Sign-in timed out');
};
