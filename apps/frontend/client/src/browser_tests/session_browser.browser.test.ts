// apps/frontend/client/src/browser_tests/session_browser.browser.test.ts
//
// Real-runes coverage for the migrated session-browser ViewModel.
//
// The Bun suite verifies the explicit collaborators, but its rune polyfills are
// identity functions — it cannot observe a reactive session list change or a
// transient loading flag. This lane runs the ViewModel in Chromium with the real
// Svelte compiler against a reactive capability fixture.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import type { GameSession, SessionCheckpoint } from '$types';
import {
  createSessionBrowserViewModel,
  type SessionBrowserCapabilities,
} from '../lib/views/session/session_browser_view_model.svelte';
import { createSessionBrowserRouter } from '../lib/views/session/testing/session_browser_fixtures.ts';
import { createReactiveSessionBrowserHarness } from '../lib/views/session/testing/session_browser_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

const createViewModel = (session: SessionBrowserCapabilities) => {
  const viewModel = createSessionBrowserViewModel({
    className: 'SessionBrowserViewModel',
    session,
    router: createSessionBrowserRouter(),
  });
  disposables.push(() => viewModel.dispose());
  return viewModel;
};

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

const makeSession = (id: string): GameSession => ({
  id,
  gameId: 'game-1',
  sessionNumber: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  isActive: false,
  messageCount: 0,
  characterSnapshots: {},
  recapReviewed: false,
  checkpointIds: [],
});

const makeCheckpoint = (id: string): SessionCheckpoint => ({
  id,
  sessionId: 'session-1',
  campaignId: 'campaign-1',
  label: 'Before Boss',
  sessionNumber: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  saveSlotId: 'checkpoint-uuid',
  hasForks: false,
});

describe('SessionBrowserViewModel — reactive session state (real runes)', () => {
  test('sessions and checkpoints update when the capability state changes', () => {
    const harness = createReactiveSessionBrowserHarness();
    const viewModel = createViewModel(harness.capabilities);

    expect(viewModel.sessions).toEqual([]);
    expect(viewModel.checkpoints).toEqual([]);

    harness.setSessions([makeSession('s-1')]);
    harness.setCheckpoints([makeCheckpoint('cp-1')]);
    flushSync();

    expect(viewModel.sessions).toHaveLength(1);
    expect(viewModel.sessions[0].id).toBe('s-1');
    expect(viewModel.checkpoints).toHaveLength(1);
    expect(viewModel.checkpoints[0].id).toBe('cp-1');
  });

  test('a pending loadSessions sets isLoading then clears it', async () => {
    let resolveLoad: (() => void) | undefined;
    const loadSessions = (): Promise<void> =>
      new Promise((resolve) => {
        resolveLoad = resolve;
      });

    const harness = createReactiveSessionBrowserHarness({ loadSessions });
    const viewModel = createViewModel(harness.capabilities);

    const pending = viewModel.loadSessions({ gameId: 'game-1' });
    expect(viewModel.isLoading).toBe(true);

    resolveLoad?.();
    await pending;
    flushSync();

    expect(viewModel.isLoading).toBe(false);
  });
});
