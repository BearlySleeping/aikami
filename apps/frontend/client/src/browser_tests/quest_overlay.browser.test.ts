// apps/frontend/client/src/browser_tests/quest_overlay.browser.test.ts
//
// Real-runes coverage for the migrated quest-overlay ViewModel.
//
// The Bun suite verifies derivation against plain fixtures; this lane runs the
// same ViewModel in Chromium with the real Svelte compiler, against a reactive
// fixture, so a quest-list mutation is observed through the derived getters.

import type { QuestData } from '@aikami/frontend/engine/sim';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createQuestOverlayViewModel } from '../lib/views/game/ui/hud/quest_overlay_view_model.svelte';
import { createQuestCampaignCapabilities } from '../lib/views/game/ui/hud/testing/quest_overlay_fixtures.ts';
import { createReactiveQuestOverlayHarness } from '../lib/views/game/ui/hud/testing/quest_overlay_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
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
