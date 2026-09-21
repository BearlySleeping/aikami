// apps/frontend/client/src/lib/views/game/ui/quest_tracker_view_model.test.ts
//
// Unit tests for QuestTrackerViewModel — active-quest derivation and the
// current objective line. Exercises the ViewModel through feature-owned
// fixtures — no global `$services` barrel mock.
//
// Contract: C-329 Integrate the Demo Quest from Offer Through Reward

import { describe, expect, test } from 'bun:test';
import type { QuestData } from '@aikami/frontend/engine/sim';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createQuestTrackerViewModel } from './quest_tracker_view_model.svelte';
import { createQuestTrackerQuestState } from './testing/quest_tracker_fixtures.ts';

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

const createViewModel = (quests: QuestData[] = []) =>
  createQuestTrackerViewModel({
    className: 'QuestTrackerViewModelTest',
    questState: createQuestTrackerQuestState(quests),
  });

describe('QuestTrackerViewModel', () => {
  test('reports no quests when none are active', () => {
    const viewModel = createViewModel();

    expect(viewModel.activeQuests).toEqual([]);
    expect(viewModel.hasQuests).toBe(false);
    expect(viewModel.currentObjectiveText).toBe('');
  });

  test('ignores completed quests', () => {
    const viewModel = createViewModel([{ ...ACTIVE_QUEST, status: 'completed' }]);

    expect(viewModel.hasQuests).toBe(false);
  });

  test('shows the first incomplete objective of the active quest', () => {
    const viewModel = createViewModel([ACTIVE_QUEST]);

    expect(viewModel.hasQuests).toBe(true);
    expect(viewModel.currentObjectiveText).toBe('The Fading Ward: Find the Ward Wand');
  });

  test('falls back to an empty line when every objective is complete', () => {
    const completedObjectives: QuestData = {
      ...ACTIVE_QUEST,
      objectives: [{ label: 'Done', current: 1, max: 1 }],
    };
    const viewModel = createViewModel([completedObjectives]);

    expect(viewModel.currentObjectiveText).toBe('');
  });

  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
