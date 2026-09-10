// apps/frontend/client/src/lib/views/session/testing/session_browser_fixtures.ts
//
// Feature-owned test doubles for the session-browser ViewModel. Each factory
// returns a fresh object typed against the narrow capability contracts the
// ViewModel consumes, so tests assert explicit behavior instead of the global
// `$services` mock inventory.
//
// Operations are not defaulted to success: an unconfigured call throws, so a
// test cannot pass by accident on a silent no-op.

import type {
  SessionBrowserCapabilities,
  SessionBrowserRouterCapability,
} from '../session_browser_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Session/checkpoint capability returning empty state until overridden. */
export const createSessionBrowserCapabilities = (
  overrides: Partial<SessionBrowserCapabilities> = {},
): SessionBrowserCapabilities => ({
  sessions: [],
  checkpoints: [],
  loadSessions: () => unconfigured('loadSessions'),
  listCheckpoints: () => unconfigured('listCheckpoints'),
  forkFromCheckpoint: () => unconfigured('forkFromCheckpoint'),
  ...overrides,
});

/** Router capability whose navigation throws until a caller overrides it. */
export const createSessionBrowserRouter = (
  overrides: Partial<SessionBrowserRouterCapability> = {},
): SessionBrowserRouterCapability => ({
  navigateToApp: () => unconfigured('navigateToApp'),
  ...overrides,
});
