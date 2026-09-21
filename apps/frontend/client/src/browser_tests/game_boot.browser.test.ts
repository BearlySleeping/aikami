// apps/frontend/client/src/browser_tests/game_boot.browser.test.ts
//
// Real-runes coverage for the migrated game-boot ViewModel. The Bun suite uses
// plain fixtures; this lane runs the ViewModel in Chromium with the real Svelte
// compiler against a reactive boot fixture so advancing the pipeline updates
// the computed getters.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createGameBootViewModel } from '../lib/views/game/boot/game_boot_view_model.svelte';
import { createReactiveGameBootHarness } from '../lib/views/game/boot/testing/game_boot_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('GameBootViewModel — reactive progress (real runes)', () => {
  test('computed getters follow the reactive boot stage', () => {
    const harness = createReactiveGameBootHarness();
    const viewModel = createGameBootViewModel({
      className: 'GameBootViewModel',
      boot: harness.boot,
      router: harness.router,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.isFailed).toBe(false);
    expect(viewModel.isReady).toBe(false);

    harness.setProgress({
      stage: 'failed',
      stageIndex: 2,
      stageCount: 4,
      error: 'Content pack missing',
    });
    flushSync();

    expect(viewModel.isFailed).toBe(true);
    expect(viewModel.bootErrorMessage).toBe('Content pack missing');

    harness.setProgress({ stage: 'ready', stageIndex: 4, stageCount: 4 });
    harness.setBooting(false);
    flushSync();

    expect(viewModel.isReady).toBe(true);
    expect(viewModel.isFailed).toBe(false);
    expect(viewModel.isBooting).toBe(false);
  });
});
