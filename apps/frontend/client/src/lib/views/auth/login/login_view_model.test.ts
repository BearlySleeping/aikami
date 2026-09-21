// apps/frontend/client/src/lib/views/auth/login/login_view_model.test.ts
//
// Unit tests for LoginViewModel — sign-in/out progress, error surfacing, and
// platform label. Exercises the ViewModel through feature-owned fixtures — no
// global `$services` barrel mock and no shared test inventory.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createLoginViewModel, type LoginAuthCapabilities } from './login_view_model.svelte';
import { createSignedInLoginAuth, createSignedOutLoginAuth } from './testing/login_fixtures.ts';

const createViewModel = (
  options: {
    auth?: LoginAuthCapabilities;
    isTauri?: () => boolean;
    currentUrl?: () => { pathname: string; href: string };
  } = {},
) =>
  createLoginViewModel({
    className: 'LoginViewModelTest',
    auth: options.auth ?? createSignedOutLoginAuth(),
    isTauri: options.isTauri,
    currentUrl: options.currentUrl,
  });

describe('LoginViewModel — platform label', () => {
  test('labels browser sign-in as "Sign In with Google"', () => {
    expect(createViewModel({ isTauri: () => false }).signInLabel).toBe('Sign In with Google');
  });

  test('labels Tauri sign-in as "Sign In"', () => {
    expect(createViewModel({ isTauri: () => true }).signInLabel).toBe('Sign In');
  });
});

describe('LoginViewModel — identity', () => {
  test('reads signed-in identity from the auth capability', () => {
    const viewModel = createViewModel({ auth: createSignedInLoginAuth() });

    expect(viewModel.isLoggedIn).toBe(true);
    expect(viewModel.playerDisplayName).toBe('Test User');
  });

  test('falls back to email when no display name is present', () => {
    const viewModel = createViewModel({
      auth: createSignedInLoginAuth({ currentUser: { email: 'only@example.com' } }),
    });

    expect(viewModel.playerDisplayName).toBe('only@example.com');
  });
});

describe('LoginViewModel — signIn', () => {
  test('delegates to socialSignIn with google and no callback off /link', async () => {
    const socialSignIn = mock(async () => ({ status: 'exitingUser' as const, payload: {} }));
    const viewModel = createViewModel({
      auth: createSignedOutLoginAuth({ socialSignIn }),
      currentUrl: () => ({ pathname: '/', href: 'https://app.example/' }),
    });

    await viewModel.signIn();

    expect(socialSignIn).toHaveBeenCalledWith({ provider: 'google', callbackURL: undefined });
    expect(viewModel.isSigningIn).toBe(false);
    expect(viewModel.errorMessage).toBeUndefined();
  });

  test('passes the current URL as callbackURL on /link', async () => {
    const socialSignIn = mock(async () => ({ status: 'exitingUser' as const, payload: {} }));
    const viewModel = createViewModel({
      auth: createSignedOutLoginAuth({ socialSignIn }),
      currentUrl: () => ({ pathname: '/link', href: 'https://app.example/link?code=abc' }),
    });

    await viewModel.signIn();

    expect(socialSignIn).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: 'https://app.example/link?code=abc',
    });
  });

  test('surfaces a failed response as an error message', async () => {
    const viewModel = createViewModel({
      auth: createSignedOutLoginAuth({
        socialSignIn: async () => ({ status: 'failed', payload: { message: 'Popup blocked' } }),
      }),
    });

    await viewModel.signIn();

    expect(viewModel.errorMessage).toBe('Popup blocked');
    expect(viewModel.isSigningIn).toBe(false);
  });

  test('sets isSigningIn while the request is pending', async () => {
    let resolveSignIn: ((value: { status: 'exitingUser'; payload: object }) => void) | undefined;
    const socialSignIn = (): Promise<{ status: 'exitingUser'; payload: object }> =>
      new Promise((resolve) => {
        resolveSignIn = resolve;
      });
    const viewModel = createViewModel({ auth: createSignedOutLoginAuth({ socialSignIn }) });

    const pending = viewModel.signIn();
    expect(viewModel.isSigningIn).toBe(true);

    resolveSignIn?.({ status: 'exitingUser', payload: {} });
    await pending;
    expect(viewModel.isSigningIn).toBe(false);
  });

  test('ignores a second signIn while one is in progress', async () => {
    const socialSignIn = mock(
      () =>
        new Promise<{ status: 'exitingUser'; payload: object }>(() => {
          // Never resolves — keep the first call pending.
        }),
    );
    const viewModel = createViewModel({ auth: createSignedOutLoginAuth({ socialSignIn }) });

    void viewModel.signIn();
    await viewModel.signIn();

    expect(socialSignIn).toHaveBeenCalledTimes(1);
  });
});

describe('LoginViewModel — signOut', () => {
  test('delegates to the auth capability and clears the flag', async () => {
    const signOut = mock(async () => {});
    const viewModel = createViewModel({ auth: createSignedInLoginAuth({ signOut }) });

    await viewModel.signOut();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(viewModel.isSigningIn).toBe(false);
  });

  test('swallows a signOut failure without throwing', async () => {
    const viewModel = createViewModel({
      auth: createSignedInLoginAuth({
        signOut: async () => {
          throw new Error('network down');
        },
      }),
    });

    await expect(viewModel.signOut()).resolves.toBeUndefined();
    expect(viewModel.isSigningIn).toBe(false);
  });
});

describe('LoginViewModel — real base class', () => {
  test('extends the production BaseViewModel, not a shared fake', async () => {
    const viewModel = createViewModel();

    expect(viewModel).toBeInstanceOf(BaseViewModel);
    expect('registerEffectRoot' in viewModel).toBe(true);

    viewModel.__mounted = true;
    await viewModel.dispose();
    expect(viewModel.__mounted).toBe(false);
  });
});
