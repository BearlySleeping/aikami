// apps/frontend/client/src/lib/views/game/ui/hud/quest_overlay_view_model.svelte.ts
//
// QuestOverlayViewModel — thin ViewModel over QuestOverlayService +
// QuestStateService powering the optional active-quest mini overlay
// (mirrors the music player overlay pattern).
//
// Shows the current active quest, its description, and per-objective
// progress, so the player always knows what they are working toward.

import type { QuestData, QuestObjectiveData } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { questOverlayService, questStateService } from '$services';

export type QuestOverlayObjective = QuestObjectiveData;

export type QuestOverlayViewModelInterface = BaseViewModelInterface & {
  /** Whether the overlay is visible (persisted toggle). */
  readonly visible: boolean;

  /** Whether any quest is currently active. */
  readonly hasActiveQuest: boolean;

  /** The first active quest, or undefined. */
  readonly activeQuest: QuestData | undefined;

  /** Title of the current active quest, or a placeholder. */
  readonly questTitle: string;

  /** Description of the current active quest. */
  readonly questDescription: string;

  /** Objective list of the current active quest. */
  readonly objectives: readonly QuestOverlayObjective[];

  /** Index of the current incomplete objective (or -1 when all done). */
  readonly currentObjectiveIndex: number;

  /** Percentage (0-100) of the current objective's progress. */
  readonly currentObjectivePercent: number;

  /** Hides the overlay (persisted). */
  hide(): void;
};

export type QuestOverlayViewModelOptions = BaseViewModelOptions;

class QuestOverlayViewModel
  extends BaseViewModel<QuestOverlayViewModelOptions>
  implements QuestOverlayViewModelInterface
{
  get visible(): boolean {
    return questOverlayService.visible;
  }

  /** First active quest (quests are ordered by accept time). */
  get activeQuest(): QuestData | undefined {
    return questStateService.quests.find((q) => q.status === 'active');
  }

  get hasActiveQuest(): boolean {
    return this.activeQuest !== undefined;
  }

  get questTitle(): string {
    return this.activeQuest?.title ?? 'No active quest';
  }

  get questDescription(): string {
    return this.activeQuest?.description ?? '';
  }

  get objectives(): readonly QuestOverlayObjective[] {
    return this.activeQuest?.objectives ?? [];
  }

  get currentObjectiveIndex(): number {
    const quest = this.activeQuest;
    if (!quest) {
      return -1;
    }
    const idx = quest.objectives.findIndex(
      (o) => o.current < o.max && o.status !== 'completed' && o.status !== 'failed',
    );
    return idx;
  }

  get currentObjectivePercent(): number {
    const quest = this.activeQuest;
    if (!quest) {
      return 0;
    }
    const idx = this.currentObjectiveIndex;
    if (idx < 0) {
      return 100;
    }
    const obj = quest.objectives[idx];
    if (!obj) {
      return 0;
    }
    return Math.round((obj.current / obj.max) * 100);
  }

  hide(): void {
    questOverlayService.setVisible(false);
  }
}

export const getQuestOverlayViewModel = (
  options: QuestOverlayViewModelOptions,
): QuestOverlayViewModelInterface => QuestOverlayViewModel.create(options);
