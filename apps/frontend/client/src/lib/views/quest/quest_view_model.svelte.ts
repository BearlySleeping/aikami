// apps/frontend/client/src/lib/views/quest/quest_view_model.svelte.ts
//
// Quest log ViewModel. Reads quest data from QuestStateService
// which syncs with the ECS engine via GameStateService.
//
// Contract: C-143 Quest Log Sync
// Contract: C-339 Quest Graph, Journal, Objectives

import type { QuestData, QuestJournalEntry } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { questStateService } from '$services';

export type QuestViewModelInterface = BaseViewModelInterface & {
  readonly activeQuests: readonly QuestData[];
  readonly completedQuests: readonly QuestData[];
  readonly failedQuests: readonly QuestData[];
  readonly journalEntries: readonly QuestJournalEntry[];
  readonly questCount: number;
  readonly activeTab: 'quests' | 'journal';
  setActiveTab(tab: 'quests' | 'journal'): void;
};

export type QuestViewModelOptions = BaseViewModelOptions & {};

class QuestViewModel
  extends BaseViewModel<QuestViewModelOptions>
  implements QuestViewModelInterface
{
  private _activeTab = $state<'quests' | 'journal'>('quests');

  get activeTab(): 'quests' | 'journal' {
    return this._activeTab;
  }

  setActiveTab(tab: 'quests' | 'journal'): void {
    this._activeTab = tab;
  }

  get activeQuests(): readonly QuestData[] {
    return questStateService.quests.filter((q) => q.status === 'active');
  }

  get completedQuests(): readonly QuestData[] {
    return questStateService.quests.filter((q) => q.status === 'completed');
  }

  get failedQuests(): readonly QuestData[] {
    return questStateService.quests.filter((q) => q.status === 'failed');
  }

  get journalEntries(): readonly QuestJournalEntry[] {
    return questStateService.journalEntries;
  }

  get questCount(): number {
    return questStateService.quests.length;
  }
}

export const getQuestViewModel = (options: QuestViewModelOptions): QuestViewModelInterface =>
  QuestViewModel.create(options);
