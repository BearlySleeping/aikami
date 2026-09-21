// apps/frontend/client/src/lib/views/game/ui/quest_tracker_composition.ts
//
// Production wiring for the quest tracker HUD. This is the only module in the
// feature that imports the `$services` singleton; the ViewModel receives it as
// a typed capability.

import { questStateService } from '$services';
import {
  createQuestTrackerViewModel,
  type QuestTrackerViewModelInterface,
  type QuestTrackerViewModelOptions,
} from './quest_tracker_view_model.svelte';

/**
 * Builds the quest-tracker ViewModel wired to the production quest-state
 * singleton.
 */
export const getQuestTrackerViewModel = (
  options: Omit<QuestTrackerViewModelOptions, 'questState'>,
): QuestTrackerViewModelInterface =>
  createQuestTrackerViewModel({ ...options, questState: questStateService });
