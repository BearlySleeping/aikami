// apps/frontend/client/src/lib/views/game/ui/overlays/end_session/end_session_view_model.test.ts
//
// Unit tests for EndSessionViewModel — session end flow, recap editing phase.
//
// This suite exercises the ViewModel through feature-owned fixtures — no
// global `$services` barrel mock and no dependency on the test_preload mock
// inventory. Each test constructs exactly the capabilities it needs.
//
// Contract: C-240 Session Management
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  createEndSessionViewModel,
  type EndSessionOverlayCapabilities,
  type EndSessionSessionCapabilities,
} from './end_session_view_model.svelte';
import {
  createEndSessionOverlay,
  createEndSessionSession,
  createGameSession,
} from './testing/end_session_fixtures.ts';

const createViewModel = (
  overlay: EndSessionOverlayCapabilities = createEndSessionOverlay(),
  session: EndSessionSessionCapabilities = createEndSessionSession(),
) => createEndSessionViewModel({ className: 'EndSessionViewModelTest', overlay, session });

describe('EndSessionViewModel', () => {
  test('should start in confirm phase', () => {
    expect(createViewModel().phase).toBe('confirm');
  });

  test('should enter preview phase after confirm', async () => {
    const endSession = mock(async () => {});
    const viewModel = createViewModel(createEndSessionOverlay({ endSession }));

    await viewModel.confirmEndSession();

    expect(viewModel.phase).toBe('preview');
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  test('should enter locked phase when confirm fails', async () => {
    const endSession = mock(async () => {
      throw new Error('summarization failed');
    });
    const viewModel = createViewModel(createEndSessionOverlay({ endSession }));

    await viewModel.confirmEndSession();

    expect(viewModel.phase).toBe('locked');
  });

  test('should enter editing mode from preview', () => {
    const viewModel = createViewModel();

    viewModel.enterEditMode();

    expect(viewModel.phase).toBe('editing');
    expect(viewModel.editedSynopsis).toBeDefined();
  });

  test('should seed the edited synopsis from the active session', () => {
    const viewModel = createViewModel(
      createEndSessionOverlay(),
      createEndSessionSession({
        activeSession: createGameSession({ editedSynopsis: 'Previously saved synopsis.' }),
      }),
    );

    viewModel.enterEditMode();

    expect(viewModel.editedSynopsis).toBe('Previously saved synopsis.');
  });

  test('should set edited synopsis text', () => {
    const viewModel = createViewModel();

    viewModel.enterEditMode();
    viewModel.setEditedSynopsis('An epic journey through the misty mountains.');

    expect(viewModel.editedSynopsis).toBe('An epic journey through the misty mountains.');
  });

  test('should save recap and return to preview with active session', async () => {
    const updateSessionRecap = mock(async () => {});
    const viewModel = createViewModel(
      createEndSessionOverlay(),
      createEndSessionSession({
        activeSession: createGameSession({
          id: 'edit-test',
          sessionNumber: 1,
          messageCount: 5,
          editedSynopsis: '',
        }),
        updateSessionRecap,
      }),
    );

    viewModel.enterEditMode();
    viewModel.setEditedSynopsis(
      'An epic journey through the misty mountains where the hero discovered ancient knowledge.',
    );

    await viewModel.saveRecap();

    expect(viewModel.phase).toBe('preview');
    expect(updateSessionRecap).toHaveBeenCalledWith({
      sessionId: 'edit-test',
      editedSynopsis:
        'An epic journey through the misty mountains where the hero discovered ancient knowledge.',
    });
  });

  test('should not save recap when there is no active session', async () => {
    const updateSessionRecap = mock(async () => {});
    const viewModel = createViewModel(
      createEndSessionOverlay(),
      createEndSessionSession({ activeSession: null, updateSessionRecap }),
    );

    viewModel.enterEditMode();
    viewModel.setEditedSynopsis('An edited synopsis long enough to pass validation.');

    await viewModel.saveRecap();

    expect(updateSessionRecap).not.toHaveBeenCalled();
  });

  test('should cancel edit and return to preview', () => {
    const viewModel = createViewModel();

    viewModel.enterEditMode();
    viewModel.setEditedSynopsis('Some edited text.');

    viewModel.cancelEdit();

    expect(viewModel.phase).toBe('preview');
    expect(viewModel.editedSynopsis).toBe('');
  });

  test('should cancel and close end session', () => {
    const closeEndSession = mock(() => {});
    const viewModel = createViewModel(createEndSessionOverlay({ closeEndSession }));

    viewModel.cancel();

    expect(closeEndSession).toHaveBeenCalledTimes(1);
  });

  test('should track isSummarizing state', () => {
    expect(createViewModel().isSummarizing).toBe(false);
  });

  test('should expose session number and message count from the session capability', () => {
    const viewModel = createViewModel(
      createEndSessionOverlay(),
      createEndSessionSession({
        activeSession: createGameSession({ sessionNumber: 3, messageCount: 42 }),
      }),
    );

    expect(viewModel.sessionNumber).toBe(3);
    expect(viewModel.messageCount).toBe(42);
  });

  test('extends the production BaseViewModel, not a shared fake', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
