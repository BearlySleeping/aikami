// apps/frontend/client/src/lib/services/api/hub_api_client.ts
//
// C-418 Feature D: client transport for the hub-hosted auth endpoints that
// replaced the Firebase Callable Functions `auth` / `poll_device_handoff`.
//
// The hub's Elysia app (apps/frontend/hub/src/lib/server/api/index.ts) is
// reached:
//   - emulator/testing: same-origin via the dev-server proxy `/api/hub/*`
//     (see vite.config.ts), which rewrites to the hub's `/api/*`.
//   - staging/production: the deployed hub domain, cross-origin with CORS
//     allowed for first-party client origins (see hub hooks.server.ts).
//
// Auth is session-based (Better Auth cookie), so requests use
// `credentials: 'include'`. App Check was removed (C-426).

import { PORTS } from '@aikami/constants';
import { getPublicMode } from '@aikami/frontend/configs';
import type { AuthMessageData, AuthMessageResponse, Mode } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { getDesktopSessionToken } from '$lib/services/auth/desktop_session_store';
import { isTauri } from '$lib/views/utils/is_tauri';

/** Hub base URL per deployment mode. Emulator/testing use the dev proxy. */
// The base always points at the hub's `/api` root: the emulator proxy
// `/api/hub` rewrites to the hub's `/api/*`, so production/staging must
// carry the same `/api` suffix (the hub's Elysia app is mounted at
// `/api/[...slugs]`, and Better Auth at `/api/auth/*`).
const HUB_API_BASE: Record<Mode, string> = {
  emulator: '/api/hub',
  testing: '/api/hub',
  staging: 'https://hub.stg.bearlysleeping.com/api',
  production: 'https://hub.bearlysleeping.com/api',
};

/**
 * Modes whose base is a *relative* path served by the Vite dev proxy.
 * A packaged Tauri build has no dev server: its origin is `tauri://localhost`,
 * so `/api/hub/...` resolves against the asset protocol and every auth call
 * dies with WebKit's opaque `TypeError: Load failed`. Point those builds
 * straight at the local hub instead — the hub already grants CORS to the Tauri
 * webview origin on /api/auth/* (hub hooks.server.ts → isTauriWebviewOrigin).
 *
 * `tauri dev` / `preview --tauri-dev` are unaffected either way: they load from
 * the dev server, so the proxy is there and the relative base already works.
 */
const PROXIED_MODES = ['emulator', 'testing'] as const satisfies readonly Mode[];

const isProxiedMode = (mode: Mode): mode is (typeof PROXIED_MODES)[number] =>
  (PROXIED_MODES as readonly Mode[]).includes(mode);

/**
 * Merge the desktop session token into a request's headers.
 *
 * The Tauri webview cannot hold the hub's session cookie (cross-site,
 * SameSite=Lax — see desktop_session_store.ts), so it authenticates with
 * `Authorization: Bearer <session token>` instead, resolved server-side by
 * Better Auth's bearer plugin. Returns `base` untouched in the browser, where
 * `credentials: 'include'` and the cookie do the job.
 */
export const hubAuthHeaders = (base: Record<string, string> = {}): Record<string, string> => {
  const token = getDesktopSessionToken();
  // biome-ignore lint/style/useNamingConvention: HTTP header name
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
};

export const hubApiBase = (): string => {
  const mode = getPublicMode();
  if (isProxiedMode(mode) && isTauri() && !window.location.origin.startsWith('http')) {
    return `http://localhost:${PORTS[mode].hub}/api`;
  }
  return HUB_API_BASE[mode] ?? '/api/hub';
};

type HubErrorBody = {
  errorType?: string;
  errorMessage?: string;
};

const toHubError = (status: number, body: HubErrorBody): Error =>
  toAppError({
    errorType: body?.errorType ?? 'internal',
    errorMessage: body?.errorMessage ?? `Hub request failed (HTTP ${status})`,
  });

/**
 * Calls the hub's multiplexed auth endpoint (formerly the `auth` callable).
 *
 * @param data The typed auth message (type + payload).
 */
export const callHubAuthAction = async <T extends AuthMessageData['type']>(data: {
  type: T;
  payload: AuthMessageData<T>['payload'];
}): Promise<AuthMessageResponse<T>> => {
  const headers = hubAuthHeaders({ 'Content-Type': 'application/json' });

  const response = await fetch(`${hubApiBase()}/auth/action`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ type: data.type, payload: data.payload }),
  });

  const body = (await response.json().catch(() => ({}))) as HubErrorBody | AuthMessageResponse<T>;
  if (!response.ok) {
    throw toHubError(response.status, body as HubErrorBody);
  }
  return body as AuthMessageResponse<T>;
};

/**
 * Polls the hub's single-use device-handoff endpoint (formerly the
 * `poll_device_handoff` callable). Deliberately unauthenticated — the
 * caller (Tauri desktop app) has no session yet; codes are unguessable
 * UUIDs and the handoff doc is deleted on first read.
 */
export const pollHubDeviceHandoff = async (
  code: string,
): Promise<{ customFirebaseSignInToken: string | null }> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const response = await fetch(`${hubApiBase()}/auth/poll-device-handoff`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ code }),
  });

  const body = (await response.json().catch(() => ({}))) as
    | HubErrorBody
    | {
        customFirebaseSignInToken: string | null;
      };
  if (!response.ok) {
    throw toHubError(response.status, body as HubErrorBody);
  }
  return body as { customFirebaseSignInToken: string | null };
};
