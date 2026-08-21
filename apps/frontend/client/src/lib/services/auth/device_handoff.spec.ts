// apps/frontend/client/src/lib/services/auth/device_handoff.spec.ts
//
// C-426 AC-5: verifies the client-side Better Auth device-handoff contract.
//
// The hub's Better Auth device-authorization plugin is mounted, so the
// client's device-handoff functions call the real /device/code and
// /device/token endpoints. These tests mock fetch to pin the request/response
// contract.

// biome-ignore-all lint/style/useNamingConvention: device-authorization API fields are snake_case

import { afterEach, describe, expect, mock, test } from 'bun:test';

import { pollDeviceHandoff, startDeviceHandoff, toCurrentUser } from './better_auth_client';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  mock.restore();
});

describe('Better Auth device handoff (AC-5)', () => {
  test('startDeviceHandoff requests a device code from /device/code', async () => {
    const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
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
    // biome-ignore lint/suspicious/noGlobalAssign: test shim
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await startDeviceHandoff();
    expect(result.deviceCode).toBe('dev-123');
    expect(result.userCode).toBe('ABCD-EFGH');
    expect(result.verificationUri).toContain('user_code=ABCD-EFGH');
    expect(fetchMock).toHaveBeenCalled();
  });

  test('pollDeviceHandoff returns undefined while pending (400 authorization_pending)', async () => {
    // biome-ignore lint/suspicious/noGlobalAssign: test shim
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse({ error: 'authorization_pending', error_description: 'pending' }, 400),
      ),
    ) as unknown as typeof fetch;

    const result = await pollDeviceHandoff('dev-123');
    expect(result).toBeUndefined();
  });

  test('pollDeviceHandoff adopts the session on approval', async () => {
    // First call: get-session after setting the cookie returns the user.
    const fetchMock = mock((url: string | URL | Request) => {
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
    // biome-ignore lint/suspicious/noGlobalAssign: test shim
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await pollDeviceHandoff('dev-123');
    expect(result?.id).toBe('u1');
    expect(result?.email).toBe('a@example.com');
  });

  test('toCurrentUser maps a Better Auth user onto CurrentUser', () => {
    const user = toCurrentUser({ id: 'u1', name: 'Alice', email: 'a@example.com' }, 'google');
    expect(user.id).toBe('u1');
    expect(user.currentSignInProvider).toBe('google');
    expect(user.signInProviders).toEqual(['google']);
    expect(user.userRole).toBe('member');
  });
});
