// apps/frontend/client/src/lib/views/game/ui/quest_tracker_view_model.svelte.ts
//
// Quest tracker HUD ViewModel — exposes the current active quest's first
// incomplete objective as a compact 1-2 line display.
// Contract: C-329 Integrate the Demo Quest from Offer Through Reward

import type { QuestData } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { questStateService } from '$services';

export type QuestTrackerViewModelInterface = BaseViewModelInterface & {
  readonly activeQuests: readonly QuestData[];
  readonly hasQuests: boolean;
  readonly currentObjectiveText: string;
};

export type QuestTrackerViewModelOptions = BaseViewModelOptions & {};

class QuestTrackerViewModel
  extends BaseViewModel<QuestTrackerViewModelOptions>
  implements QuestTrackerViewModelInterface
{
  get activeQuests(): readonly QuestData[] {
    return questStateService.quests.filter((q) => q.status === 'active');
  }

  get hasQuests(): boolean {
    return this.activeQuests.length > 0;
  }

  /**
   * Returns the first incomplete objective text from the first active quest.
   * Fallback: empty string.
   */
  get currentObjectiveText(): string {
    for (const quest of this.activeQuests) {
      for (const objective of quest.objectives) {
        if (objective.current < objective.max) {
          return `${quest.title}: ${objective.label}`;
        }
      }
    }
    return '';
  }
}

export const getQuestTrackerViewModel = (
  options: QuestTrackerViewModelOptions,
): QuestTrackerViewModelInterface => QuestTrackerViewModel.create(options);
