// apps/frontend/client/src/lib/views/dev/world_gen_sandbox_delay.test.ts
//
// G01 — the dev sandbox's mock-provider delay.
//
// These are the decisions a browser test depends on for cancellation to be
// OBSERVABLE at all. A control that silently does nothing is worse than a
// missing one: the test still runs, and races the happy path instead of the
// cancel window it thought it had opened.
//
// Two defects are pinned here:
//
//   1. `wgDelayStage` read the SAME `wgDelay` parameter as the global scope, so
//      naming a stage changed nothing — every stage stayed slow. The stage knob
//      now narrows the delay to that one stage.
//   2. "Clear Delay" cleared the ViewModel's own map while the delay actually
//      being applied came from the URL, so on a `?wgDelay=` route the button
//      was a no-op.
//
// The sandbox ViewModel is built directly (no `$services`), so the flag the
// composition reads is the real one.

import { beforeAll, describe, expect, test } from 'bun:test';
import { createWorldGenDraftService } from '../../services/worldgen/world_gen_draft_service.svelte.ts';
import {
  coherentPayloads,
  createControllableProvider,
  createMemoryStore,
  WORLD_GEN_WIZARD_INPUT,
} from '../worldgen/testing/world_gen_fixtures.ts';
import {
  clampSandboxDelay,
  readSandboxDelayQuery,
  resolveSandboxDelay,
} from './world_gen_sandbox_delay.ts';
import {
  createWorldGenSandboxViewModel,
  type WorldGenSandboxViewModelInterface,
} from './world_gen_sandbox_view_model.svelte.ts';

const searchOf = (query: string): { get(name: string): string | null } => ({
  get: (name) => new URLSearchParams(query).get(name),
});

beforeAll(() => {
  // The Bun lane polyfills `window` for AudioContext/KeyboardEvent but not for
  // `location`, and the sandbox ViewModel asks whether it is inside a
  // screenshot capture harness in its constructor. Supplying an empty search
  // here keeps that an honest "not a screenshot run" rather than a crash.
  const target = window as unknown as { location?: { search: string } };
  if (target.location === undefined) {
    target.location = { search: '' };
  }
});

/** The sandbox VM over a real draft service, wired without the `$services` barrel. */
const buildSandbox = (): WorldGenSandboxViewModelInterface =>
  createWorldGenSandboxViewModel({
    className: 'WorldGenSandboxViewModelTest',
    initialInputs: WORLD_GEN_WIZARD_INPUT,
    router: { goToRoute: async () => {} },
    drafts: createWorldGenDraftService({
      className: 'WorldGenSandboxDraftServiceTest',
      text: createControllableProvider({ payloads: coherentPayloads() }).capability,
      resolveStore: async () => createMemoryStore(),
    }),
  });

/** The delay the composition would apply to `stage`, resolved end to end. */
const appliedDelay = (
  vm: WorldGenSandboxViewModelInterface,
  query: string,
  stage: string,
): number =>
  resolveSandboxDelay(
    stage,
    readSandboxDelayQuery(searchOf(query)),
    vm.stageDelaysCleared,
    vm.sandboxDelayFor(stage),
  );

describe('sandbox delay — query parsing (G01)', () => {
  test('a delay is read and clamped to a usable range', () => {
    expect(clampSandboxDelay('800')).toBe(800);
    expect(clampSandboxDelay('999999')).toBe(10_000);
  });

  test('an absent, malformed or non-positive delay is zero, never a stall', () => {
    for (const raw of [null, undefined, '', 'soon', '-5', '0']) {
      expect(clampSandboxDelay(raw)).toBe(0);
    }
  });

  test('a blank or missing stage selector means "every stage"', () => {
    expect(readSandboxDelayQuery(searchOf('')).focusedStage).toBeNull();
    expect(readSandboxDelayQuery(searchOf('wgDelayStage=')).focusedStage).toBeNull();
    expect(readSandboxDelayQuery(searchOf('wgDelayStage=%20%20')).focusedStage).toBeNull();
    expect(readSandboxDelayQuery(searchOf('wgDelayStage=arcs')).focusedStage).toBe('arcs');
  });
});

describe('sandbox delay — scope (G01)', () => {
  const Fallback = 120;

  test('with no stage named, the delay applies to every stage', () => {
    const query = readSandboxDelayQuery(searchOf('wgDelay=800'));

    for (const stage of ['setting', 'cast', 'places', 'hudWidgets', 'arcs']) {
      expect(resolveSandboxDelay(stage, query, false, Fallback)).toBe(800);
    }
  });

  test('naming a stage delays ONLY that stage — the previous behaviour applied it to all', () => {
    const query = readSandboxDelayQuery(searchOf('wgDelay=3000&wgDelayStage=arcs'));

    expect(resolveSandboxDelay('arcs', query, false, Fallback)).toBe(3000);
    for (const stage of ['setting', 'cast', 'places', 'hudWidgets']) {
      expect(resolveSandboxDelay(stage, query, false, Fallback)).toBe(Fallback);
    }
  });

  test('with no query at all, the sandbox falls back to its own per-stage timing', () => {
    const query = readSandboxDelayQuery(searchOf(''));

    expect(resolveSandboxDelay('setting', query, false, Fallback)).toBe(Fallback);
  });

  test('a name that matches no stage leaves every stage on the fallback', () => {
    const query = readSandboxDelayQuery(searchOf('wgDelay=3000&wgDelayStage=nonsense'));

    for (const stage of ['setting', 'cast', 'places', 'hudWidgets', 'arcs']) {
      expect(resolveSandboxDelay(stage, query, false, Fallback)).toBe(Fallback);
    }
  });
});

describe('sandbox delay — Clear Delay really clears (G01)', () => {
  test('clearing the delay drops a query-driven delay, not just the own map', async () => {
    const vm = buildSandbox();

    // A per-stage delay the ViewModel owns, plus a query delay that would
    // otherwise keep overriding it.
    vm.setStageDelay('arcs', 500);
    const query = 'wgDelay=3000';

    expect(appliedDelay(vm, query, 'arcs')).toBe(3000);

    vm.clearStageDelay();

    expect(appliedDelay(vm, query, 'arcs')).toBe(0);
    expect(appliedDelay(vm, query, 'setting')).toBe(0);
    await vm.dispose();
  });

  test('setting a delay again re-arms the query delay', async () => {
    const vm = buildSandbox();

    vm.clearStageDelay();
    vm.setStageDelay('arcs', 500);

    expect(appliedDelay(vm, 'wgDelay=3000', 'arcs')).toBe(3000);
    // With no query in play, the ViewModel's own map answers again.
    expect(appliedDelay(vm, '', 'arcs')).toBe(500);
    expect(appliedDelay(vm, '', 'cast')).toBe(120);
    await vm.dispose();
  });

  test('an uncleared sandbox asks for a per-stage delay, and an unknown stage gets the default', async () => {
    const vm = buildSandbox();

    vm.setStageDelay('arcs', 500);

    expect(vm.sandboxDelayFor('arcs')).toBe(500);
    expect(vm.sandboxDelayFor('cast')).toBe(120);
    await vm.dispose();
  });
});
