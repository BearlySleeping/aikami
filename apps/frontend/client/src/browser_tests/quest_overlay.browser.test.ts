// apps/frontend/client/src/browser_tests/quest_overlay.browser.test.ts
//
// Real-runes coverage for the migrated quest-overlay ViewModel.
//
// The Bun suite verifies derivation against plain fixtures; this lane runs the
// same ViewModel in Chromium with the real Svelte compiler, against a reactive
// fixture, so a quest-list mutation is observed through the derived getters.

import type { QuestData } from '@aikami/frontend/engine/sim';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { createQuestOverlayViewModel } from '../lib/views/game/ui/hud/quest_overlay_view_model.svelte';
import { createQuestCampaignCapabilities } from '../lib/views/game/ui/hud/testing/quest_overlay_fixtures.ts';
import { createReactiveQuestOverlayHarness } from '../lib/views/game/ui/hud/testing/quest_overlay_reactive_fixtures.svelte';
import QuestOverlayHarness from './fixtures/quest_overlay_harness.svelte';

const disposables: Array<() => Promise<void>> = [];
const mounted: Array<ReturnType<typeof mount>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
  while (mounted.length > 0) {
    const component = mounted.pop();
    if (component) {
      await unmount(component);
    }
  }
  document.body.innerHTML = '';
});

const ACTIVE_QUEST: QuestData = {
  id: 'fading_ward',
  title: 'The Fading Ward',
  description: 'Renew the ward protecting Emberwatch.',
  status: 'active',
  objectives: [
    { label: 'Ask Elder Thalia', current: 1, max: 1 },
    { label: 'Find the Ward Wand', current: 2, max: 4 },
  ],
};

const COUNTER_QUEST: QuestData = {
  id: 'slime_cellar',
  title: 'The Cellar Below',
  description: 'Clear the slimes out of the inn cellar.',
  status: 'active',
  objectives: [{ label: 'Defeat the slimes in the cellar', current: 3, max: 5 }],
};

describe('Quest overlay View — rendered ARIA semantics', () => {
  test('the objective progress bar exposes its objective as an accessible name', async () => {
    const harness = createReactiveQuestOverlayHarness();
    const viewModel = createQuestOverlayViewModel({
      className: 'QuestOverlayVM',
      overlay: harness.overlay,
      questState: harness.questState,
      campaign: createQuestCampaignCapabilities(),
    });
    disposables.push(() => viewModel.dispose());
    harness.setQuests([COUNTER_QUEST]);

    mounted.push(mount(QuestOverlayHarness, { target: document.body, props: { viewModel } }));
    flushSync();

    // The name comes from the ViewModel, not from a hardcoded template string,
    // so it tracks the objective the card is actually rendering.
    const progressBar = page.getByRole('progressbar', {
      name: 'Objective progress: Defeat the slimes in the cellar, 3 of 5',
    });
    await expect.element(progressBar).toBeInTheDocument();
    expect(progressBar.element().getAttribute('aria-valuenow')).toBe('60');
  });

  test('no progress bar is rendered when the objective is untouched', () => {
    const harness = createReactiveQuestOverlayHarness();
    const viewModel = createQuestOverlayViewModel({
      className: 'QuestOverlayVM',
      overlay: harness.overlay,
      questState: harness.questState,
      campaign: createQuestCampaignCapabilities(),
    });
    disposables.push(() => viewModel.dispose());
    harness.setQuests([
      { ...COUNTER_QUEST, objectives: [{ label: 'Defeat the slimes', current: 0, max: 5 }] },
    ]);

    mounted.push(mount(QuestOverlayHarness, { target: document.body, props: { viewModel } }));
    flushSync();

    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });
});

describe('QuestOverlayViewModel — reactive quest state (real runes)', () => {
  test('derived getters update when the quest list changes', () => {
    const harness = createReactiveQuestOverlayHarness();
    const viewModel = createQuestOverlayViewModel({
      className: 'QuestOverlayVM',
      overlay: harness.overlay,
      questState: harness.questState,
      campaign: createQuestCampaignCapabilities(),
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.hasActiveQuest).toBe(false);
    expect(viewModel.questTitle).toBe('No active quest');

    harness.setQuests([ACTIVE_QUEST]);
    flushSync();

    expect(viewModel.hasActiveQuest).toBe(true);
    expect(viewModel.questTitle).toBe('The Fading Ward');
    expect(viewModel.currentObjectiveIndex).toBe(1);
    expect(viewModel.currentObjectivePercent).toBe(50);
  });

  test('visibility and hide update through the reactive overlay', () => {
    const harness = createReactiveQuestOverlayHarness();
    const viewModel = createQuestOverlayViewModel({
      className: 'QuestOverlayVM',
      overlay: harness.overlay,
      questState: harness.questState,
      campaign: createQuestCampaignCapabilities(),
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.visible).toBe(true);

    harness.setVisible(false);
    flushSync();
    expect(viewModel.visible).toBe(false);

    harness.setVisible(true);
    flushSync();
    viewModel.hide();
    flushSync();
    expect(viewModel.visible).toBe(false);
  });
});
