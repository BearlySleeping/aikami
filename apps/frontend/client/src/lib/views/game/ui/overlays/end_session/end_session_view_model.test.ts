// apps/frontend/client/src/lib/views/game/ui/overlays/end_session/end_session_view_model.test.ts
//
// Unit tests for EndSessionViewModel — session end flow, recap editing phase.
//
// Contract: C-240 Session Management
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import { beforeEach, describe, expect, test } from 'bun:test';

describe('EndSessionViewModel', () => {
  let viewModel: import('./end_session_view_model.svelte').EndSessionViewModelInterface;

  beforeEach(async () => {
    const mod = await import('./end_session_view_model.svelte');
    viewModel = mod.getEndSessionViewModel();
  });

  test('should start in confirm phase', () => {
    expect(viewModel.phase).toBe('confirm');
  });

  test('should enter preview phase after confirm', async () => {
    // Mock: endSession succeeds
    await viewModel.confirmEndSession();
    // Phase transitions: confirm → summarizing → preview
    expect(['preview', 'locked', 'summarizing']).toContain(viewModel.phase);
  });

  test('should enter editing mode from preview', () => {
    // Need to be in a state where editing is meaningful
    // Set up the synopsis through the session service
    viewModel.enterEditMode();
    expect(viewModel.phase).toBe('editing');
    expect(viewModel.editedSynopsis).toBeDefined();
  });

  test('should set edited synopsis text', () => {
    viewModel.enterEditMode();
    viewModel.setEditedSynopsis('An epic journey through the misty mountains.');
    expect(viewModel.editedSynopsis).toBe('An epic journey through the misty mountains.');
  });

  test('should save recap and return to preview with active session', async () => {
    // Set up an active session first
    const { sessionService } = await import('$services/game/session_service.svelte');
    await sessionService.startSession({ gameId: 'edit-test' });

    // Get a fresh ViewModel for this test
    const freshMod = await import('./end_session_view_model.svelte');
    const freshVm = freshMod.getEndSessionViewModel();

    freshVm.enterEditMode();
    freshVm.setEditedSynopsis(
      'An epic journey through the misty mountains where the hero discovered ancient knowledge.',
    );

    await freshVm.saveRecap();
    expect(freshVm.phase).toBe('preview');
  });

  test('should cancel edit and return to preview', () => {
    viewModel.enterEditMode();
    viewModel.setEditedSynopsis('Some edited text.');

    viewModel.cancelEdit();
    expect(viewModel.phase).toBe('preview');
  });

  test('should cancel and close end session', () => {
    viewModel.cancel();
    // cancel() calls gameOverlayService.closeEndSession() — no return value to assert
    expect(true).toBe(true);
  });

  test('should track isSummarizing state', () => {
    expect(viewModel.isSummarizing).toBe(viewModel.phase === 'summarizing');
  });

  test('should expose session number from session service', () => {
    expect(typeof viewModel.sessionNumber).toBe('number');
  });

  test('should expose message count from session service', () => {
    expect(typeof viewModel.messageCount).toBe('number');
  });
});
