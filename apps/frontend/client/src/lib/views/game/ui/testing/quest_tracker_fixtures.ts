// apps/frontend/client/src/lib/views/game/ui/testing/quest_tracker_fixtures.ts
//
// Feature-owned test doubles for the quest-tracker ViewModel.

import type { QuestData } from '@aikami/frontend/engine/sim';
import type { QuestTrackerQuestStateCapabilities } from '../quest_tracker_view_model.svelte';

/** Quest-state capability with an empty quest list until overridden. */
export const createQuestTrackerQuestState = (
  quests: QuestData[] = [],
): QuestTrackerQuestStateCapabilities => ({ quests });
