// apps/frontend/client/src/lib/views/session/session_browser_view_model.test.ts
//
// Unit tests for SessionBrowserViewModel — session listing, checkpoint
// browsing, continue, and fork from checkpoint.
//
// This suite exercises the ViewModel through feature-owned fixtures — no
// global `$services` barrel mock and no shared test inventory.
//
// Contract: C-240 Session Management
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { GameSession, SessionCheckpoint } from '$types';
import {
  createSessionBrowserViewModel,
  type SessionBrowserCapabilities,
} from './session_browser_view_model.svelte';
import {
  createSessionBrowserCapabilities,
  createSessionBrowserRouter,
} from './testing/session_browser_fixtures.ts';

const makeSession = (overrides: Partial<GameSession> = {}): GameSession => ({
  id: 'session-1',
  gameId: 'game-1',
  sessionNumber: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  isActive: false,
  messageCount: 0,
  characterSnapshots: {},
  recapReviewed: false,
  checkpointIds: [],
  ...overrides,
});

const makeCheckpoint = (overrides: Partial<SessionCheckpoint> = {}): SessionCheckpoint => ({
  id: 'cp-1',
  sessionId: 'session-1',
  campaignId: 'campaign-1',
  label: 'Before Boss',
  sessionNumber: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  saveSlotId: 'checkpoint-uuid',
  hasForks: false,
  ...overrides,
});

const createViewModel = (
  options: {
    session?: SessionBrowserCapabilities;
    gameId?: string;
    campaignId?: string;
    navigateToApp?: () => Promise<void>;
  } = {},
) =>
  createSessionBrowserViewModel({
    className: 'SessionBrowserViewModel',
    gameId: options.gameId,
    campaignId: options.campaignId,
    session: options.session ?? createSessionBrowserCapabilities(),
    router: createSessionBrowserRouter(
      options.navigateToApp ? { navigateToApp: options.navigateToApp } : {},
    ),
  });

describe('SessionBrowserViewModel — listing', () => {
  test('starts with no sessions or loading state', () => {
    const viewModel = createViewModel();

    expect(viewModel.sessions).toEqual([]);
    expect(viewModel.checkpoints).toEqual([]);
    expect(viewModel.isLoading).toBe(false);
  });

  test('loadSessions delegates to the session capability and clears loading', async () => {
    const sessions = [makeSession({ id: 's-1', gameId: 'game-1' })];
    const loadSessions = mock(async () => {});
    const viewModel = createViewModel({
      session: createSessionBrowserCapabilities({ sessions, loadSessions }),
    });

    await viewModel.loadSessions({ gameId: 'game-1' });

    expect(loadSessions).toHaveBeenCalledWith({ gameId: 'game-1' });
    expect(viewModel.sessions).toEqual(sessions);
    expect(viewModel.isLoading).toBe(false);
  });

  test('loadCheckpoints delegates to the session capability', async () => {
    const checkpoints = [makeCheckpoint({ id: 'cp-1', campaignId: 'camp-1' })];
    const listCheckpoints = mock(async () => {});
    const viewModel = createViewModel({
      session: createSessionBrowserCapabilities({ checkpoints, listCheckpoints }),
    });

    await viewModel.loadCheckpoints({ campaignId: 'camp-1' });

    expect(listCheckpoints).toHaveBeenCalledWith({ campaignId: 'camp-1' });
    expect(viewModel.checkpoints).toEqual(checkpoints);
  });
});

describe('SessionBrowserViewModel — read-only view', () => {
  test('viewSession opens the read-only view with the selected session', () => {
    const viewModel = createViewModel();
    const session = makeSession({ id: 'test-session-1' });

    viewModel.viewSession(session);

    expect(viewModel.showReadOnly).toBe(true);
    expect(viewModel.selectedSession?.id).toBe('test-session-1');
  });

  test('closeReadOnly clears the selection', () => {
    const viewModel = createViewModel();
    viewModel.viewSession(makeSession());

    viewModel.closeReadOnly();

    expect(viewModel.showReadOnly).toBe(false);
    expect(viewModel.selectedSession).toBeNull();
  });
});

describe('SessionBrowserViewModel — continue', () => {
  test('continueFromSession navigates through the router capability', async () => {
    const navigateToApp = mock(async () => {});
    const viewModel = createViewModel({ navigateToApp });

    await viewModel.continueFromSession(makeSession());

    expect(navigateToApp).toHaveBeenCalledTimes(1);
  });
});

describe('SessionBrowserViewModel — fork from checkpoint (C-344)', () => {
  test('openForkConfirm and closeForkConfirm manage dialog state', () => {
    const viewModel = createViewModel();
    const checkpoint = makeCheckpoint({ id: 'cp-1', label: 'Before Boss' });

    viewModel.openForkConfirm(checkpoint);
    expect(viewModel.showForkConfirm).toBe(true);
    expect(viewModel.forkCheckpoint?.label).toBe('Before Boss');

    viewModel.closeForkConfirm();
    expect(viewModel.showForkConfirm).toBe(false);
    expect(viewModel.forkCheckpoint).toBeNull();
  });

  test('confirmFork delegates to the session capability and cleans up', async () => {
    const forkFromCheckpoint = mock(async () => {});
    const viewModel = createViewModel({
      gameId: 'game-1',
      campaignId: 'campaign-1',
      session: createSessionBrowserCapabilities({ forkFromCheckpoint }),
    });

    viewModel.openForkConfirm(makeCheckpoint({ id: 'cp-success' }));
    await viewModel.confirmFork();

    expect(forkFromCheckpoint).toHaveBeenCalledWith({
      checkpointId: 'cp-success',
      gameId: 'game-1',
      campaignId: 'campaign-1',
    });
    expect(viewModel.showForkConfirm).toBe(false);
    expect(viewModel.forkCheckpoint).toBeNull();
    expect(viewModel.forkError).toBeNull();
    expect(viewModel.isForking).toBe(false);
  });

  test('confirmFork reports missing game or campaign id', async () => {
    const viewModel = createViewModel();
    viewModel.openForkConfirm(makeCheckpoint());

    await viewModel.confirmFork();

    expect(viewModel.forkError).toBe('Missing game or campaign ID');
  });

  test('confirmFork surfaces an error and keeps the dialog open', async () => {
    const viewModel = createViewModel({
      gameId: 'game-1',
      campaignId: 'campaign-1',
      session: createSessionBrowserCapabilities({
        forkFromCheckpoint: async () => {
          throw new Error('Checkpoint is corrupted');
        },
      }),
    });

    viewModel.openForkConfirm(makeCheckpoint({ id: 'cp-error' }));
    await viewModel.confirmFork();

    expect(viewModel.forkError).toBe('Error: Checkpoint is corrupted');
    expect(viewModel.isForking).toBe(false);
    expect(viewModel.showForkConfirm).toBe(true);
  });

  test('confirmFork without a selected checkpoint is a no-op', async () => {
    const viewModel = createViewModel({ gameId: 'game-1', campaignId: 'campaign-1' });

    await viewModel.confirmFork();

    expect(viewModel.isForking).toBe(false);
    expect(viewModel.forkError).toBeNull();
  });
});

describe('SessionBrowserViewModel — real base class', () => {
  test('extends the production BaseViewModel, not a shared fake', async () => {
    const viewModel = createViewModel();

    expect(viewModel).toBeInstanceOf(BaseViewModel);
    expect('registerEffectRoot' in viewModel).toBe(true);

    viewModel.__mounted = true;
    await viewModel.dispose();
    expect(viewModel.__mounted).toBe(false);
  });
});
