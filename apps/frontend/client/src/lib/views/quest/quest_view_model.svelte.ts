// apps/frontend/client/src/lib/views/quest/quest_view_model.svelte.ts
//
// Quest log ViewModel. Reads quest data from QuestService
// which syncs with the ECS engine via GameStateService.
//
// Contract: C-143 Quest Log Sync

import type { QuestData } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { questService } from '$services';

export type QuestViewModelInterface = BaseViewModelInterface & {
  readonly activeQuests: readonly QuestData[];
  readonly completedQuests: readonly QuestData[];
  readonly failedQuests: readonly QuestData[];
  readonly questCount: number;
};

export type QuestViewModelOptions = BaseViewModelOptions & {};

class QuestViewModel
  extends BaseViewModel<QuestViewModelOptions>
  implements QuestViewModelInterface
{
  get activeQuests(): readonly QuestData[] {
    return questService.quests.filter((q) => q.status === 'active');
  }

  get completedQuests(): readonly QuestData[] {
    return questService.quests.filter((q) => q.status === 'completed');
  }

  get failedQuests(): readonly QuestData[] {
    return questService.quests.filter((q) => q.status === 'failed');
  }

  get questCount(): number {
    return questService.quests.length;
  }
}

export const getQuestViewModel = (options: QuestViewModelOptions): QuestViewModelInterface =>
  QuestViewModel.create(options);
