// apps/frontend/client/src/lib/views/game/ui/hud/quest_overlay_composition.ts
//
// Production wiring for the active-quest mini overlay. This is the only module
// in the feature that imports the `$services` singletons; the ViewModel
// receives its dependencies as typed capabilities.

import { campaignService, questOverlayService, questStateService } from '$services';
import {
  createQuestOverlayViewModel,
  type QuestOverlayViewModelInterface,
  type QuestOverlayViewModelOptions,
} from './quest_overlay_view_model.svelte';

/**
 * Builds the quest-overlay ViewModel wired to the production overlay, quest
 * state, and campaign singletons.
 */
export const getQuestOverlayViewModel = (
  options: Omit<QuestOverlayViewModelOptions, 'overlay' | 'questState' | 'campaign'>,
): QuestOverlayViewModelInterface =>
  createQuestOverlayViewModel({
    ...options,
    overlay: questOverlayService,
    questState: questStateService,
    campaign: campaignService,
  });
