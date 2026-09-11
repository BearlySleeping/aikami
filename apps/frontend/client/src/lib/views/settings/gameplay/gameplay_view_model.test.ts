// apps/frontend/client/src/lib/views/settings/gameplay/gameplay_view_model.test.ts
//
// Unit tests for GameplayViewModel — quick toggles, difficulty validation, and
// quest-overlay visibility. Exercises the ViewModel through feature-owned
// fixtures — no global `$services` barrel mock.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createGameplayViewModel } from './gameplay_view_model.svelte';
import { createGameplayOverlay } from './testing/gameplay_fixtures.ts';

const createViewModel = (overlay = createGameplayOverlay()) =>
  createGameplayViewModel({ className: 'GameplayViewModelTest', overlay });

describe('GameplayViewModel — defaults', () => {
  test('starts with hints on, autosave on, and medium difficulty', () => {
    const viewModel = createViewModel();

    expect(viewModel.tutorialHints).toBe(true);
    expect(viewModel.autosave).toBe(true);
    expect(viewModel.difficulty).toBe('medium');
    expect(viewModel.difficultyOptions.map((option) => option.id)).toEqual([
      'easy',
      'medium',
      'hard',
    ]);
  });
});

describe('GameplayViewModel — toggles', () => {
  test('toggleTutorialHints and toggleAutosave flip their flags', () => {
    const viewModel = createViewModel();

    viewModel.toggleTutorialHints();
    viewModel.toggleAutosave();

    expect(viewModel.tutorialHints).toBe(false);
    expect(viewModel.autosave).toBe(false);
  });

  test('setDifficulty accepts valid ids and ignores invalid ones', () => {
    const viewModel = createViewModel();

    viewModel.setDifficulty('hard');
    expect(viewModel.difficulty).toBe('hard');

    viewModel.setDifficulty('impossible');
    expect(viewModel.difficulty).toBe('hard');
  });
});

describe('GameplayViewModel — quest overlay', () => {
  test('questOverlayVisible reads from the overlay capability', () => {
    const viewModel = createViewModel(createGameplayOverlay({ visible: false }));

    expect(viewModel.questOverlayVisible).toBe(false);
  });

  test('toggleQuestOverlay delegates to the overlay capability', () => {
    const toggleVisible = mock(() => {});
    const viewModel = createViewModel(createGameplayOverlay({ toggleVisible }));

    viewModel.toggleQuestOverlay();

    expect(toggleVisible).toHaveBeenCalledTimes(1);
  });

  test('resetDefaults restores flags and makes the overlay visible', () => {
    const setVisible = mock((_visible: boolean) => {});
    const viewModel = createViewModel(createGameplayOverlay({ visible: false, setVisible }));
    viewModel.toggleTutorialHints();
    viewModel.setDifficulty('hard');

    viewModel.resetDefaults();

    expect(viewModel.tutorialHints).toBe(true);
    expect(viewModel.autosave).toBe(true);
    expect(viewModel.difficulty).toBe('medium');
    expect(setVisible).toHaveBeenCalledWith(true);
  });
});

describe('GameplayViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
