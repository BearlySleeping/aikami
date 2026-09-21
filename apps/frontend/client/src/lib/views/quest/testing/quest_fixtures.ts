// apps/frontend/client/src/lib/views/quest/testing/quest_fixtures.ts
//
// Feature-owned test doubles for the quest-log ViewModel. Defaults are empty;
// tests override only the state they exercise.

import type { QuestStateCapabilities } from '../quest_view_model.svelte';

/** Quest-state capability with empty quests/journal until overridden. */
export const createQuestState = (
  overrides: Partial<QuestStateCapabilities> = {},
): QuestStateCapabilities => ({
  quests: [],
  journalEntries: [],
  ...overrides,
});
