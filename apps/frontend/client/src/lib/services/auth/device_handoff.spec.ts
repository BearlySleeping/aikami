// apps/frontend/client/src/lib/services/auth/device_handoff.spec.ts
//
// C-426 AC-5: verifies the client-side Better Auth device-handoff contract.
//
// The hub's Better Auth device-authorization plugin is NOT yet mounted, so the
// client's device-handoff functions are gated: they must fail fast with a clear
// error rather than calling the unavailable /api/auth/device-authorization
// endpoint. The Tauri sign-in path falls back to the Firebase device-link flow
// (see auth_service.svelte.ts), so this test pins the gating contract.

import { describe, expect, test } from 'bun:test';

import { pollDeviceHandoff, startDeviceHandoff, toCurrentUser } from './better_auth_client';

describe('Better Auth device handoff (AC-5)', () => {
  test('startDeviceHandoff is gated until the hub device-authorization plugin exists', async () => {
    await expect(startDeviceHandoff()).rejects.toThrow(/not yet available/i);
  });

  test('pollDeviceHandoff is gated until the hub device-authorization plugin exists', async () => {
    await expect(pollDeviceHandoff('dev-123')).rejects.toThrow(/not yet available/i);
  });

  test('toCurrentUser maps a Better Auth user onto CurrentUser', () => {
    const user = toCurrentUser({ id: 'u1', name: 'Alice', email: 'a@example.com' }, 'google');
    expect(user.id).toBe('u1');
    expect(user.currentSignInProvider).toBe('google');
    expect(user.signInProviders).toEqual(['google']);
    expect(user.userRole).toBe('member');
  });
});
