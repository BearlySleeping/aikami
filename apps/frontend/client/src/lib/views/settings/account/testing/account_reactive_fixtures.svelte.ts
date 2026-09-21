// apps/frontend/client/src/lib/views/settings/account/testing/account_reactive_fixtures.svelte.ts
//
// Reactive account double for the real-Svelte (Vitest Browser Mode) lane.
// Unlike account_fixtures.ts, the identity here is real `$state`, so a test can
// change the signed-in user and observe the ViewModel's exposed identity flip.
//
// Destructive/session operations are injected through `overrides` and are not
// defaulted to success: an unconfigured call throws.

import type { AccountCapabilities, AccountUser } from '../account_view_model.svelte';

export type ReactiveAccountHarness = {
  /** The capability object to inject into the ViewModel. */
  account: AccountCapabilities;
  /** Sign in with reactive identity, updating the ViewModel's exposed getters. */
  signIn(user: { displayName: string; email: string; uid: string }): void;
  /** Clear the reactive identity. */
  signOut(): void;
};

const unconfigured = (operation: keyof AccountCapabilities): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/**
 * Creates an account double whose `isLoggedIn` / `currentUser` / `uid` are
 * real Svelte `$state`, plus harness methods to mutate them.
 */
export const createReactiveAccountHarness = (
  overrides: Partial<AccountCapabilities> = {},
): ReactiveAccountHarness => {
  let isLoggedIn = $state(false);
  let currentUser = $state<AccountUser | undefined>(undefined);
  let uid = $state<string | undefined>(undefined);

  const account: AccountCapabilities = {
    get isLoggedIn() {
      return isLoggedIn;
    },
    get currentUser() {
      return currentUser;
    },
    get uid() {
      return uid;
    },
    signOut: () => unconfigured('signOut'),
    deleteAccount: () => unconfigured('deleteAccount'),
    revokeAllSessions: () => unconfigured('revokeAllSessions'),
    ...overrides,
  };

  return {
    account,
    signIn: (user) => {
      currentUser = { displayName: user.displayName, email: user.email };
      uid = user.uid;
      isLoggedIn = true;
    },
    signOut: () => {
      currentUser = undefined;
      uid = undefined;
      isLoggedIn = false;
    },
  };
};
