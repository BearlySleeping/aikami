// apps/frontend/client/src/lib/views/quest/quest_view_model.svelte.ts
//
// Quest log ViewModel. Reads quest data from an injected quest-state
// capability which syncs with the ECS engine via GameStateService.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/quest_fixtures.ts). Production
// wiring lives in ./quest_composition.ts.
//
// Contract: C-143 Quest Log Sync
// Contract: C-339 Quest Graph, Journal, Objectives

import type { QuestData, QuestJournalEntry } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';

// ── Capability contracts ────────────────────────────────────────────────

/** The quest-state fields the quest log reads (reactively). */
export type QuestStateCapabilities = {
  readonly quests: QuestData[];
  readonly journalEntries: readonly QuestJournalEntry[];
};

// ── Types ───────────────────────────────────────────────────────────────

export type QuestViewModelOptions = BaseViewModelOptions & {
  /** Quest-state capability. */
  questState: QuestStateCapabilities;
};

export type QuestViewModelInterface = BaseViewModelInterface & {
  readonly activeQuests: readonly QuestData[];
  readonly completedQuests: readonly QuestData[];
  readonly failedQuests: readonly QuestData[];
  readonly journalEntries: readonly QuestJournalEntry[];
  readonly questCount: number;
  readonly activeTab: 'quests' | 'journal';
  setActiveTab(tab: 'quests' | 'journal'): void;
};

// ── Implementation ──────────────────────────────────────────────────────

class QuestViewModel
  extends BaseViewModel<QuestViewModelOptions>
  implements QuestViewModelInterface
{
  private readonly _questState: QuestStateCapabilities;

  private _activeTab = $state<'quests' | 'journal'>('quests');

  constructor(options: QuestViewModelOptions) {
    super(options);
    this._questState = options.questState;
  }

  get activeTab(): 'quests' | 'journal' {
    return this._activeTab;
  }

  setActiveTab(tab: 'quests' | 'journal'): void {
    this._activeTab = tab;
  }

  get activeQuests(): readonly QuestData[] {
    return this._questState.quests.filter((q) => q.status === 'active');
  }

  get completedQuests(): readonly QuestData[] {
    return this._questState.quests.filter((q) => q.status === 'completed');
  }

  get failedQuests(): readonly QuestData[] {
    return this._questState.quests.filter((q) => q.status === 'failed');
  }

  get journalEntries(): readonly QuestJournalEntry[] {
    return this._questState.journalEntries;
  }

  get questCount(): number {
    return this._questState.quests.length;
  }
}

/**
 * Builds a quest-log ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getQuestViewModel` in ./quest_composition.ts.
 */
export const createQuestViewModel = (options: QuestViewModelOptions): QuestViewModelInterface =>
  QuestViewModel.create(options);
