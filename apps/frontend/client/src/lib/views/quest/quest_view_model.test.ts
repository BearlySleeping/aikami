// apps/frontend/client/src/lib/views/quest/quest_view_model.test.ts
//
// Unit tests for QuestViewModel — status filtering, journal passthrough, the
// quest count, and tab switching. Exercises the ViewModel through feature-owned
// fixtures — no global `$services` barrel mock.
//
// Contract: C-143 Quest Log Sync
// Contract: C-339 Quest Graph, Journal, Objectives

import { describe, expect, test } from 'bun:test';
import type { QuestData, QuestJournalEntry } from '@aikami/frontend/engine/sim';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createQuestViewModel } from './quest_view_model.svelte';
import { createQuestState } from './testing/quest_fixtures.ts';

const ACTIVE_QUEST: QuestData = {
  id: 'fading_ward',
  title: 'The Fading Ward',
  description: 'Renew the ward protecting Emberwatch.',
  status: 'active',
  objectives: [{ label: 'Ask Elder Thalia', current: 0, max: 1 }],
};

const COMPLETED_QUEST: QuestData = {
  ...ACTIVE_QUEST,
  id: 'lost_pendant',
  title: 'The Lost Pendant',
  status: 'completed',
};

const FAILED_QUEST: QuestData = {
  ...ACTIVE_QUEST,
  id: 'bandit_camp',
  title: 'Bandit Camp',
  status: 'failed',
};

const JOURNAL_ENTRY: QuestJournalEntry = {
  questId: 'lost_pendant',
  title: 'The Lost Pendant',
  status: 'completed',
  timestamp: 1_700_000_000_000,
  narration: 'The pendant is returned to its rightful owner.',
  objectiveResults: [{ label: 'Find the pendant', status: 'completed' }],
};

const createViewModel = (quests: QuestData[] = [], journalEntries: QuestJournalEntry[] = []) =>
  createQuestViewModel({
    className: 'QuestViewModelTest',
    questState: createQuestState({ quests, journalEntries }),
  });

describe('QuestViewModel — status filtering', () => {
  test('partitions quests by status', () => {
    const viewModel = createViewModel([ACTIVE_QUEST, COMPLETED_QUEST, FAILED_QUEST]);

    expect(viewModel.activeQuests).toEqual([ACTIVE_QUEST]);
    expect(viewModel.completedQuests).toEqual([COMPLETED_QUEST]);
    expect(viewModel.failedQuests).toEqual([FAILED_QUEST]);
  });

  test('reports an empty log when there are no quests', () => {
    const viewModel = createViewModel();

    expect(viewModel.questCount).toBe(0);
    expect(viewModel.activeQuests).toEqual([]);
    expect(viewModel.completedQuests).toEqual([]);
    expect(viewModel.failedQuests).toEqual([]);
  });

  test('counts every quest regardless of status', () => {
    const viewModel = createViewModel([ACTIVE_QUEST, COMPLETED_QUEST, FAILED_QUEST]);

    expect(viewModel.questCount).toBe(3);
  });
});

describe('QuestViewModel — journal', () => {
  test('exposes the injected journal entries', () => {
    const viewModel = createViewModel([], [JOURNAL_ENTRY]);

    expect(viewModel.journalEntries).toEqual([JOURNAL_ENTRY]);
  });
});

describe('QuestViewModel — tabs', () => {
  test('defaults to the quests tab and switches to journal', () => {
    const viewModel = createViewModel();

    expect(viewModel.activeTab).toBe('quests');
    viewModel.setActiveTab('journal');
    expect(viewModel.activeTab).toBe('journal');
  });
});

describe('QuestViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
