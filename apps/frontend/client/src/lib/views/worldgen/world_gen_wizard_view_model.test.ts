// apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.test.ts
//
// G01 — wizard ViewModel tests.
//
// The wizard's own responsibility is the step machine and user input;
// generation, cancellation and persistence are the draft service's. These
// tests therefore drive the wizard over a REAL draft service (with a
// controllable provider) rather than a stubbed one, and assert on the steps,
// the labels, and — critically — on which capabilities the wizard can reach.
//
// Contract: G01 — safe private narrative-world drafts

import { describe, expect, test } from 'bun:test';
import { createWorldGenDraftService } from '../../services/worldgen/world_gen_draft_service.svelte.ts';
import {
  coherentPayloads,
  createControllableProvider,
  createMemoryStore,
  WORLD_GEN_WIZARD_INPUT,
} from './testing/world_gen_fixtures.ts';
import {
  createWorldGenWizardViewModel,
  type WorldGenWizardViewModelInterface,
} from './world_gen_wizard_view_model.svelte.ts';

/** Strips whole-line and block comments so prose cannot trip a code check. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type Harness = {
  vm: WorldGenWizardViewModelInterface;
  provider: ReturnType<typeof createControllableProvider>;
  store: ReturnType<typeof createMemoryStore>;
};

const build = (providerOptions: Parameters<typeof createControllableProvider>[0] = {}): Harness => {
  const provider = createControllableProvider({ payloads: coherentPayloads(), ...providerOptions });
  const store = createMemoryStore();
  const vm = createWorldGenWizardViewModel({
    className: 'WorldGenWizardViewModelTest',
    initialInputs: WORLD_GEN_WIZARD_INPUT,
    router: { goToRoute: async () => {} },
    drafts: createWorldGenDraftService({
      className: 'WorldGenDraftServiceTest',
      text: provider.capability,
      resolveStore: async () => store,
      maxAttemptsPerStage: 1,
    }),
  });
  return { vm, provider, store };
};

// ---------------------------------------------------------------------------
// Step machine + inputs (unchanged behaviour from C-233)
// ---------------------------------------------------------------------------

describe('WorldGenWizardViewModel — inputs and steps', () => {
  test('starts at genre_tone with the supplied inputs', () => {
    const { vm } = build();

    expect(vm.currentStep).toBe('genre_tone');
    expect(vm.isFirstStep).toBe(true);
    expect(vm.genre).toBe(WORLD_GEN_WIZARD_INPUT.genre);
    expect(vm.difficulty).toBe('Medium');
  });

  test('pre-fills from initialInputs', () => {
    const { vm } = build();

    expect(vm.genre).toBe(WORLD_GEN_WIZARD_INPUT.genre);
    expect(vm.goals).toBe(WORLD_GEN_WIZARD_INPUT.goals);
  });

  test('canAdvance gates on the inputs each step actually needs', () => {
    const { vm } = build();

    vm.setGenre('');
    expect(vm.canAdvance).toBe(false);
    vm.setGenre('Fantasy');
    expect(vm.canAdvance).toBe(true);

    vm.advanceStep();
    expect(vm.currentStep).toBe('setting_difficulty');
    vm.setSetting('');
    expect(vm.canAdvance).toBe(false);
  });

  test('setDifficulty rejects a value outside the option list', () => {
    const { vm } = build();

    vm.setDifficulty('Hard');
    vm.setDifficulty('Impossible');

    expect(vm.difficulty).toBe('Hard');
  });

  test('advancing through the input steps reaches the last one', () => {
    const { vm } = build();

    vm.advanceStep();
    vm.advanceStep();

    expect(vm.currentStep).toBe('goals');
    expect(vm.isLastInputStep).toBe(true);
  });

  test('goBack walks backwards and stops at the first step', () => {
    const { vm } = build();

    vm.advanceStep();
    vm.goBack();
    expect(vm.currentStep).toBe('genre_tone');
    vm.goBack();
    expect(vm.currentStep).toBe('genre_tone');
  });

  test('Surprise Me fills every input and clears itself on manual edit', () => {
    const { vm } = build();

    vm.surpriseMe();
    expect(vm.genre.length).toBeGreaterThan(0);
    expect(vm.isSurpriseMode).toBe(true);

    vm.setGenre('Horror');
    expect(vm.isSurpriseMode).toBe(false);
  });

  test('progressPercent advances and stays in range', () => {
    const { vm } = build();

    expect(vm.progressPercent).toBe(0);
    vm.advanceStep();
    expect(vm.progressPercent).toBeGreaterThan(0);
    expect(vm.progressPercent).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Generation flow
// ---------------------------------------------------------------------------

describe('WorldGenWizardViewModel — generation', () => {
  test('a successful run lands on preview with a draft', async () => {
    const { vm } = build();

    await vm.generateWorld();

    expect(vm.isGenerating).toBe(false);
    expect(vm.currentStep).toBe('preview');
    expect(vm.draft?.setting?.worldName).toBe('Duskhollow');
    expect(vm.generationError).toBeUndefined();
  });

  test('a failed run stays on generating and surfaces the reason', async () => {
    const { vm } = build({ failEverything: 'provider unreachable' });

    await vm.generateWorld();

    expect(vm.currentStep).toBe('generating');
    expect(vm.isGenerating).toBe(false);
    expect(vm.generationError).toBeTruthy();
    expect(vm.draft).toBeUndefined();
  });

  test('partial failure reports WHICH stage failed', async () => {
    const { vm } = build({ failStages: { places: 'provider unavailable' } });

    await vm.generateWorld();

    expect(vm.stageFailures.map((failure) => failure.stage)).toContain('locations');
  });

  test('completed stages are shown while a run is in flight', async () => {
    const { vm, provider } = build({ delayMs: { cast: 60, places: 60, arcs: 60 } });

    const run = vm.generateWorld();
    await provider.waitForCalls('cast', 1);
    expect(vm.completedStageLabels).toContain('world premise');
    await run;
  });

  test('a completed draft can be accepted and then lands on draft_saved', async () => {
    const { vm } = build();

    await vm.generateWorld();
    expect(vm.canAccept).toBe(true);

    await vm.acceptWorld();

    expect(vm.currentStep).toBe('draft_saved');
    expect(vm.draft?.status).toBe('accepted_preview');
  });

  test('a cancelled run is reported as cancelled, not as a failure', async () => {
    const { vm, provider } = build({ delayMs: { setting: 60, cast: 60, places: 60, arcs: 60 } });

    const run = vm.generateWorld();
    await provider.waitForCalls('setting', 1);
    vm.cancelGeneration();
    await run;

    expect(vm.generationError).toBe('Cancelled by the player');
    expect(vm.draft).toBeUndefined();
  });

  test('persistence state is surfaced so the UI never claims more than it knows', async () => {
    const { vm } = build();

    expect(vm.persistence).toBe('unknown');
    await vm.generateWorld();

    expect(vm.persistence).toBe('durable');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle cancellation
// ---------------------------------------------------------------------------

describe('WorldGenWizardViewModel — lifecycle cancellation', () => {
  test('restart during a run cancels it and discards the result', async () => {
    const { vm, provider } = build({ delayMs: { setting: 80, cast: 80, places: 80 } });

    const run = vm.generateWorld();
    await provider.waitForCalls('setting', 1);
    vm.restart();
    await run;

    expect(vm.draft).toBeUndefined();
    expect(vm.currentStep).toBe('genre_tone');
  });

  test('editInputs during a run cancels it', async () => {
    const { vm, provider } = build({ delayMs: { setting: 80, cast: 80, places: 80 } });

    const run = vm.generateWorld();
    await provider.waitForCalls('setting', 1);
    vm.editInputs();
    await run;

    expect(vm.draft).toBeUndefined();
    expect(vm.currentStep).toBe('genre_tone');
  });

  test('going back from the generating step cancels the run', async () => {
    const { vm, provider } = build({ delayMs: { setting: 80, cast: 80, places: 80 } });

    const run = vm.generateWorld();
    await provider.waitForCalls('setting', 1);
    vm.goBack();
    await run;

    expect(vm.draft).toBeUndefined();
    expect(vm.isGenerating).toBe(false);
  });

  test('going back from preview skips the generating step instead of parking on it', async () => {
    // `generating` renders only while a run is live. Decrementing into it from
    // the preview showed an empty screen with a Cancel button aimed at a run
    // that had already finished.
    const { vm } = build();

    await vm.generateWorld();
    expect(vm.currentStep).toBe('preview');

    vm.goBack();

    expect(vm.currentStep).toBe('goals');
    expect(vm.currentStep).not.toBe('generating');
    // Skipping is navigation, not cancellation: the finished draft survives.
    expect(vm.draft?.status).toBe('complete');
    expect(vm.generationError).toBeUndefined();
  });

  test('going back from the saved draft also skips the generating step', async () => {
    const { vm } = build();

    await vm.generateWorld();
    await vm.acceptWorld();
    expect(vm.currentStep).toBe('draft_saved');

    vm.goBack();

    expect(vm.currentStep).toBe('preview');
  });

  test('changing the connection cancels the run before navigating away', async () => {
    const provider = createControllableProvider({
      payloads: coherentPayloads(),
      delayMs: { setting: 80, cast: 80, places: 80 },
    });
    const routes: string[] = [];
    const vm = createWorldGenWizardViewModel({
      className: 'WorldGenWizardViewModelTest',
      initialInputs: WORLD_GEN_WIZARD_INPUT,
      router: {
        goToRoute: async (route) => {
          routes.push(route);
        },
      },
      drafts: createWorldGenDraftService({
        className: 'WorldGenDraftServiceTest',
        text: provider.capability,
        resolveStore: async () => createMemoryStore(),
      }),
    });

    const run = vm.generateWorld();
    await provider.waitForCalls('setting', 1);
    await vm.changeConnection();
    await run;

    expect(routes).toEqual(['setup']);
    // Cancelled first: the wizard does not navigate away from a live provider
    // call and hope the page unload cleans it up.
    expect(vm.draft).toBeUndefined();
  });

  test('dispose cancels the live run', async () => {
    const { vm, provider } = build({ delayMs: { setting: 80, cast: 80, places: 80 } });

    const run = vm.generateWorld();
    await provider.waitForCalls('setting', 1);
    await vm.dispose();
    await run;

    expect(vm.draft).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Capability boundary
// ---------------------------------------------------------------------------

describe('WorldGenWizardViewModel — capability boundary (G01)', () => {
  test('the wizard has no capability that can mutate a campaign or world state', async () => {
    const source = stripComments(
      await Bun.file(new URL('./world_gen_wizard_view_model.svelte.ts', import.meta.url)).text(),
    );

    for (const forbidden of [
      'subscribeToWorld',
      'addLocation',
      'addNpc',
      'seedNpcs',
      'seedLocations',
      'seedPartyArcs',
      'seedHudWidgets',
      'WorldGenSeedingServiceInterface',
      'activeCampaign',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test('the wizard options type exposes no world-state or seeding capability', async () => {
    const source = stripComments(
      await Bun.file(new URL('./world_gen_wizard_view_model.svelte.ts', import.meta.url)).text(),
    );

    expect(source).not.toContain('worldState');
    expect(source).not.toContain('worldGenSeeding');
  });

  test('the final step is draft_saved, not character creation', async () => {
    const { vm } = build();

    await vm.generateWorld();
    await vm.acceptWorld();

    expect(vm.currentStep).toBe('draft_saved');
    expect(vm.steps).not.toContain('character_creation' as never);
  });
});
