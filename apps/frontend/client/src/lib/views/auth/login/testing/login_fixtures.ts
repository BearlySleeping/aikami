// apps/frontend/client/src/lib/views/auth/login/testing/login_fixtures.ts
//
// Feature-owned test doubles for the login ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type { LoginAuthCapabilities } from '../login_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** A signed-out auth capability whose operations throw until overridden. */
export const createSignedOutLoginAuth = (
  overrides: Partial<LoginAuthCapabilities> = {},
): LoginAuthCapabilities => ({
  isLoggedIn: false,
  currentUser: undefined,
  socialSignIn: () => unconfigured('socialSignIn'),
  signOut: () => unconfigured('signOut'),
  ...overrides,
});

/** A signed-in auth capability with representative identity fields. */
export const createSignedInLoginAuth = (
  overrides: Partial<LoginAuthCapabilities> = {},
): LoginAuthCapabilities =>
  createSignedOutLoginAuth({
    isLoggedIn: true,
    currentUser: { displayName: 'Test User', email: 'test@example.com' },
    ...overrides,
  });
