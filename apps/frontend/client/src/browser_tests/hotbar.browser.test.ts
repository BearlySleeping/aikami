// apps/frontend/client/src/browser_tests/hotbar.browser.test.ts
//
// Real-runes coverage for the migrated hotbar ViewModel. The Bun suite uses
// plain fixtures; this lane runs the ViewModel in Chromium with the real Svelte
// compiler against a reactive player-state fixture so the derived `slots`
// recompute when the slot/use state changes.

// biome-ignore-all lint/style/useNamingConvention: ability feature ids are snake_case domain identifiers

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createHotbarViewModel } from '../lib/views/game/hotbar/hotbar_view_model.svelte';
import { createReactiveHotbarHarness } from '../lib/views/game/hotbar/testing/hotbar_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('HotbarViewModel — reactive slots (real runes)', () => {
  test('slots recompute when the player state changes', () => {
    const harness = createReactiveHotbarHarness();
    const viewModel = createHotbarViewModel({
      className: 'HotbarViewModel',
      playerState: harness.playerState,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.slots.every((slot) => !slot.filled)).toBe(true);

    harness.setSlots(['action_surge']);
    flushSync();
    expect(viewModel.slots[0].filled).toBe(true);

    harness.setUses({ action_surge: 0 });
    flushSync();
    expect(viewModel.slots[0].canUse).toBe(false);

    harness.setUses({ action_surge: 2 });
    flushSync();
    expect(viewModel.slots[0].canUse).toBe(true);
    expect(viewModel.slots[0].usesRemaining).toBe(2);
  });

  test('visibility toggles under real runes', () => {
    const harness = createReactiveHotbarHarness();
    const viewModel = createHotbarViewModel({
      className: 'HotbarViewModel',
      playerState: harness.playerState,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.visible).toBe(true);
    viewModel.setVisible(false);
    flushSync();
    expect(viewModel.visible).toBe(false);
  });
});
