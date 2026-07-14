// apps/frontend/client/src/lib/views/worldgen/world_gen_retry.test.ts
//
// Unit tests for the WorldGenWizardViewModel retry logic — retry counter
// increments, 3-max auto-retry stops, manual retry after limit, and
// back-navigation from error state.
//
// The production VM's _callLlm uses textGenerationService.extractStructure().
// The test_preload stubs $services, so extractStructure returns undefined,
// which triggers "LLM response missing required fields" → auto-retry → error state.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/worldgen/world_gen_retry.test.ts
//
// Contract: C-233

import { describe, expect, test } from 'bun:test';
import { getWorldGenWizardViewModel } from './world_gen_wizard_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FILLED_INPUTS = {
  genre: 'Fantasy',
  tone: 'Heroic',
  setting: 'A mystical forest kingdom threatened by a void corruption.',
  difficulty: 'Medium',
  goals: 'Find the Heart of the Forest and seal the void rift.',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createFilledViewModel = () => {
  return getWorldGenWizardViewModel({
    className: 'WorldGenWizardRetryTest',
    initialInputs: FILLED_INPUTS,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorldGenWizardViewModel — retry logic (C-233)', () => {
  describe('initial retry state', () => {
    test('retriesRemaining starts at 3', () => {
      const vm = createFilledViewModel();
      expect(vm.retriesRemaining).toBe(3);
    });

    test('no generation error initially', () => {
      const vm = createFilledViewModel();
      expect(vm.generationError).toBeUndefined();
    });
  });

  describe('auto-retry on LLM failure', () => {
    test('generateWorld exhausts retries and sets error', async () => {
      const vm = createFilledViewModel();

      await vm.generateWorld();

      // After all auto-retries exhausted
      expect(vm.isGenerating).toBe(false);
      expect(vm.generationError).toBe('LLM response missing required fields');
      expect(vm.retriesRemaining).toBe(0);
      // Should stay on generating step (no world to preview)
      expect(vm.currentStep).toBe('generating');
    });

    test('worldOutput remains undefined after all retries fail', async () => {
      const vm = createFilledViewModel();

      await vm.generateWorld();

      expect(vm.worldOutput).toBeUndefined();
    });
  });

  describe('manual retry after limit', () => {
    test('retryGeneration returns early when retries exhausted', async () => {
      const vm = createFilledViewModel();

      // Exhaust auto-retries
      await vm.generateWorld();
      expect(vm.retriesRemaining).toBe(0);

      // Manual retry should be a no-op
      await vm.retryGeneration();

      // State unchanged
      expect(vm.retriesRemaining).toBe(0);
      expect(vm.isGenerating).toBe(false);
      expect(vm.generationError).toBe('LLM response missing required fields');
    });
  });

  describe('back-navigation from error state', () => {
    test('goBack clears generation error and moves to previous step', async () => {
      const vm = createFilledViewModel();

      // Navigate to goals step then generate
      vm.advanceStep(); // setting_difficulty
      vm.advanceStep(); // goals
      expect(vm.currentStep).toBe('goals');

      await vm.generateWorld();
      expect(vm.generationError).toBeDefined();

      // Go back from error state
      vm.goBack();

      expect(vm.generationError).toBeUndefined();
      expect(vm.currentStep).toBe('goals');
    });

    test('restart after error clears everything', async () => {
      const vm = createFilledViewModel();

      await vm.generateWorld();
      expect(vm.generationError).toBeDefined();

      vm.restart();

      expect(vm.currentStep).toBe('genre_tone');
      expect(vm.generationError).toBeUndefined();
      expect(vm.retriesRemaining).toBe(3);
      expect(vm.isGenerating).toBe(false);
      expect(vm.worldOutput).toBeUndefined();
    });
  });
});
