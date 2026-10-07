// apps/frontend/client/src/browser_tests/worldgen/world_gen_wizard_view.browser.test.ts
//
// Real-compiler coverage for the wizard's list rendering.
//
// The three lists the wizard renders — stage failures, arc objectives and
// validation diagnostics — are all keyed `each` blocks, and Svelte REQUIRES a
// keyed list's keys to be unique: a duplicate key throws during reconciliation
// rather than degrading. Each of those three keys was built from the content
// alone:
//
//   * `stage + message` — the failure list is per ROUND, so a stage that fails
//     the same way twice contributes two identical entries.
//   * the objective text — objectives are free text and may legitimately
//     repeat inside one arc.
//   * `path + code` — that names a KIND of fault, not an entry: two separately
//     duplicated cast names both report at `cast`.
//
// Bun cannot see any of this (the rune polyfills are identity functions, and
// there is no compiler), so this lane mounts the real view and asserts that
// every entry renders.
//
// Where a duplicate needs a state the current pipeline cannot reach on its own
// (two entries for the SAME failed stage in one run), the list is fed through a
// capability object that delegates to the real draft service and replaces ONE
// property. The delegation is explicit because a spread would evaluate the
// getters once and freeze the draft, the run and the persistence state, and
// because `Object.create` is not an option here: the compiled lane turns
// `$state` into private class fields, and a derived object is not branded for
// them.

import type { WorldGenDraftDiagnostic } from '@aikami/schemas';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createWorldGenDraftService,
  type WorldGenDraftServiceInterface,
} from '../../lib/services/worldgen/world_gen_draft_service.svelte.ts';
import {
  coherentPayloads,
  createControllableProvider,
  createMemoryStore,
  WORLD_GEN_WIZARD_INPUT,
} from '../../lib/views/worldgen/testing/world_gen_fixtures.ts';
import WorldGenWizardView from '../../lib/views/worldgen/world_gen_wizard_view.svelte';
import {
  createWorldGenWizardViewModel,
  type WorldGenWizardViewModelInterface,
} from '../../lib/views/worldgen/world_gen_wizard_view_model.svelte.ts';

const mounted: Array<ReturnType<typeof mount>> = [];

afterEach(() => {
  while (mounted.length > 0) {
    const component = mounted.pop();
    if (component) {
      void unmount(component);
    }
  }
  flushSync();
  document.body.innerHTML = '';
});

type ProviderOptions = Parameters<typeof createControllableProvider>[0];

/** The two properties a test may replace; every other member reads through. */
type Overrides = {
  run?: () => WorldGenDraftServiceInterface['run'];
  diagnostics?: () => WorldGenDraftServiceInterface['diagnostics'];
};

/** Every member of the capability, read live off `real`. */
const delegating = (
  real: WorldGenDraftServiceInterface,
  overrides: Overrides = {},
): WorldGenDraftServiceInterface => ({
  get _className() {
    return real._className;
  },
  get run() {
    return overrides.run === undefined ? real.run : overrides.run();
  },
  get draft() {
    return real.draft;
  },
  get persistence() {
    return real.persistence;
  },
  get diagnostics() {
    return overrides.diagnostics === undefined ? real.diagnostics : overrides.diagnostics();
  },
  generate: (options) => real.generate(options),
  cancel: (reason) => real.cancel(reason),
  accept: () => real.accept(),
  reload: () => real.reload(),
  initialize: () => real.initialize(),
  dispose: () => real.dispose(),
});

const draftService = (providerOptions: ProviderOptions = {}): WorldGenDraftServiceInterface =>
  createWorldGenDraftService({
    className: 'WorldGenDraftServiceBrowserTest',
    text: createControllableProvider({ payloads: coherentPayloads(), ...providerOptions })
      .capability,
    resolveStore: async () => createMemoryStore(),
    maxAttemptsPerStage: 1,
  });

/**
 * Builds a ViewModel over `wrap(service)`, runs one generation, then mounts.
 *
 * The wrap is applied BEFORE the run, so an overridden property is already in
 * place when the view first reads it. Swapping a plain (non-reactive) value in
 * afterwards would re-render nothing: these files compile as plain TS, so
 * `$state` is unavailable here.
 */
