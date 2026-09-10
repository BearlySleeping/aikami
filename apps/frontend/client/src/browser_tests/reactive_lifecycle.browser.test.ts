// apps/frontend/client/src/browser_tests/reactive_lifecycle.browser.test.ts
//
// Real-Svelte pilot for the reactive lifecycle fixture (C-477).
//
// Runs in Chromium through Vitest Browser Mode: `$state`/`$derived`/`$effect`
// are compiled by the Svelte plugin and executed by the real runtime, so the
// assertions below observe reactivity the Bun identity-rune preload cannot.
// No test_preload, no `$services` barrel mock, no dev route.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import {
  getReactiveCounterViewModel,
  type ReactiveCounterViewModelInterface,
} from '../lib/views/reactive_lifecycle/reactive_counter_view_model.svelte';

const created: ReactiveCounterViewModelInterface[] = [];

const createViewModel = (): ReactiveCounterViewModelInterface => {
  const viewModel = getReactiveCounterViewModel({ initialCount: 0 });
  created.push(viewModel);
  return viewModel;
};

afterEach(async () => {
  await Promise.all(created.splice(0).map((viewModel) => viewModel.dispose()));
});

describe('ReactiveCounterViewModel — real Svelte runtime', () => {
  test('$state and $derived recompute in the browser', () => {
    const viewModel = createViewModel();

    expect(viewModel.count).toBe(0);
    expect(viewModel.doubled).toBe(0);
    expect(viewModel.label).toBe('zero');

    viewModel.increment();
    flushSync();

    expect(viewModel.count).toBe(1);
    expect(viewModel.doubled).toBe(2);
    expect(viewModel.label).toBe('positive (1)');

    viewModel.decrement();
    viewModel.decrement();
    flushSync();

    expect(viewModel.count).toBe(-1);
    expect(viewModel.doubled).toBe(-2);
    expect(viewModel.label).toBe('negative (-1)');
  });

  test('registerEffectRoot cleanup runs on dispose', async () => {
    const viewModel = createViewModel();

    await viewModel.initialize();
    flushSync();
    expect(viewModel.effectCleanupFired).toBe(false);

    await viewModel.dispose();
    flushSync();

    expect(viewModel.effectCleanupFired).toBe(true);
  });
});
