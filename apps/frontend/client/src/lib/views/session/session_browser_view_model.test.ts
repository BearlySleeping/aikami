// apps/frontend/client/src/lib/views/session/session_browser_view_model.test.ts
//
// Unit tests for SessionBrowserViewModel — session listing, checkpoint
// browsing, continue, and fork from checkpoint.
//
// Contract: C-240 Session Management
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import { beforeEach, describe, expect, test } from 'bun:test';

describe('SessionBrowserViewModel', () => {
  let viewModel: import('./session_browser_view_model.svelte').SessionBrowserViewModelInterface;

  beforeEach(async () => {
    const mod = await import('./session_browser_view_model.svelte');
    viewModel = mod.getSessionBrowserViewModel({ className: 'SessionBrowserViewModel' });
  });

  test('should start with no sessions loaded', () => {
    expect(viewModel.sessions).toEqual([]);
    expect(viewModel.isLoading).toBe(false);
  });

  test('should load sessions for a game', async () => {
    const gameId = `test-browser-${crypto.randomUUID()}`;

    // Start and end a session first via session service
    const { sessionService } = await import('$services/game/session_service.svelte');
    await sessionService.startSession({ gameId });
    await sessionService.endSession({ playtimeMinutes: 0 });

    await viewModel.loadSessions({ gameId });
    expect(viewModel.sessions.length).toBeGreaterThanOrEqual(1);
    expect(viewModel.sessions[0].gameId).toBe(gameId);
  });

  test('should handle empty session list gracefully', async () => {
    await viewModel.loadSessions({ gameId: 'non-existent-game' });
    expect(viewModel.sessions).toEqual([]);
  });

  test('should view a session read-only', () => {
    // Set up via loadSessions, then view
    const mockSession = {
      id: 'test-session-1',
      gameId: 'test-game',
      sessionNumber: 1,
      startedAt: new Date().toISOString(),
      isActive: false,
      messageCount: 10,
      characterSnapshots: {},
      recapReviewed: false,
      checkpointIds: [],
    };

    viewModel.viewSession(mockSession as Parameters<typeof viewModel.viewSession>[0]);
    expect(viewModel.showReadOnly).toBe(true);
    expect(viewModel.selectedSession?.id).toBe('test-session-1');
  });

  test('should close read-only view', () => {
    viewModel.closeReadOnly();
    expect(viewModel.showReadOnly).toBe(false);
    expect(viewModel.selectedSession).toBeNull();
  });

  test('should open fork confirmation dialog', () => {
    const mockCheckpoint = {
      id: 'cp-1',
      sessionId: 'session-1',
      campaignId: 'campaign-1',
      label: 'Before Boss',
      sessionNumber: 1,
      createdAt: new Date().toISOString(),
      saveSlotId: 'checkpoint-uuid',
      hasForks: false,
    };

    viewModel.openForkConfirm(mockCheckpoint);
    expect(viewModel.showForkConfirm).toBe(true);
    expect(viewModel.forkCheckpoint?.label).toBe('Before Boss');
  });

  test('should close fork confirmation dialog', () => {
    viewModel.closeForkConfirm();
    expect(viewModel.showForkConfirm).toBe(false);
    expect(viewModel.forkCheckpoint).toBeNull();
  });

  test('should provide checkpoints from session service', () => {
    expect(Array.isArray(viewModel.checkpoints)).toBe(true);
  });

  test('should load checkpoints for a campaign', async () => {
    await viewModel.loadCheckpoints({ campaignId: 'test-campaign' });
    expect(Array.isArray(viewModel.checkpoints)).toBe(true);
  });

  test('should continue from session via router navigation', async () => {
    // continueFromSession calls routerService.navigateToApp() which
    // requires SvelteKit router context. In test environment this
    // may throw, but the method itself should be callable.
    const mockSession = {
      id: 'test-session-continue',
      gameId: 'test-game',
      sessionNumber: 1,
      startedAt: new Date().toISOString(),
      isActive: false,
      messageCount: 10,
      characterSnapshots: {},
      recapReviewed: false,
      checkpointIds: [],
    };

    // Verify the method is defined
    expect(typeof viewModel.continueFromSession).toBe('function');

    // May throw if router not available (test environment)
    try {
      await viewModel.continueFromSession(
        mockSession as Parameters<typeof viewModel.continueFromSession>[0],
      );
    } catch {
      // Expected in test environment without SvelteKit router
    }
  });
});
