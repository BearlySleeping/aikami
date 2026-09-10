// apps/frontend/client/src/lib/views/settings/account/testing/account_fixtures.ts
//
// Feature-owned test doubles for the account settings ViewModel. Every factory
// returns a fresh object typed against the narrow capability contracts the
// ViewModel consumes, so tests assert against explicit behavior instead of the
// implicit, invent-anything proxy in the global `$services` mock.
//
// These doubles carry no dependencies on the test runner; callers pass spies
// (e.g. `mock(...)`) through the `overrides` argument when they need to assert
// calls.
//
// Destructive/session operations are intentionally NOT defaulted to success:
// an unconfigured call throws, so a test cannot pass by accident on a silent
// no-op. Configure the operation explicitly when the behavior under test needs
// it.

import type { SaveSlotEntry } from '@aikami/types';
import type { AccountCapabilities, AccountSyncCapabilities } from '../account_view_model.svelte';

const unconfigured = (operation: keyof AccountCapabilities): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/**
 * A signed-out account. Identity is inert; destructive/session operations
 * throw until a caller overrides them.
 */
export const createSignedOutAccount = (
  overrides: Partial<AccountCapabilities> = {},
): AccountCapabilities => ({
  isLoggedIn: false,
  currentUser: undefined,
  uid: undefined,
  signOut: () => unconfigured('signOut'),
  deleteAccount: () => unconfigured('deleteAccount'),
  revokeAllSessions: () => unconfigured('revokeAllSessions'),
  ...overrides,
});

/** A signed-in account with representative identity fields. */
export const createSignedInAccount = (
  overrides: Partial<AccountCapabilities> = {},
): AccountCapabilities =>
  createSignedOutAccount({
    isLoggedIn: true,
    currentUser: { displayName: 'Test User', email: 'test@example.com' },
    uid: 'test-uid',
    ...overrides,
  });

/** A sync capability returning no slots until a caller overrides it. */
export const createSyncCapabilities = (
  overrides: Partial<AccountSyncCapabilities> = {},
): AccountSyncCapabilities => ({
  listSlots: async (): Promise<SaveSlotEntry[]> => [],
  ...overrides,
});
