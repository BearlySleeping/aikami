// apps/frontend/client/src/lib/views/quest/quest_view_model.svelte.ts
//
// Quest log ViewModel. Reads quest data reactively from GameStateService
// which syncs with the ECS engine via QUESTS_UPDATED bridge events.
//
// Contract: C-143 Quest Log Sync

import type { QuestData } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { gameStateService } from '$services';

// ── Re-export engine quest types for view convenience ──────────────────

export type { QuestData as Quest };

// ── Interface ──────────────────────────────────────────────────────────

export type QuestViewModelInterface = BaseViewModelInterface & {
  readonly activeQuests: readonly QuestData[];
  readonly completedQuests: readonly QuestData[];
  readonly failedQuests: readonly QuestData[];
  readonly questCount: number;
};

export type QuestViewModelOptions = BaseViewModelOptions & {};

// ── Implementation ─────────────────────────────────────────────────────

export class QuestViewModel
  extends BaseViewModel<QuestViewModelOptions>
  implements QuestViewModelInterface
{
  /**
   * Active quests — reads reactively from GameStateService which syncs
   * with the ECS engine via QUESTS_UPDATED bridge events.
   */
  get activeQuests(): readonly QuestData[] {
    return gameStateService.quests.filter((q) => q.status === 'active');
  }

  /** Completed quests synced from the ECS engine. */
  get completedQuests(): readonly QuestData[] {
    return gameStateService.quests.filter((q) => q.status === 'completed');
  }

  /** Failed quests synced from the ECS engine. */
  get failedQuests(): readonly QuestData[] {
    return gameStateService.quests.filter((q) => q.status === 'failed');
  }

  /** Total number of quests across all statuses. */
  get questCount(): number {
    return gameStateService.quests.length;
  }
}

export const getQuestViewModel = (options: QuestViewModelOptions): QuestViewModelInterface =>
  new QuestViewModel(options);
