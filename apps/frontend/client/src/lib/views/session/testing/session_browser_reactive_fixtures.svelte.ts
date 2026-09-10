// apps/frontend/client/src/lib/views/session/testing/session_browser_reactive_fixtures.svelte.ts
//
// Reactive session-browser double for the real-Svelte (Vitest Browser Mode)
// lane. Unlike session_browser_fixtures.ts, `sessions` and `checkpoints` are
// real `$state`, so a test can mutate them and observe the ViewModel's exposed
// getters update through the real runtime.
//
// Operations are injected through `overrides` and are not defaulted to success:
// an unconfigured call throws.

import type { GameSession, SessionCheckpoint } from '$types';
import type { SessionBrowserCapabilities } from '../session_browser_view_model.svelte';

export type ReactiveSessionBrowserHarness = {
  /** The capability object to inject into the ViewModel. */
  capabilities: SessionBrowserCapabilities;
  /** Replace the reactive sessions list. */
  setSessions(sessions: GameSession[]): void;
  /** Replace the reactive checkpoints list. */
  setCheckpoints(checkpoints: SessionCheckpoint[]): void;
};

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/**
 * Creates a session-browser double whose `sessions` / `checkpoints` are real
 * Svelte `$state`, plus harness methods to mutate them.
 */
export const createReactiveSessionBrowserHarness = (
  overrides: Partial<SessionBrowserCapabilities> = {},
): ReactiveSessionBrowserHarness => {
  let sessions = $state<GameSession[]>([]);
  let checkpoints = $state<SessionCheckpoint[]>([]);

  const capabilities: SessionBrowserCapabilities = {
    get sessions() {
      return sessions;
    },
    get checkpoints() {
      return checkpoints;
    },
    loadSessions: () => unconfigured('loadSessions'),
    listCheckpoints: () => unconfigured('listCheckpoints'),
    forkFromCheckpoint: () => unconfigured('forkFromCheckpoint'),
    ...overrides,
  };

  return {
    capabilities,
    setSessions: (next) => {
      sessions = next;
    },
    setCheckpoints: (next) => {
      checkpoints = next;
    },
  };
};
