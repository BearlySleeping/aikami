// apps/frontend/client/src/lib/views/auth/login/testing/login_reactive_fixtures.svelte.ts
//
// Reactive login double for the real-Svelte (Vitest Browser Mode) lane. The
// identity is real `$state`, so a test can change the signed-in user and
// observe the ViewModel's exposed getters update through the real runtime.
//
// Operations are injected through `overrides` and are not defaulted to success:
// an unconfigured call throws.

import type { LoginAuthCapabilities, LoginUser } from '../login_view_model.svelte';

export type ReactiveLoginHarness = {
  /** The capability object to inject into the ViewModel. */
  auth: LoginAuthCapabilities;
  /** Sign in with reactive identity, updating the ViewModel's exposed getters. */
  signIn(user: LoginUser): void;
  /** Clear the reactive identity. */
  signOut(): void;
};

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/**
 * Creates a login double whose `isLoggedIn` / `currentUser` are real Svelte
 * `$state`, plus harness methods to mutate them.
 */
export const createReactiveLoginHarness = (
  overrides: Partial<LoginAuthCapabilities> = {},
): ReactiveLoginHarness => {
  let isLoggedIn = $state(false);
  let currentUser = $state<LoginUser | undefined>(undefined);

  const auth: LoginAuthCapabilities = {
    get isLoggedIn() {
      return isLoggedIn;
    },
    get currentUser() {
      return currentUser;
    },
    socialSignIn: () => unconfigured('socialSignIn'),
    signOut: () => unconfigured('signOut'),
    ...overrides,
  };

  return {
    auth,
    signIn: (user) => {
      currentUser = { displayName: user.displayName, email: user.email };
      isLoggedIn = true;
    },
    signOut: () => {
      currentUser = undefined;
      isLoggedIn = false;
    },
  };
};
