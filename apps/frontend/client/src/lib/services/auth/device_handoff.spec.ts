// apps/frontend/client/src/lib/services/auth/device_handoff.spec.ts
//
// C-426 AC-5: verifies the client-side Better Auth device-handoff flow — the
// client requests a device authorization from the hub, then polls until the
// user approves and adopts the session. The hub is mocked (fetch + hubApiBase),
// so this runs without a live Google OAuth client or a Tauri webview.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the hub base URL so the test doesn't need the real configs environment.
// Must be registered before the module under test is imported (dynamic import).
mock.module('../api/hub_api_client', () => ({
  hubApiBase: () => 'https://hub.test',
  callHubAuthAction: async () => {
    throw new Error('not used in this test');
  },
  pollHubDeviceHandoff: async () => ({ customFirebaseSignInToken: null }),
}));

type BetterAuthClient = typeof import('./better_auth_client');

let client: BetterAuthClient;
let fetchMock: ReturnType<typeof mock>;
let statusCalls = 0;

const approvedSession = JSON.stringify({
  user: {
    id: 'u1',
    name: 'Alice',
    email: 'alice@example.com',
    createdAt: '2026-01-01T00:00:00Z',
  },
  session: { id: 's1', expiresAt: '2026-02-01T00:00:00Z' },
});

beforeEach(async () => {
  statusCalls = 0;
  fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/device-authorization')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            deviceCode: 'dev-123',
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://hub.test/link?code=dev-123',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/auth/device-authorization/status')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { deviceCode?: string };
      if (body.deviceCode === 'dev-123') {
        statusCalls += 1;
        // First poll: still pending (202). Second poll: approved session.
        if (statusCalls === 1) {
          return Promise.resolve(new Response('{}', { status: 202 }));
        }
        return Promise.resolve(
          new Response(approvedSession, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      // Unknown/not-yet-created device codes stay pending (202) — keep polling.
      return Promise.resolve(new Response('{}', { status: 202 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  client = await import('./better_auth_client');
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).fetch;
});

describe('Better Auth device handoff (AC-5)', () => {
  test('startDeviceHandoff requests a device authorization from the hub', async () => {
    const start = await client.startDeviceHandoff();
    expect(start.deviceCode).toBe('dev-123');
    expect(start.userCode).toBe('ABCD-EFGH');
    expect(start.verificationUri).toContain('dev-123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub.test/auth/device-authorization',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  test('pollDeviceHandoff returns undefined while pending, then the adopted user', async () => {
    const pending = await client.pollDeviceHandoff('dev-123');
    expect(pending).toBeUndefined();

    const approved = await client.pollDeviceHandoff('dev-123');
    expect(approved?.id).toBe('u1');
    expect(approved?.email).toBe('alice@example.com');
  });

  test('pollDeviceHandoff returns undefined for an unknown device code', async () => {
    const result = await client.pollDeviceHandoff('unknown-code');
    expect(result).toBeUndefined();
  });

  test('toCurrentUser maps a Better Auth user onto CurrentUser', () => {
    const user = client.toCurrentUser(
      { id: 'u1', name: 'Alice', email: 'a@example.com' },
      'google',
    );
    expect(user.id).toBe('u1');
    expect(user.currentSignInProvider).toBe('google');
    expect(user.signInProviders).toEqual(['google']);
    expect(user.userRole).toBe('member');
  });
});
