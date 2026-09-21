// apps/frontend/client/src/lib/views/game/ui/quest_tracker_view_model.svelte.ts
//
// Quest tracker HUD ViewModel — exposes the current active quest's first
// incomplete objective as a compact 1-2 line display.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/quest_tracker_fixtures.ts).
// Production wiring lives in ./quest_tracker_composition.ts.
//
// Contract: C-329 Integrate the Demo Quest from Offer Through Reward

import type { QuestData } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';

// ── Capability contracts ────────────────────────────────────────────────

/** The quest list the tracker derives from (read reactively). */
export type QuestTrackerQuestStateCapabilities = {
  readonly quests: QuestData[];
};

// ── Types ───────────────────────────────────────────────────────────────

export type QuestTrackerViewModelOptions = BaseViewModelOptions & {
  /** Quest-state capability. */
  questState: QuestTrackerQuestStateCapabilities;
};

export type QuestTrackerViewModelInterface = BaseViewModelInterface & {
  readonly activeQuests: readonly QuestData[];
  readonly hasQuests: boolean;
  readonly currentObjectiveText: string;
};

// ── Implementation ──────────────────────────────────────────────────────

class QuestTrackerViewModel
  extends BaseViewModel<QuestTrackerViewModelOptions>
  implements QuestTrackerViewModelInterface
{
  private readonly _questState: QuestTrackerQuestStateCapabilities;

  constructor(options: QuestTrackerViewModelOptions) {
    super(options);
    this._questState = options.questState;
  }

  get activeQuests(): readonly QuestData[] {
    return this._questState.quests.filter((q) => q.status === 'active');
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

/**
 * Builds a quest-tracker ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getQuestTrackerViewModel` in ./quest_tracker_composition.ts.
 */
export const createQuestTrackerViewModel = (
  options: QuestTrackerViewModelOptions,
): QuestTrackerViewModelInterface => QuestTrackerViewModel.create(options);
