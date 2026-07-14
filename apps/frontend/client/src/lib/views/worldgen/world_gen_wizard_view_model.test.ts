// apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.test.ts
//
// Unit tests for WorldGenWizardViewModel — state machine, step navigation,
// retry logic, Surprise Me, and input validation.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/worldgen/world_gen_wizard_view_model.test.ts
//
// Contract: C-233

import { describe, expect, test } from 'bun:test';
import {
  getWorldGenWizardViewModel,
  type WorldGenWizardViewModelOptions,
} from './world_gen_wizard_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_INPUTS = {
  genre: 'Fantasy',
  tone: 'Heroic',
  setting: 'A mystical forest kingdom threatened by a void corruption.',
  difficulty: 'Medium',
  goals: 'Find the Heart of the Forest and seal the void rift.',
};

const createViewModel = (options?: Partial<WorldGenWizardViewModelOptions>) => {
  return getWorldGenWizardViewModel({
    className: 'WorldGenWizardViewModelTest',
    ...options,
  });
};

/** Create a VM pre-filled with inputs at the goals step. */
const createPrefilledViewModel = () => {
  return createViewModel({ initialInputs: DEFAULT_INPUTS });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorldGenWizardViewModel — C-233', () => {
  describe('initial state', () => {
    test('starts at genre_tone step', () => {
      const vm = createViewModel();
      expect(vm.currentStep).toBe('genre_tone');
      expect(vm.isFirstStep).toBe(true);
      expect(vm.isLastInputStep).toBe(false);
    });

    test('initial inputs are empty', () => {
      const vm = createViewModel();
      expect(vm.genre).toBe('');
      expect(vm.tone).toBe('');
      expect(vm.setting).toBe('');
      expect(vm.goals).toBe('');
      expect(vm.difficulty).toBe('Medium');
    });

    test('initial state is not generating and has no error', () => {
      const vm = createViewModel();
      expect(vm.isGenerating).toBe(false);
      expect(vm.generationError).toBeUndefined();
      expect(vm.worldOutput).toBeUndefined();
      expect(vm.retriesRemaining).toBe(3);
      expect(vm.isSurpriseMode).toBe(false);
    });

    test('pre-fills inputs from initialInputs option', () => {
      const vm = createPrefilledViewModel();
      expect(vm.genre).toBe('Fantasy');
      expect(vm.tone).toBe('Heroic');
      expect(vm.setting).toBe(DEFAULT_INPUTS.setting);
      expect(vm.difficulty).toBe('Medium');
      expect(vm.goals).toBe(DEFAULT_INPUTS.goals);
    });
  });

  describe('step navigation', () => {
    test('canAdvance is false when inputs are empty at genre_tone', () => {
      const vm = createViewModel();
      expect(vm.canAdvance).toBe(false);
    });

    test('canAdvance is true when genre and tone are set', () => {
      const vm = createViewModel();
      vm.setGenre('Fantasy');
      vm.setTone('Heroic');
      expect(vm.canAdvance).toBe(true);
    });

    test('advanceStep moves to next step', () => {
      const vm = createViewModel();
      vm.setGenre('Fantasy');
      vm.setTone('Heroic');
      vm.advanceStep();
      expect(vm.currentStep).toBe('setting_difficulty');
    });

    test('advanceStep does nothing when canAdvance is false', () => {
      const vm = createViewModel();
      vm.advanceStep();
      expect(vm.currentStep).toBe('genre_tone');
    });

    test('goBack returns to previous step', () => {
      const vm = createPrefilledViewModel();
      vm.advanceStep(); // to setting_difficulty
      expect(vm.currentStep).toBe('setting_difficulty');
      vm.goBack();
      expect(vm.currentStep).toBe('genre_tone');
    });

    test('goBack does nothing on first step', () => {
      const vm = createViewModel();
      vm.goBack();
      expect(vm.currentStep).toBe('genre_tone');
    });

    test('full navigation through input steps', () => {
      const vm = createPrefilledViewModel();
      expect(vm.currentStep).toBe('genre_tone');
      vm.advanceStep();
      expect(vm.currentStep).toBe('setting_difficulty');
      vm.advanceStep();
      expect(vm.currentStep).toBe('goals');
      expect(vm.isLastInputStep).toBe(true);
    });
  });

  describe('canAdvance per step', () => {
    test('canAdvance for genre_tone requires genre and tone', () => {
      const vm = createViewModel();
      vm.setGenre('Fantasy');
      expect(vm.canAdvance).toBe(false);
      vm.setTone('Heroic');
      expect(vm.canAdvance).toBe(true);
    });

    test('canAdvance for setting_difficulty requires setting', () => {
      const vm = createPrefilledViewModel();
      vm.advanceStep(); // now at setting_difficulty
      expect(vm.currentStep).toBe('setting_difficulty');
      expect(vm.canAdvance).toBe(true); // setting already filled

      // Clear setting
      vm.setSetting('');
      expect(vm.canAdvance).toBe(false);
    });

    test('canAdvance for goals requires goals', () => {
      const vm = createPrefilledViewModel();
      vm.advanceStep(); // setting_difficulty
      vm.advanceStep(); // goals
      expect(vm.canAdvance).toBe(true); // goals already filled

      vm.setGoals('');
      expect(vm.canAdvance).toBe(false);
    });
  });

  describe('step setters', () => {
    test('setGenre updates genre and clears surprise mode', () => {
      const vm = createViewModel();
      vm.surpriseMe();
      expect(vm.isSurpriseMode).toBe(true);
      vm.setGenre('Science Fiction');
      expect(vm.genre).toBe('Science Fiction');
      expect(vm.isSurpriseMode).toBe(false);
    });

    test('setTone updates tone', () => {
      const vm = createViewModel();
      vm.setTone('Dark');
      expect(vm.tone).toBe('Dark');
    });

    test('setDifficulty only accepts valid options', () => {
      const vm = createViewModel();
      vm.setDifficulty('Hard');
      expect(vm.difficulty).toBe('Hard');
      vm.setDifficulty('Invalid' as 'Easy');
      expect(vm.difficulty).toBe('Hard'); // unchanged
    });

    test('setSetting updates setting', () => {
      const vm = createViewModel();
      vm.setSetting('A dark forest');
      expect(vm.setting).toBe('A dark forest');
    });

    test('setGoals updates goals', () => {
      const vm = createViewModel();
      vm.setGoals('Save the world');
      expect(vm.goals).toBe('Save the world');
    });
  });

  describe('Surprise Me', () => {
    test('surpriseMe fills all inputs', () => {
      const vm = createViewModel();
      vm.surpriseMe();
      expect(vm.genre.length).toBeGreaterThan(0);
      expect(vm.tone.length).toBeGreaterThan(0);
      expect(vm.setting.length).toBeGreaterThan(0);
      expect(vm.goals.length).toBeGreaterThan(0);
      expect(vm.difficulty.length).toBeGreaterThan(0);
      expect(vm.isSurpriseMode).toBe(true);
    });

    test('surpriseMe can be called multiple times', () => {
      const vm = createViewModel();
      vm.surpriseMe();
      const _firstGenre = vm.genre;
      vm.surpriseMe();
      // Always valid even if same preset rolled
      expect(vm.genre.length).toBeGreaterThan(0);
      // At least one call should give a valid preset
      expect(vm.difficulty).toMatch(/^(Easy|Medium|Hard)$/);
    });

    test('surpriseMe clears generation error', () => {
      const vm = createViewModel();
      vm.surpriseMe();
      expect(vm.generationError).toBeUndefined();
    });
  });

  describe('reset / edit', () => {
    test('restart resets all state', () => {
      const vm = createPrefilledViewModel();
      vm.advanceStep();
      vm.restart();
      expect(vm.currentStep).toBe('genre_tone');
      expect(vm.genre).toBe('');
      expect(vm.tone).toBe('');
      expect(vm.setting).toBe('');
      expect(vm.goals).toBe('');
      expect(vm.difficulty).toBe('Medium');
      expect(vm.worldOutput).toBeUndefined();
      expect(vm.isGenerating).toBe(false);
      expect(vm.generationError).toBeUndefined();
      expect(vm.retriesRemaining).toBe(3);
      expect(vm.isSurpriseMode).toBe(false);
    });

    test('editInputs goes back to first step and clears output', () => {
      const vm = createPrefilledViewModel();
      vm.advanceStep();
      vm.editInputs();
      expect(vm.currentStep).toBe('genre_tone');
      expect(vm.worldOutput).toBeUndefined();
      // Inputs preserved
      expect(vm.genre).toBe('Fantasy');
    });
  });

  describe('progressPercent', () => {
    test('starts at 0', () => {
      const vm = createViewModel();
      expect(vm.progressPercent).toBe(0);
    });

    test('increases as steps advance', () => {
      const vm = createPrefilledViewModel();
      expect(vm.progressPercent).toBe(0);
      vm.advanceStep();
      expect(vm.progressPercent).toBeGreaterThan(0);
      expect(vm.progressPercent).toBeLessThanOrEqual(100);
    });
  });

  describe('gmPromptPreview', () => {
    test('returns assembled prompt with current inputs', () => {
      const vm = createViewModel();
      vm.setGenre('Fantasy');
      vm.setTone('Heroic');
      const prompt = vm.gmPromptPreview;
      expect(prompt).toContain('Fantasy');
      expect(prompt).toContain('Heroic');
      expect(prompt).toContain('master world-builder');
      expect(prompt).toContain('## User Input');
    });
  });
});
