// apps/frontend/client/src/browser_tests/login.browser.test.ts
//
// Real-runes coverage for the migrated login ViewModel.
//
// The Bun suite verifies delegation with plain fixtures; this lane runs the
// ViewModel in Chromium with the real Svelte compiler against a reactive auth
// fixture, so identity changes and the transient pending flag are observed.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createLoginViewModel } from '../lib/views/auth/login/login_view_model.svelte';
import { createReactiveLoginHarness } from '../lib/views/auth/login/testing/login_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

const createViewModel = (auth: ReturnType<typeof createReactiveLoginHarness>['auth']) => {
  const viewModel = createLoginViewModel({
    className: 'LoginViewModel',
    auth,
    isTauri: () => false,
  });
  disposables.push(() => viewModel.dispose());
  return viewModel;
};

describe('LoginViewModel — reactive identity (real runes)', () => {
  test('sign-in and sign-out update exposed identity', () => {
    const harness = createReactiveLoginHarness();
    const viewModel = createViewModel(harness.auth);

    expect(viewModel.isLoggedIn).toBe(false);
    expect(viewModel.playerDisplayName).toBeUndefined();

    harness.signIn({ displayName: 'Aria', email: 'aria@example.com' });
    flushSync();

    expect(viewModel.isLoggedIn).toBe(true);
    expect(viewModel.playerDisplayName).toBe('Aria');

    harness.signOut();
    flushSync();

    expect(viewModel.isLoggedIn).toBe(false);
    expect(viewModel.playerDisplayName).toBeUndefined();
  });

  test('a pending signIn sets isSigningIn then clears it', async () => {
    let resolveSignIn:
      | ((value: { status: 'exitingUser'; payload: Record<string, never> }) => void)
      | undefined;
    const harness = createReactiveLoginHarness({
      socialSignIn: () =>
        new Promise((resolve) => {
          resolveSignIn = resolve;
        }),
    });
    const viewModel = createViewModel(harness.auth);

    const pending = viewModel.signIn();
    expect(viewModel.isSigningIn).toBe(true);

    resolveSignIn?.({ status: 'exitingUser', payload: {} });
    await pending;
    flushSync();

    expect(viewModel.isSigningIn).toBe(false);
  });
});
