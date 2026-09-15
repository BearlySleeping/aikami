// apps/frontend/client/src/browser_tests/gameplay.browser.test.ts
//
// Real-runes coverage for the migrated gameplay settings ViewModel. The Bun
// suite uses plain fixtures; this lane runs the ViewModel in Chromium with the
// real Svelte compiler against a reactive quest-overlay fixture.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createGameplayViewModel } from '../lib/views/settings/gameplay/gameplay_view_model.svelte';
import { createReactiveGameplayHarness } from '../lib/views/settings/gameplay/testing/gameplay_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('GameplayViewModel — reactive quest overlay (real runes)', () => {
  test('questOverlayVisible follows the reactive overlay and toggling it', () => {
    const harness = createReactiveGameplayHarness();
    const viewModel = createGameplayViewModel({
      className: 'GameplayViewModel',
      overlay: harness.overlay,
      motion: harness.motion,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.questOverlayVisible).toBe(true);

    harness.setVisible(false);
    flushSync();
    expect(viewModel.questOverlayVisible).toBe(false);

    viewModel.toggleQuestOverlay();
    flushSync();
    expect(viewModel.questOverlayVisible).toBe(true);
  });
});

describe('GameplayViewModel — reactive motion preference (real runes)', () => {
  test('the settings control writes through to the shared capability', () => {
    const harness = createReactiveGameplayHarness();
    const viewModel = createGameplayViewModel({
      className: 'GameplayViewModel',
      overlay: harness.overlay,
      motion: harness.motion,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.motionPreference).toBe('auto');

    viewModel.setMotionPreference('reduce');
    flushSync();

    // The value the game HUD reads is the same value Settings just wrote —
    // C-527 AC-6 relies on this shared source.
    expect(viewModel.motionPreference).toBe('reduce');
    expect(harness.motionPreference()).toBe('reduce');

    viewModel.resetDefaults();
    flushSync();
    expect(harness.motionPreference()).toBe('auto');
  });
});
