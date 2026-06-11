// apps/frontend/client/src/lib/views/quest/quest_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ── Types ──────────────────────────────────────────────────────────────

/** A single objective within a quest. */
export type QuestObjective = {
  readonly label: string;
  current: number;
  readonly max: number;
};

/** Quest status values. */
export type QuestStatus = 'active' | 'completed' | 'failed';

/** A quest tracked in the quest log. */
export type Quest = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  status: QuestStatus;
  objectives: QuestObjective[];
};

// ── Interface ──────────────────────────────────────────────────────────

export type QuestViewModelInterface = BaseViewModelInterface & {
  readonly activeQuests: readonly Quest[];
  readonly completedQuests: readonly Quest[];
  readonly failedQuests: readonly Quest[];
  readonly questCount: number;
};

export type QuestViewModelOptions = BaseViewModelOptions & {};

// ── Implementation ─────────────────────────────────────────────────────

export class QuestViewModel
  extends BaseViewModel<QuestViewModelOptions>
  implements QuestViewModelInterface
{
  activeQuests: Quest[] = $state([]);
  completedQuests: Quest[] = $state([]);
  failedQuests: Quest[] = $state([]);

  get questCount(): number {
    return this.activeQuests.length + this.completedQuests.length + this.failedQuests.length;
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Adds a quest to the active list.
   * Ignores quests with an id that already exists in any list.
   */
  addQuest(quest: Quest): void {
    if (this._findQuest(quest.id)) {
      this.debug('addQuest: duplicate id ignored', { id: quest.id });
      return;
    }
    this.activeQuests.push(quest);
  }

  /**
   * Moves a quest from active to completed.
   * Also marks all objectives as complete if they aren't already.
   */
  completeQuest(questId: string): void {
    const idx = this.activeQuests.findIndex((q) => q.id === questId);
    if (idx === -1) {
      this.debug('completeQuest: quest not found in active', { questId });
      return;
    }
    const quest = this.activeQuests[idx];
    if (!quest) {
      return;
    }
    this.activeQuests.splice(idx, 1);
    quest.status = 'completed';
    for (const objective of quest.objectives) {
      objective.current = objective.max;
    }
    this.completedQuests.push(quest);
  }

  /**
   * Moves a quest from active to failed.
   */
  failQuest(questId: string): void {
    const idx = this.activeQuests.findIndex((q) => q.id === questId);
    if (idx === -1) {
      this.debug('failQuest: quest not found in active', { questId });
      return;
    }
    const quest = this.activeQuests[idx];
    if (!quest) {
      return;
    }
    this.activeQuests.splice(idx, 1);
    quest.status = 'failed';
    this.failedQuests.push(quest);
  }

  /**
   * Increments the current value of an objective within an active quest.
   * Caps at the objective's `max` value.
   */
  progressObjective(questId: string, objectiveIndex: number): void {
    const quest = this.activeQuests.find((q) => q.id === questId);
    if (!quest) {
      this.debug('progressObjective: quest not found', { questId });
      return;
    }
    const objective = quest.objectives[objectiveIndex];
    if (!objective) {
      this.debug('progressObjective: objective not found', { questId, objectiveIndex });
      return;
    }
    if (objective.current < objective.max) {
      objective.current++;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private _findQuest(id: string): Quest | undefined {
    return (
      this.activeQuests.find((q) => q.id === id) ??
      this.completedQuests.find((q) => q.id === id) ??
      this.failedQuests.find((q) => q.id === id)
    );
  }
}

export const getQuestViewModel = (options: QuestViewModelOptions): QuestViewModelInterface =>
  new QuestViewModel(options);
