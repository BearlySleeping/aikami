// apps/frontend/client/src/browser_tests/pause_menu.browser.test.ts
//
// Real-runes coverage for the migrated pause-menu ViewModel. The Bun suite uses
// plain fixtures; this lane runs the ViewModel in Chromium with the real Svelte
// compiler against a reactive overlay/dice fixture.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createPauseMenuViewModel } from '../lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte';
import { createReactivePauseMenuHarness } from '../lib/views/game/ui/overlays/pause_menu/testing/pause_menu_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('PauseMenuViewModel — reactive overlay and dice (real runes)', () => {
  test('overlay state and roll history update when the fixture changes', () => {
    const harness = createReactivePauseMenuHarness();
    const viewModel = createPauseMenuViewModel({
      className: 'PauseMenuViewModel',
      overlay: harness.overlay,
      dice: harness.dice,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.isSaving).toBe(false);
    expect(viewModel.saveMessage).toBeUndefined();
    expect(viewModel.rollHistory).toEqual([]);

    harness.setSaving(true);
    harness.setSaveMessage('Saving…');
    harness.setHistory([{ roll: 20, sides: 20, modifier: 0, total: 20, timestamp: new Date() }]);
    flushSync();

    expect(viewModel.isSaving).toBe(true);
    expect(viewModel.saveMessage).toBe('Saving…');
    expect(viewModel.rollHistory).toHaveLength(1);
  });

  test('local quit and roll-history toggles update under real runes', () => {
    const harness = createReactivePauseMenuHarness();
    const viewModel = createPauseMenuViewModel({
      className: 'PauseMenuViewModel',
      overlay: harness.overlay,
      dice: harness.dice,
    });
    disposables.push(() => viewModel.dispose());

    viewModel.requestQuit();
    viewModel.openRollHistory();
    flushSync();

    expect(viewModel.confirmingQuit).toBe(true);
    expect(viewModel.isRollHistoryOpen).toBe(true);

    viewModel.cancelQuit();
    viewModel.closeRollHistory();
    flushSync();

    expect(viewModel.confirmingQuit).toBe(false);
    expect(viewModel.isRollHistoryOpen).toBe(false);
  });
});
