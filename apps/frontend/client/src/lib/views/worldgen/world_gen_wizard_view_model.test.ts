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
import type { WorldGenInput } from '@aikami/types';
import {
  WorldGenHudWidgetsStageSchema,
  WorldGenLocationsStageSchema,
  WorldGenNpcsStageSchema,
  WorldGenPartyArcsStageSchema,
  WorldGenSettingStageSchema,
} from '$lib/data/ai_prompts/world_gen_schema';
import {
  getWorldGenWizardViewModel,
  WorldGenWizardViewModel,
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

const createViewModel = (options?: Partial<WorldGenWizardViewModelOptions>) =>
  getWorldGenWizardViewModel({
    className: 'WorldGenWizardViewModelTest',
    ...options,
  });

/** Create a VM pre-filled with inputs at the goals step. */
const createPrefilledViewModel = () => createViewModel({ initialInputs: DEFAULT_INPUTS });

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

  // ── C-405 AC-5: parallel generation ──────────────────────────────────

  describe('parallel generation (C-405 AC-5)', () => {
    // Stage-specific fixtures — each generation stage returns only its own
    // section, exercising the real per-stage output contract (C-405 AC-5).
    const StageResponses: Record<string, string> = {
      setting: JSON.stringify({
        worldName: 'Duskhollow',
        worldDescription:
          'Duskhollow is a lantern-lit frontier town in a perpetual twilight valley, where the ember-crowned mountains swallow the sun by midday.',
      }),
      npcs: JSON.stringify({
        npcs: [
          {
            name: 'Maren',
            race: 'Human',
            class: 'Innkeeper',
            role: 'Quest Giver',
            description: 'A weathered innkeeper with a knowing smile and a ledger full of secrets.',
            personality:
              'Hospitable but sharp-tongued, she sizes up every traveler within seconds.',
          },
          {
            name: 'Thorn',
            race: 'Elf',
            class: 'Ranger',
            role: 'Ally',
            description: 'A quiet elf ranger whose cloak is stitched with dried silverleaf.',
            personality: 'Speaks in short sentences and trusts actions over words.',
          },
          {
            name: 'Grimble',
            race: 'Gnome',
            class: 'Tinkerer',
            role: 'Merchant',
            description: 'A goggle-wearing gnome surrounded by humming brass contraptions.',
            personality: 'Bubbly and distractible, he will trade anything for rare cogs.',
          },
        ],
      }),
      locations: JSON.stringify({
        locations: ['The Ember Market', 'Sunken Chapel', 'Ashfall Bridge', 'Cinder Mines'],
      }),
      hudWidgets: JSON.stringify({
        hudWidgets: [
          { slot: 'top-left', label: 'Ember Compass', icon: 'compass', defaultVisibility: true },
        ],
      }),
      partyArcs: JSON.stringify({
        partyArcs: [
          {
            chapter: 'Chapter 1: The Fading Ward',
            description:
              'Maren tasks the party with rekindling the wardstone before the valley dims.',
            objectives: ['Find the wardstone', 'Collect three ember shards', 'Return to Maren'],
            questGivers: ['Maren'],
          },
        ],
      }),
    };

    // The VM passes the per-stage TypeBox schema as the third arg — identity
    // matching tells the mock which stage is being generated.
    const SchemaToStage = new Map<unknown, string>([
      [WorldGenSettingStageSchema, 'setting'],
      [WorldGenNpcsStageSchema, 'npcs'],
      [WorldGenLocationsStageSchema, 'locations'],
      [WorldGenHudWidgetsStageSchema, 'hudWidgets'],
      [WorldGenPartyArcsStageSchema, 'partyArcs'],
    ]);

    // The NPC stage is intentionally slower so the "arcs wait for npcs"
    // ordering is observable: if partyArcs ever ran concurrently with npcs it
    // would start while npcs is still in flight.
    const StageDelays: Record<string, number> = {
      setting: 30,
      npcs: 90,
      locations: 30,
      hudWidgets: 30,
      partyArcs: 30,
    };

    test('independent stages are issued concurrently, arcs after npcs', async () => {
      const stageLog: Array<{ stage: string; start: number; end: number }> = [];
      let activeCalls = 0;
      let maxConcurrent = 0;

      class RecordingViewModel extends WorldGenWizardViewModel {
        protected override async _callLlm(
          _input: WorldGenInput,
          prompt: string,
          schema?: Record<string, unknown>,
        ): Promise<string | undefined> {
          const stage = SchemaToStage.get(schema ?? {});
          if (!stage) {
            throw new Error('Mock received an unexpected stage schema');
          }

          // Inspect the stage inputs instead of ignoring them: every stage
          // prompt carries the shared task section, and partyArcs must embed
          // the resolved NPC roster.
          expect(prompt).toContain('## Task');
          if (stage === 'partyArcs') {
            expect(prompt).toContain('## NPC Roster (already generated)');
          }

          const start = Date.now();
          activeCalls++;
          maxConcurrent = Math.max(maxConcurrent, activeCalls);
          await new Promise((resolve) => setTimeout(resolve, StageDelays[stage] ?? 30));
          activeCalls--;
          stageLog.push({ stage, start, end: Date.now() });

          const response = StageResponses[stage];
          if (!response) {
            throw new Error(`Mock missing response for stage: ${stage}`);
          }
          return response;
        }
      }

      const vm = RecordingViewModel.create({
        className: 'WorldGenConcurrencyTest',
        initialInputs: DEFAULT_INPUTS,
      });

      await vm.generateWorld();

      const npcEntry = stageLog.find((entry) => entry.stage === 'npcs');
      const arcsEntry = stageLog.find((entry) => entry.stage === 'partyArcs');
      if (!npcEntry || !arcsEntry) {
        throw new Error('npcs/partyArcs stage entries were not recorded');
      }

      // 4 independent stages overlap (concurrent); the 5th (partyArcs) runs
      // only after the NPC roster resolves, so it never raises the max.
      expect(maxConcurrent).toBe(4);
      // partyArcs may only begin after npcs has completed (questGivers must
      // reference roster names) — the distinct NPC delay makes a concurrent
      // start observable.
      expect(arcsEntry.start).toBeGreaterThanOrEqual(npcEntry.end);
      expect(vm.isGenerating).toBe(false);
      expect(vm.currentStep).toBe('preview');
      expect(vm.worldOutput?.worldName).toBe('Duskhollow');
      expect(vm.worldOutput?.npcs).toHaveLength(3);
      expect(vm.worldOutput?.partyArcs?.[0]?.questGivers).toContain('Maren');
      expect(vm.worldOutput?.locations).toHaveLength(4);
      expect(vm.worldOutput?.hudWidgets).toHaveLength(1);
    });

    test('a failed stage propagates the empty-response error into retry state', async () => {
      class FailingViewModel extends WorldGenWizardViewModel {
        protected override async _callLlm(
          _input: WorldGenInput,
          _prompt: string,
          _schema?: Record<string, unknown>,
        ): Promise<string | undefined> {
          return undefined;
        }
      }

      const vm = FailingViewModel.create({
        className: 'WorldGenFailureTest',
        initialInputs: DEFAULT_INPUTS,
      });

      await vm.generateWorld();

      expect(vm.isGenerating).toBe(false);
      expect(vm.generationError).toBe('LLM returned empty response');
      expect(vm.retriesRemaining).toBe(0);
      expect(vm.worldOutput).toBeUndefined();
    });
  });
});
