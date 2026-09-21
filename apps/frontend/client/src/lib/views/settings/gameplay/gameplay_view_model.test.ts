// apps/frontend/client/src/lib/views/settings/gameplay/gameplay_view_model.test.ts
//
// Unit tests for GameplayViewModel — quick toggles, difficulty validation, and
// quest-overlay visibility. Exercises the ViewModel through feature-owned
// fixtures — no global `$services` barrel mock.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createGameplayViewModel } from './gameplay_view_model.svelte';
import { createGameplayMotion, createGameplayOverlay } from './testing/gameplay_fixtures.ts';

const createViewModel = (overlay = createGameplayOverlay(), motion = createGameplayMotion()) =>
  createGameplayViewModel({ className: 'GameplayViewModelTest', overlay, motion });

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

describe('GameplayViewModel — motion preference (C-527 AC-6)', () => {
  test('reads the selection from the shared motion capability', () => {
    const viewModel = createViewModel(
      createGameplayOverlay(),
      createGameplayMotion({ preference: 'reduce' }),
    );

    expect(viewModel.motionPreference).toBe('reduce');
  });

  test('offers exactly the three selections, with auto first', () => {
    const viewModel = createViewModel();

    expect(viewModel.motionOptions.map((option) => option.id)).toEqual(['auto', 'reduce', 'full']);
  });

  test('setMotionPreference writes through to the shared capability', () => {
    const setPreference = mock((_preference: string) => {});
    const viewModel = createViewModel(
      createGameplayOverlay(),
      createGameplayMotion({ setPreference: setPreference as (p: never) => void }),
    );

    viewModel.setMotionPreference('full');

    expect(setPreference).toHaveBeenCalledWith('full');
    expect(viewModel.motionPreference).toBe('full');
  });

  test('an unknown selection is ignored, never written', () => {
    const setPreference = mock((_preference: string) => {});
    const viewModel = createViewModel(
      createGameplayOverlay(),
      createGameplayMotion({ setPreference: setPreference as (p: never) => void }),
    );

    viewModel.setMotionPreference('sideways' as never);

    expect(setPreference).not.toHaveBeenCalled();
    expect(viewModel.motionPreference).toBe('auto');
  });

  test('the bindable control value validates before writing', () => {
    const setPreference = mock((_preference: string) => {});
    const viewModel = createViewModel(
      createGameplayOverlay(),
      createGameplayMotion({ setPreference: setPreference as (p: never) => void }),
    );

    viewModel.motionPreferenceValue = 'reduce';
    viewModel.motionPreferenceValue = 'sideways';

    expect(setPreference).toHaveBeenCalledTimes(1);
    expect(setPreference).toHaveBeenCalledWith('reduce');
  });

  test('resetDefaults returns motion to the system setting', () => {
    const viewModel = createViewModel(
      createGameplayOverlay({ setVisible: () => {} }),
      createGameplayMotion({ preference: 'reduce' }),
    );

    viewModel.resetDefaults();

    expect(viewModel.motionPreference).toBe('auto');
  });
});

describe('GameplayViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
