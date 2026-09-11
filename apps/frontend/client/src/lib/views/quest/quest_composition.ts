// apps/frontend/client/src/lib/views/quest/quest_composition.ts
//
// Production wiring for the quest log. This is the only module in the feature
// that imports the `$services` singleton; the ViewModel receives it as a typed
// capability.

import { questStateService } from '$services';
import {
  createQuestViewModel,
  type QuestViewModelInterface,
  type QuestViewModelOptions,
} from './quest_view_model.svelte';

/**
 * Builds the quest-log ViewModel wired to the production quest-state singleton.
 */
export const getQuestViewModel = (
  options: Omit<QuestViewModelOptions, 'questState'>,
): QuestViewModelInterface => createQuestViewModel({ ...options, questState: questStateService });
