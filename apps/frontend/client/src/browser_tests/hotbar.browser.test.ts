// apps/frontend/client/src/browser_tests/hotbar.browser.test.ts
//
// Real-runes coverage for the migrated hotbar ViewModel. The Bun suite uses
// plain fixtures; this lane runs the ViewModel in Chromium with the real Svelte
// compiler against a reactive player-state fixture so the derived `slots`
// recompute when the slot/use state changes.

// biome-ignore-all lint/style/useNamingConvention: ability feature ids are snake_case domain identifiers

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import HotbarView from '../lib/views/game/hotbar/hotbar_view.svelte';
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

  test('assigned-slot projection reacts under real runes (no second visibility flag)', () => {
    const harness = createReactiveHotbarHarness();
    const viewModel = createHotbarViewModel({
      className: 'HotbarViewModel',
      playerState: harness.playerState,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.hasAssignedSlots).toBe(false);

    harness.setSlots(['action_surge']);
    flushSync();
    expect(viewModel.hasAssignedSlots).toBe(true);
    expect(viewModel.assignedSlots).toHaveLength(1);

    harness.setSlots([]);
    flushSync();
    expect(viewModel.hasAssignedSlots).toBe(false);
  });
});

describe('HotbarView — rendered behavior', () => {
  test('maps slot availability to the rendered class', async () => {
    const harness = createReactiveHotbarHarness();
    harness.setSlots(['action_surge']);
    const viewModel = createHotbarViewModel({
      className: 'HotbarViewModel',
      playerState: harness.playerState,
    });
    const target = document.createElement('div');
    const component = mount(HotbarView, { target, props: { viewModel } });

    try {
      flushSync();
      const slot = target.querySelector('[data-testid="hotbar-slot-0"]');
      expect(slot?.classList).toContain('hud-hotbar__slot--available');

      harness.setUses({ action_surge: 0 });
      flushSync();
      expect(slot?.classList).toContain('hud-hotbar__slot--depleted');
      expect(slot?.classList).not.toContain('hud-hotbar__slot--available');
    } finally {
      await unmount(component);
    }
  });

  test('uses hasAssignedSlots to control the rendered hotbar region', async () => {
    const harness = createReactiveHotbarHarness();
    const viewModel = createHotbarViewModel({
      className: 'HotbarViewModel',
      playerState: harness.playerState,
    });
    const target = document.createElement('div');
    const component = mount(HotbarView, { target, props: { viewModel } });

    try {
      flushSync();
      expect(target.querySelector('[data-testid="hotbar"]')).toBeNull();

      harness.setSlots(['action_surge']);
      flushSync();
      expect(target.querySelector('[data-testid="hotbar"]')).not.toBeNull();

      harness.setSlots([]);
      flushSync();
      expect(target.querySelector('[data-testid="hotbar"]')).toBeNull();
    } finally {
      await unmount(component);
    }
  });
});
