// apps/frontend/client/src/browser_tests/quest.browser.test.ts
//
// Real-runes coverage for the migrated quest-log ViewModel. The Bun suite uses
// plain fixtures; this lane runs the ViewModel in Chromium with the real Svelte
// compiler against a reactive quest fixture.

import type { QuestData } from '@aikami/frontend/engine/sim';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createQuestViewModel } from '../lib/views/quest/quest_view_model.svelte';
import { createReactiveQuestHarness } from '../lib/views/quest/testing/quest_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

const ACTIVE_QUEST: QuestData = {
  id: 'fading_ward',
  title: 'The Fading Ward',
  description: 'Renew the ward protecting Emberwatch.',
  status: 'active',
  objectives: [{ label: 'Ask Elder Thalia', current: 0, max: 1 }],
};

describe('QuestViewModel — reactive quest state (real runes)', () => {
  test('derived getters follow the reactive quest list', () => {
    const harness = createReactiveQuestHarness();
    const viewModel = createQuestViewModel({
      className: 'QuestViewModel',
      questState: harness.questState,
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.questCount).toBe(0);
    expect(viewModel.activeQuests).toEqual([]);

    harness.setQuests([ACTIVE_QUEST]);
    flushSync();

    expect(viewModel.questCount).toBe(1);
    expect(viewModel.activeQuests).toEqual([ACTIVE_QUEST]);

    harness.setQuests([]);
    flushSync();

    expect(viewModel.questCount).toBe(0);
  });
});
