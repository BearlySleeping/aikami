// apps/frontend/client/src/browser_tests/menu.browser.test.ts
//
// Real-runes coverage for the migrated menu ViewModel. The Bun suite uses plain
// fixtures; this lane runs the ViewModel in Chromium with the real Svelte
// compiler against a reactive save-slot fixture.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createMenuViewModel } from '../lib/views/game/menu/menu_view_model.svelte';
import {
  createMenuCampaign,
  createMenuRouter,
} from '../lib/views/game/menu/testing/menu_fixtures.ts';
import { createReactiveMenuHarness } from '../lib/views/game/menu/testing/menu_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('MenuViewModel — reactive saves (real runes)', () => {
  test('canContinue and latestSave follow the reactive save list', () => {
    const harness = createReactiveMenuHarness();
    const viewModel = createMenuViewModel({
      className: 'MenuViewModel',
      onStart: () => {},
      onOptions: () => {},
      onCredits: () => {},
      gameSave: harness.gameSave,
      campaign: createMenuCampaign(),
      router: createMenuRouter(),
      isTauri: () => false,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.canContinue).toBe(false);
    expect(viewModel.latestSave).toBeUndefined();

    harness.setSaves([
      { id: 'older', timestamp: 100, mapName: 'Village' },
      { id: 'newest', timestamp: 300, mapName: 'Cave' },
    ]);
    flushSync();

    expect(viewModel.canContinue).toBe(true);
    expect(viewModel.latestSave?.id).toBe('newest');
  });
});
