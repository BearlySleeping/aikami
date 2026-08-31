// apps/frontend/client/src/lib/services/auth/device_handoff.spec.ts
//
// C-426 AC-5: verifies the client-side Better Auth device-handoff contract.
//
// The hub's Better Auth device-authorization plugin is mounted, so the
// client's device-handoff functions call the real /device/code and
// /device/token endpoints. These tests mock fetch to pin the request/response
// contract.

// biome-ignore-all lint/style/useNamingConvention: device-authorization API fields are snake_case

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { pollDeviceHandoff, startDeviceHandoff, toCurrentUser } from './better_auth_client';
import { getDesktopSessionToken, resetDesktopSessionForTests } from './desktop_session_store';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  mock.restore();
  globalThis.fetch = originalFetch;
  resetDesktopSessionForTests();
});

describe('Better Auth device handoff (AC-5)', () => {
  test('startDeviceHandoff requests a device code from /device/code', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      (_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          jsonResponse({
            device_code: 'dev-123',
            user_code: 'ABCD-EFGH',
            verification_uri: '/device',
            verification_uri_complete: 'https://hub.bearlysleeping.com/device?user_code=ABCD-EFGH',
            expires_in: 1800,
            interval: 5,
          }),
        ),
    );

    const result = await startDeviceHandoff();
    expect(result.deviceCode).toBe('dev-123');
    expect(result.userCode).toBe('ABCD-EFGH');
    expect(result.verificationUri).toContain('user_code=ABCD-EFGH');
    expect(fetchSpy).toHaveBeenCalled();
  });

  test('pollDeviceHandoff returns undefined while pending (400 authorization_pending)', async () => {
    spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ error: 'authorization_pending', error_description: 'pending' }, 400),
      ),
    );

    const result = await pollDeviceHandoff('dev-123');
    expect(result).toBeUndefined();
  });

  test('pollDeviceHandoff adopts the session on approval', async () => {
    // get-session is reached with the token adopted from /device/token.
    spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/device/token')) {
        return Promise.resolve(
          jsonResponse({
            access_token: 'session-token-abc',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        );
      }
      if (u.includes('/auth/get-session')) {
        return Promise.resolve(
          jsonResponse({
            user: { id: 'u1', name: 'Alice', email: 'a@example.com' },
            session: { id: 's1', expiresAt: new Date(Date.now() + 3600_000).toISOString() },
          }),
        );
      }
      return Promise.resolve(jsonResponse({}, 404));
    });

    const result = await pollDeviceHandoff('dev-123');
    expect(result?.user?.id).toBe('u1');
    expect(result?.user?.email).toBe('a@example.com');
  });

  // The desktop app cannot authenticate with a cookie: its webview origin is
  // `tauri://localhost`, so the hub's SameSite=Lax cookie is never sent and
  // document.cookie cannot write one for the hub's domain either. The token
  // from /device/token must therefore travel as an Authorization header, or
  // get-session comes back empty, pollDeviceHandoff returns undefined, and the
  // NEXT poll fails with invalid_grant because the device code is single-use.
  test('the approved token is sent as a bearer header on the follow-up get-session', async () => {
    const seen: { url: string; authorization: string | null }[] = [];

    spyOn(globalThis, 'fetch').mockImplementation(
      (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        seen.push({
          url: u,
          authorization: new Headers(init?.headers).get('authorization'),
        });
        if (u.includes('/device/token')) {
          return Promise.resolve(
            jsonResponse({ access_token: 'session-token-abc', expires_in: 3600 }),
          );
        }
        if (u.includes('/auth/get-session')) {
          return Promise.resolve(
            jsonResponse({
              user: { id: 'u1', email: 'a@example.com' },
              session: { id: 's1', expiresAt: new Date(Date.now() + 3600_000).toISOString() },
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, 404));
      },
    );

    await pollDeviceHandoff('dev-123');

    // The exchange itself is unauthenticated; the session read that follows
    // carries the token it just returned.
    const tokenCall = seen.find((call) => call.url.includes('/device/token'));
    const sessionCall = seen.find((call) => call.url.includes('/auth/get-session'));
    expect(tokenCall?.authorization).toBeNull();
    expect(sessionCall?.authorization).toBe('Bearer session-token-abc');

    // And it is retained for later requests, not just the one call.
    expect(getDesktopSessionToken()).toBe('session-token-abc');
  });

  test('toCurrentUser maps a Better Auth user onto CurrentUser', () => {
    const user = toCurrentUser({ id: 'u1', name: 'Alice', email: 'a@example.com' }, 'google');
    expect(user.id).toBe('u1');
    expect(user.currentSignInProvider).toBe('google');
    expect(user.signInProviders).toEqual(['google']);
    expect(user.userRole).toBe('member');
  });
});
