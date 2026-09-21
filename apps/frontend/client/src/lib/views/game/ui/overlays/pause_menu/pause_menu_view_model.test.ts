// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.test.ts
//
// Unit tests for PauseMenuViewModel — overlay delegation, quit confirmation, and
// roll-history toggle. Exercises the ViewModel through feature-owned fixtures —
// no global `$services` barrel mock.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  createPauseMenuViewModel,
  type PauseMenuOverlayCapabilities,
} from './pause_menu_view_model.svelte';
import { createPauseMenuDice, createPauseMenuOverlay } from './testing/pause_menu_fixtures.ts';

const createViewModel = (overlay: PauseMenuOverlayCapabilities = createPauseMenuOverlay()) =>
  createPauseMenuViewModel({
    className: 'PauseMenuViewModelTest',
    overlay,
    dice: createPauseMenuDice(),
  });

describe('PauseMenuViewModel — overlay state', () => {
  test('reads saving state and message from the overlay capability', () => {
    const viewModel = createViewModel(
      createPauseMenuOverlay({ isSaving: true, saveMessage: 'Saving…' }),
    );

    expect(viewModel.isSaving).toBe(true);
    expect(viewModel.saveMessage).toBe('Saving…');
  });

  test('delegates gameplay actions to the overlay capability', async () => {
    const resumeGame = mock(() => {});
    const saveGame = mock(async () => {});
    const goToSettings = mock(async () => {});
    const openEndSession = mock(() => {});
    const replayOnboarding = mock(() => {});
    const openReputation = mock(() => {});
    const viewModel = createViewModel(
      createPauseMenuOverlay({
        resumeGame,
        saveGame,
        goToSettings,
        openEndSession,
        replayOnboarding,
        openReputation,
      }),
    );

    viewModel.resumeGame();
    await viewModel.saveGame();
    await viewModel.goToSettings();
    viewModel.openEndSession();
    viewModel.replayOnboarding();
    viewModel.openReputation();

    expect(resumeGame).toHaveBeenCalledTimes(1);
    expect(saveGame).toHaveBeenCalledTimes(1);
    expect(goToSettings).toHaveBeenCalledTimes(1);
    expect(openEndSession).toHaveBeenCalledTimes(1);
    expect(replayOnboarding).toHaveBeenCalledTimes(1);
    expect(openReputation).toHaveBeenCalledTimes(1);
  });
});

describe('PauseMenuViewModel — quit confirmation', () => {
  test('requestQuit and cancelQuit toggle confirmingQuit', () => {
    const viewModel = createViewModel();

    viewModel.requestQuit();
    expect(viewModel.confirmingQuit).toBe(true);

    viewModel.cancelQuit();
    expect(viewModel.confirmingQuit).toBe(false);
  });

  test('confirmQuit delegates to the overlay capability', async () => {
    const quitToMainMenu = mock(async () => {});
    const viewModel = createViewModel(createPauseMenuOverlay({ quitToMainMenu }));

    viewModel.requestQuit();
    await viewModel.confirmQuit();

    expect(quitToMainMenu).toHaveBeenCalledTimes(1);
    expect(viewModel.confirmingQuit).toBe(true);
  });
});

describe('PauseMenuViewModel — roll history', () => {
  test('reads roll history from the dice capability', () => {
    const viewModel = createPauseMenuViewModel({
      className: 'PauseMenuViewModelTest',
      overlay: createPauseMenuOverlay(),
      dice: createPauseMenuDice([
        { roll: 15, sides: 20, modifier: 3, total: 18, timestamp: new Date() },
      ]),
    });

    expect(viewModel.rollHistory).toHaveLength(1);
    expect(viewModel.rollHistory[0].total).toBe(18);
  });

  test('openRollHistory and closeRollHistory toggle the panel', () => {
    const viewModel = createViewModel();

    viewModel.openRollHistory();
    expect(viewModel.isRollHistoryOpen).toBe(true);

    viewModel.closeRollHistory();
    expect(viewModel.isRollHistoryOpen).toBe(false);
  });
});

describe('PauseMenuViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
