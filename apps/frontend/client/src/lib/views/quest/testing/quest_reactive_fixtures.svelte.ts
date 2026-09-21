// apps/frontend/client/src/lib/views/quest/testing/quest_reactive_fixtures.svelte.ts
//
// Reactive quest-log double for the real-Svelte (Vitest Browser Mode) lane.
// The quest list and journal are real `$state`, so a test can mutate them and
// observe the ViewModel's derived getters update.

import type { QuestData, QuestJournalEntry } from '@aikami/frontend/engine/sim';
import type { QuestStateCapabilities } from '../quest_view_model.svelte';

export type ReactiveQuestHarness = {
  /** The capability object to inject into the ViewModel. */
  questState: QuestStateCapabilities;
  /** Replace the reactive quest list. */
  setQuests(quests: QuestData[]): void;
  /** Replace the reactive journal list. */
  setJournalEntries(entries: QuestJournalEntry[]): void;
};

/**
 * Creates a quest-log double whose quest and journal lists are real Svelte
 * `$state`, plus harness methods to replace them.
 */
export const createReactiveQuestHarness = (): ReactiveQuestHarness => {
  let quests = $state<QuestData[]>([]);
  let journalEntries = $state<QuestJournalEntry[]>([]);

  const questState: QuestStateCapabilities = {
    get quests() {
      return quests;
    },
    get journalEntries() {
      return journalEntries;
    },
  };

  return {
    questState,
    setQuests: (next) => {
      quests = next;
    },
    setJournalEntries: (next) => {
      journalEntries = next;
    },
  };
};