const render = async (
  service: WorldGenDraftServiceInterface,
  expectedStep: string,
  wrap: (service: WorldGenDraftServiceInterface) => WorldGenDraftServiceInterface = (it) => it,
): Promise<WorldGenWizardViewModelInterface> => {
  const vm = createWorldGenWizardViewModel({
    className: 'WorldGenWizardViewBrowserTest',
    initialInputs: WORLD_GEN_WIZARD_INPUT,
    router: { goToRoute: async () => {} },
    drafts: wrap(service),
  });
  await vm.generateWorld();

  const component = mount(WorldGenWizardView, {
    target: document.body,
    props: { viewModel: vm },
  });
  mounted.push(component);
  await flushSync();

  expect(vm.currentStep).toBe(expectedStep);
  return vm;
};

/** Reads one line per list item, so "rendered twice" is distinguishable. */
const linesOf = (testId: string): string[] =>
  [...document.querySelectorAll(`[data-testid="${testId}"] li`)].map(
    (item) => item.textContent?.trim() ?? '',
  );

describe('WorldGenWizardView — duplicate keyed list entries (G01)', () => {
  test('the same objective twice in one arc both render', async () => {
    // The one duplicate production code can produce alone: the draft schema
    // puts no uniqueness rule on objectives, so a provider may repeat one and
    // the wizard would throw while reconciling the list.
    const payloads = coherentPayloads();
    payloads.arcs = {
      arcs: [
        {
          chapter: 'Relighting',
          description: 'Restore the town wardstone.',
          objectives: ['Relight the wardstone', 'Relight the wardstone'],
          questGiverNames: ['Maren'],
        },
      ],
    };

    const service = createWorldGenDraftService({
      className: 'WorldGenDraftServiceBrowserTest',
      text: createControllableProvider({ payloads }).capability,
      resolveStore: async () => createMemoryStore(),
      maxAttemptsPerStage: 1,
    });

    const vm = await render(service, 'preview');

    const objectives = [...document.querySelectorAll('ul.list-disc li')].map(
      (item) => item.textContent?.trim() ?? '',
    );
    expect(objectives).toEqual(['Relight the wardstone', 'Relight the wardstone']);
    await vm.dispose();
  });

  test('a stage reported as failed twice with the same message renders twice', async () => {
    // The failure readout lives on the generating step, so the run has to END
    // there: a stage that never succeeds leaves the wizard on that step.
    const service = draftService({ failStages: { places: 'provider unavailable' } });

    const vm = await render(service, 'generating', (inner) =>
      delegating(inner, {
        run: () => {
          const run = inner.run;
          if (run === undefined) {
            return undefined;
          }
          // The failure list is per round, so a retried stage that fails the
          // same way contributes the same (stage, message) pair twice — and the
          // old key was exactly that pair.
          return {
            ...run,
            status: 'failed',
            error: 'provider unavailable',
            // `stage` is the stage ID; the view renders its label, which is
            // why the expectation below reads "locations".
            failures: [
              { stage: 'places', message: 'provider unavailable' },
              { stage: 'places', message: 'provider unavailable' },
            ],
          };
        },
      }),
    );

    expect(linesOf('worldgen-stage-failures')).toEqual([
      'locations: provider unavailable',
      'locations: provider unavailable',
    ]);
    await vm.dispose();
  });

  test('two diagnostics sharing a path and code both render', async () => {
    // Two separately duplicated cast names both report at `cast`, so `path` and
    // `code` are identical while the messages differ.
    const diagnostics: WorldGenDraftDiagnostic[] = [
      {
        path: 'cast',
        code: 'duplicate_name',
        message: '2 cast members share the name "maren".',
      },
      { path: 'cast', code: 'duplicate_name', message: '2 cast members share the name "thorn".' },
    ];
    const service = draftService();

    const vm = await render(service, 'preview', (inner) =>
      delegating(inner, { diagnostics: () => diagnostics }),
    );

    const rendered = linesOf('worldgen-diagnostics');
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toContain('maren');
    expect(rendered[1]).toContain('thorn');
    await vm.dispose();
  });
});
