// apps/frontend/client/src/lib/views/game/ui/testing/quest_tracker_reactive_fixtures.svelte.ts
//
// Reactive quest-tracker double for the real-Svelte (Vitest Browser Mode) lane.
// The quest list is real `$state`, so a test can mutate it and observe the
// ViewModel's derived getters update.

import type { QuestData } from '@aikami/frontend/engine/sim';
import type { QuestTrackerQuestStateCapabilities } from '../quest_tracker_view_model.svelte';

export type ReactiveQuestTrackerHarness = {
  /** The capability object to inject into the ViewModel. */
  questState: QuestTrackerQuestStateCapabilities;
  /** Replace the reactive quest list. */
  setQuests(quests: QuestData[]): void;
};

/**
 * Creates a quest-tracker double whose quest list is real Svelte `$state`, plus
 * a harness method to replace it.
 */
export const createReactiveQuestTrackerHarness = (): ReactiveQuestTrackerHarness => {
  let quests = $state<QuestData[]>([]);

  const questState: QuestTrackerQuestStateCapabilities = {
    get quests() {
      return quests;
    },
  };

  return {
    questState,
    setQuests: (next) => {
      quests = next;
    },
  };
};
