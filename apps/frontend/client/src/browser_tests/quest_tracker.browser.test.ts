// apps/frontend/client/src/browser_tests/quest_tracker.browser.test.ts
//
// Real-runes coverage for the migrated quest-tracker ViewModel. The Bun suite
// uses plain fixtures; this lane runs the ViewModel in Chromium with the real
// Svelte compiler against a reactive quest fixture.

import type { QuestData } from '@aikami/frontend/engine/sim';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createQuestTrackerViewModel } from '../lib/views/game/ui/quest_tracker_view_model.svelte';
import { createReactiveQuestTrackerHarness } from '../lib/views/game/ui/testing/quest_tracker_reactive_fixtures.svelte';

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
    { label: 'Find the Ward Wand', current: 0, max: 1 },
  ],
};

describe('QuestTrackerViewModel — reactive quests (real runes)', () => {
  test('derived getters follow the reactive quest list', () => {
    const harness = createReactiveQuestTrackerHarness();
    const viewModel = createQuestTrackerViewModel({
      className: 'QuestTrackerViewModel',
      questState: harness.questState,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.hasQuests).toBe(false);

    harness.setQuests([ACTIVE_QUEST]);
    flushSync();

    expect(viewModel.hasQuests).toBe(true);
    expect(viewModel.currentObjectiveText).toBe('The Fading Ward: Find the Ward Wand');

    harness.setQuests([]);
    flushSync();

    expect(viewModel.hasQuests).toBe(false);
    expect(viewModel.currentObjectiveText).toBe('');
  });
});
