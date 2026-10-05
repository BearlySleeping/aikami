// apps/frontend/client/src/browser_tests/worldgen/world_gen_draft.browser.test.ts
//
// Real-runes coverage for the G01 world-generation wizard.
//
// The Bun suite proves the orchestration logic; this lane exists because the
// wizard's whole job is reactivity under load — `isGenerating`, the completed
// stage list and the draft itself all flip while an async run is in flight, and
// a stubbed `$state` cannot see that. Here the real Svelte compiler runs in
// Chromium, so these assertions are about what the UI would actually render.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createWorldGenDraftService } from '../../lib/services/worldgen/world_gen_draft_service.svelte.ts';
import {
  coherentPayloads,
  createControllableProvider,
  createMemoryStore,
  WORLD_GEN_WIZARD_INPUT,
} from '../../lib/views/worldgen/testing/world_gen_fixtures.ts';
import { createWorldGenWizardViewModel } from '../../lib/views/worldgen/world_gen_wizard_view_model.svelte.ts';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

type Harness = {
  vm: ReturnType<typeof createWorldGenWizardViewModel>;
  provider: ReturnType<typeof createControllableProvider>;
  store: ReturnType<typeof createMemoryStore>;
};

const build = (providerOptions: Parameters<typeof createControllableProvider>[0] = {}): Harness => {
  const provider = createControllableProvider({ payloads: coherentPayloads(), ...providerOptions });
  const store = createMemoryStore();
  const vm = createWorldGenWizardViewModel({
    className: 'WorldGenDraftBrowserTest',
    initialInputs: WORLD_GEN_WIZARD_INPUT,
    router: { goToRoute: async () => {} } as never,
    drafts: createWorldGenDraftService({
      className: 'WorldGenDraftServiceBrowserTest',
      text: provider.capability,
      resolveStore: async () => store,
      maxAttemptsPerStage: 1,
    }),
  });
  disposables.push(() => vm.dispose());
  return { vm, provider, store };
};

describe('WorldGenWizardViewModel — real runes (G01)', () => {
  test('isGenerating is reactive and clears when the run lands on preview', async () => {
    const { vm } = build({ delayMs: { setting: 40, cast: 40, places: 40, arcs: 40 } });

    expect(vm.isGenerating).toBe(false);

    const run = vm.generateWorld();
    flushSync();
    expect(vm.isGenerating).toBe(true);
    expect(vm.currentStep).toBe('generating');

    await run;
    flushSync();

    expect(vm.isGenerating).toBe(false);
    expect(vm.currentStep).toBe('preview');
    expect(vm.draft?.setting?.worldName).toBe('Duskhollow');
  });

  test('the completed-stage readout grows as stages resolve', async () => {
    const { vm, provider } = build({ delayMs: { cast: 40, places: 40, hudWidgets: 40, arcs: 40 } });

    const run = vm.generateWorld();
    // Wait for the SECOND round to start: `cast` is only issued after the
    // `setting` round has settled and published its checkpoint, so observing a
    // `cast` call is what proves the readout has been updated.
    await provider.waitForCalls('cast', 1);
    flushSync();
    expect(vm.completedStageLabels).toContain('world premise');
    expect(vm.completedStageLabels).not.toContain('character roster');

    await run;
    flushSync();
    expect(vm.completedStageLabels).toHaveLength(5);
  });

  test('cancelling flips isGenerating off and leaves no draft', async () => {
    const { vm, provider } = build({ delayMs: { setting: 60, cast: 60, places: 60 } });

    const run = vm.generateWorld();
    await provider.waitForCalls('setting', 1);
    flushSync();
    vm.cancelGeneration();
    flushSync();

    expect(vm.isGenerating).toBe(false);

    await run;
    flushSync();

    expect(vm.draft).toBeUndefined();
    expect(vm.generationError).toBe('Cancelled by the player');
  });

  test('persistence becomes durable only after the run actually persisted', async () => {
    const { vm } = build();

    expect(vm.persistence).toBe('unknown');
    await vm.generateWorld();
    flushSync();

    expect(vm.persistence).toBe('durable');
    // The UI can only offer Save Draft once there is a complete draft.
    expect(vm.canAccept).toBe(true);
  });

  test('accepting advances to draft_saved, not to character creation', async () => {
    const { vm, store } = build();

    await vm.generateWorld();
    await vm.acceptWorld();
    flushSync();

    expect(vm.currentStep).toBe('draft_saved');
    // Acceptance is a status change on the private row. Nothing is published,
    // so there is nothing to observe here beyond the row itself.
    expect(store.rows.get(vm.draft?.draftId as string)?.status).toBe('accepted_preview');
  });

  test('initialize restores inputs and the preview step from the stored draft', async () => {
    const { vm, store } = build();

    await vm.generateWorld();
    const draftId = vm.draft?.draftId as string;

    // A fresh ViewModel over the SAME store — what a page reload produces.
    const reloaded = createWorldGenWizardViewModel({
      className: 'WorldGenDraftBrowserTest',
      router: { goToRoute: async () => {} } as never,
      drafts: createWorldGenDraftService({
        className: 'WorldGenDraftServiceBrowserTest',
        text: { extractStructure: async () => ({}) },
        resolveStore: async () => store,
      }),
    });
    disposables.push(() => reloaded.dispose());
    expect(reloaded.currentStep).toBe('genre_tone');

    await reloaded.initialize();
    flushSync();

    expect(reloaded.currentStep).toBe('preview');
    expect(reloaded.draft?.draftId).toBe(draftId);
    expect(reloaded.genre).toBe(WORLD_GEN_WIZARD_INPUT.genre);
    expect(reloaded.goals).toBe(WORLD_GEN_WIZARD_INPUT.goals);
  });

  test('disposing mid-run leaves no reactive residue behind', async () => {
    const { vm, provider } = build({ delayMs: { setting: 60, cast: 60, places: 60 } });

    const run = vm.generateWorld();
    await provider.waitForCalls('setting', 1);
    await vm.dispose();
    flushSync();
    await run;
    flushSync();

    expect(vm.draft).toBeUndefined();
    expect(vm.isGenerating).toBe(false);
  });
});
