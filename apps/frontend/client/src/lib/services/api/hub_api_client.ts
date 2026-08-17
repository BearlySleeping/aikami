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
// Auth actions are authenticated with the caller's Firebase ID token
// (`Authorization: Bearer <token>`); the hub verifies it and derives the
// same `currentUser` the callable context used to provide. App Check tokens
// are attached in production where enforcement is active.

import { getAppCheckToken, getPublicMode } from '@aikami/frontend/configs';
import type { AuthMessageData, AuthMessageResponse, Mode } from '@aikami/types';
import { toAppError } from '@aikami/utils';

/** Hub base URL per deployment mode. Emulator/testing use the dev proxy. */
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

/** Attach the App Check token when enforcement is active (production). */
const appCheckHeaders = async (): Promise<Record<string, string>> => {
  try {
    const token = await getAppCheckToken();
    if (token?.token) {
      return { 'X-Firebase-AppCheck': token.token };
    }
  } catch {
    // No App Check token available — the hub rejects with 401 in
    // enforcement modes, which is the correct failure signal.
  }
  return {};
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
 * @param idToken The caller's Firebase ID token, or undefined for
 *                unauthenticated actions (which the hub rejects as
 *                `unauthorized`, matching the callable's behavior).
 */
export const callHubAuthAction = async <T extends AuthMessageData['type']>(
  data: { type: T; payload: AuthMessageData<T>['payload'] },
  idToken?: string,
): Promise<AuthMessageResponse<T>> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await appCheckHeaders()),
  };
  if (idToken) {
    // Header name is canonical HTTP syntax, not a code identifier.
    headers.Authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(`${hubApiBase()}/auth/action`, {
    method: 'POST',
    headers,
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
 * UUIDs and the Firestore doc is deleted on first read.
 */
export const pollHubDeviceHandoff = async (
  code: string,
): Promise<{ customFirebaseSignInToken: string | null }> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await appCheckHeaders()),
  };

  const response = await fetch(`${hubApiBase()}/auth/poll-device-handoff`, {
    method: 'POST',
    headers,
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
