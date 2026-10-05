// apps/frontend/client/src/lib/views/worldgen/world_gen_draft_regression.test.ts
//
// G01 defect reproductions — these five defects were real in the C-405 wizard
// and are the reason this milestone exists. Each test below FAILED before G01
// and now pins the fix, because each is a defect that an innocent-looking
// "simplification" would reintroduce:
//
//   1. duplicate generate fanned out a second provider pipeline,
//   2. one failing stage re-ran every stage that had already succeeded,
//   3. accepting a "preview" mutated the player's ACTIVE campaign
//      (subscribeToWorld / addLocation / four seed* calls), and a later
//      revision re-introduced a narrower version of it by publishing the
//      accepted draft into the live world-state GM prompt context,
//   4. a late provider completion from a superseded run overwrote newer state,
//   5. no run identity reached the provider, so nothing was cancellable or
//      correlatable.
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
import { createWorldGenWizardViewModel } from './world_gen_wizard_view_model.svelte.ts';

/** Strips whole-line and block comments so prose cannot trip a code check. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const build = (
  providerOptions: Parameters<typeof createControllableProvider>[0] = {},
): {
  vm: ReturnType<typeof createWorldGenWizardViewModel>;
  provider: ReturnType<typeof createControllableProvider>;
  // The injected service, so a test can read the LIVE RUN identity. The wizard
  // exposes draft state, and `vm.draft` is undefined until a run finishes —
  // asking it for the run id mid-run captured `undefined` and made every
  // "not the abandoned run" assertion vacuous.
  service: ReturnType<typeof createWorldGenDraftService>;
} => {
  const provider = createControllableProvider({ payloads: coherentPayloads(), ...providerOptions });
  const service = createWorldGenDraftService({
    className: 'WorldGenDraftRegressionTest',
    text: provider.capability,
    resolveStore: async () => createMemoryStore(),
    maxAttemptsPerStage: 3,
  });
  const vm = createWorldGenWizardViewModel({
    className: 'WorldGenDraftRegressionTest',
    initialInputs: WORLD_GEN_WIZARD_INPUT,
    router: { goToRoute: async () => {} },
    drafts: service,
  });
  return { vm, provider, service };
};

describe('G01 regression 1 — duplicate generate', () => {
  test('a second Generate while a run is in flight does not open a second pipeline', async () => {
    const { vm, provider } = build({ delayMs: { setting: 60, cast: 60, places: 60 } });

    const first = vm.generateWorld();
    // The player double-clicks Generate.
    const second = vm.generateWorld();
    await Promise.all([first, second]);

    // One call per stage. The pre-G01 code ran the whole pipeline twice.
    expect(provider.countStage('setting')).toBe(1);
    expect(provider.countStage('cast')).toBe(1);
    expect(provider.countStage('places')).toBe(1);
    expect(provider.countStage('hudWidgets')).toBe(1);
    expect(provider.countStage('arcs')).toBe(1);
  });
});

describe('G01 regression 2 — checkpoint retention', () => {
  test('a failing stage does not re-run the stages that already succeeded', async () => {
    // The pre-G01 retry recursed into the whole pipeline, re-issuing `setting`,
    // `npcs`, `locations` and `hudWidgets` on every attempt.
    const { vm, provider } = build({ failStages: { places: 'provider unavailable' } });

    await vm.generateWorld();

    expect(provider.countStage('setting')).toBe(1);
    expect(provider.countStage('cast')).toBe(1);
    expect(provider.countStage('hudWidgets')).toBe(1);
    // Only the failing stage is retried, bounded by its attempt budget.
    expect(provider.countStage('places')).toBe(3);
  });
});

describe('G01 regression 3 — no active-campaign mutation', () => {
  test('accepting a draft writes the row and touches nothing else', async () => {
    const { vm, provider } = build();

    await vm.generateWorld();
    await vm.acceptWorld();

    // The pre-G01 wizard called subscribeToWorld(campaignId ?? randomUUID()),
    // addLocation and seedNpcs/seedLocations/seedPartyArcs/seedHudWidgets —
    // creating entities in whatever campaign the player happened to have open.
    // A later revision narrowed that to a single `setWorldGenOutput` call,
    // which still published the draft into the LIVE combat GM prompt context.
    // Acceptance is now a status change on a private row and nothing more.
    expect(provider.calls.length).toBeGreaterThan(0);
    expect(vm.draft?.status).toBe('accepted_preview');
    expect(vm.draft?.playable).toBe(false);
    // No stage is re-requested by accepting: acceptance is a status change,
    // never a second generation.
    expect(provider.countStage('setting')).toBe(1);
  });

  test('the world-gen feature imports no campaign or world-state mutator at all', async () => {
    const files = [
      new URL('./world_gen_wizard_view_model.svelte.ts', import.meta.url),
      new URL('./world_gen_wizard_composition.ts', import.meta.url),
      new URL('../../services/worldgen/world_gen_draft_service.svelte.ts', import.meta.url),
      new URL('../../services/worldgen/world_gen_draft_builder.ts', import.meta.url),
      new URL('../../services/worldgen/types/world_gen_draft_service.types.ts', import.meta.url),
      new URL('../../services/worldgen/world_gen_seeding_service.svelte.ts', import.meta.url),
    ];

    for (const file of files) {
      const source = stripComments(await Bun.file(file).text());
      for (const forbidden of [
        'subscribeToWorld',
        'addLocation',
        'addNpc',
        'setVariable',
        'recordEvent',
        'seedNpcs',
        'seedLocations',
        'seedPartyArcs',
        'seedHudWidgets',
        // The GM-prompt publishing path. This is the specific coupling that
        // made "private draft" a lie: `setWorldGenOutput` writes the node the
        // combat view model reads on its next turn.
        'setWorldGenOutput',
        'worldStateService',
        'PreviewCapabilities',
        'toPreviewWorldGenOutput',
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});

describe('G01 regression 4 — late completion cannot revive a superseded run', () => {
  test('dispose during generation prevents the in-flight result from being applied', async () => {
    const { vm } = build({ delayMs: { setting: 80, cast: 80, places: 80, arcs: 80 } });

    const run = vm.generateWorld();
    await vm.dispose();
    await run;

    expect(vm.draft).toBeUndefined();
  });

  test('restart during generation prevents the in-flight result from being applied', async () => {
    const { vm } = build({ delayMs: { setting: 80, cast: 80, places: 80, arcs: 80 } });

    const run = vm.generateWorld();
    vm.restart();
    await run;

    expect(vm.draft).toBeUndefined();
    expect(vm.currentStep).toBe('genre_tone');
  });

  test('a newer run is not overwritten by an older run finishing late', async () => {
    const { vm, provider, service } = build({ delayMs: { setting: 30 } });

    const first = vm.generateWorld();
    await provider.waitForCalls('setting', 1);
    // Read the abandoned run's identity from the live run, once it DEFINITELY
    // exists. Capturing it before the provider was ever called read `undefined`.
    const abandonedRunId = service.run?.runId;
    expect(abandonedRunId).toBeTruthy();

    // The player gives up on the slow run and starts over.
    vm.cancelGeneration();
    await first;

    await vm.generateWorld();

    // The wizard exposes state, not a return value: the newer run owns the
    // draft, and the abandoned run left nothing behind.
    expect(vm.draft?.status).toBe('complete');
    expect(service.run?.runId).not.toBe(abandonedRunId);
    expect(vm.draft?.runId).not.toBe(abandonedRunId);
    expect(vm.draft?.runId).toBe(service.run?.runId);
  });
});

describe('G01 regression 5 — run identity reaches the provider', () => {
  test('every stage call carries a signal, an absolute deadline and a request id', async () => {
    const { vm, provider } = build();

    await vm.generateWorld();

    expect(provider.calls.length).toBeGreaterThan(0);
    for (const call of provider.calls) {
      expect(call.hadSignal).toBe(true);
      expect(call.deadlineAt).toBeGreaterThan(Date.now());
      expect(call.requestId).toBeTruthy();
      expect(call.task).toBe('agent-world');
    }
  });

  test('an aborted signal actually stops the provider call', async () => {
    const { vm, provider } = build({ delayMs: { setting: 500, cast: 500, places: 500 } });

    const run = vm.generateWorld();
    await provider.waitForCalls('setting', 1);
    vm.cancelGeneration();
    await run;

    // `arcs` is only reachable through `cast`; a run that kept going after the
    // abort would have reached it.
    expect(provider.countStage('arcs')).toBe(0);
  });
});
