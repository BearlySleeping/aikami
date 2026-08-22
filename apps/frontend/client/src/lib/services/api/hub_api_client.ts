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

import { getPublicMode } from '@aikami/frontend/configs';
import type { AuthMessageData, AuthMessageResponse, Mode } from '@aikami/types';
import { toAppError } from '@aikami/utils';

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

export const hubApiBase = (): string => {
  const mode = getPublicMode();
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

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
