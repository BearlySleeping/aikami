// apps/frontend/client/src/lib/views/game/ui/game_ui_composition.ts
//
// Production wiring for the game-UI overlay router. This is the only module in
// the feature that imports the `$services` singletons and the child
// compositions; the ViewModel receives them as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import {
  chatService,
  combatService,
  configService,
  type GameEngineServiceInterface,
  gameEngineService,
  gameOverlayService,
  inputActionService,
  npcDialogueService,
  onboardingHintService,
  playerStateService,
  questOverlayService,
  runtimeConfigService,
  sessionService,
  timeService,
} from '$services';
import { getCombatViewModel } from '$views/combat/combat_composition.ts';
import { getCharacterSheetViewModel } from '$views/game/dashboard/character_sheet_composition.ts';
import { getDialogueOverlayViewModel } from '$views/game/ui/overlays/dialogue/dialogue_overlay_composition.ts';
import { getEndSessionViewModel } from '$views/game/ui/overlays/end_session/end_session_composition.ts';
import { getGameOverViewModel } from '$views/game/ui/overlays/game_over/game_over_composition.ts';
import { getPartyRosterViewModel } from '$views/game/ui/overlays/party_roster/party_roster_composition.ts';
import { getPauseMenuViewModel } from '$views/game/ui/overlays/pause_menu/pause_menu_composition.ts';
import { getReputationViewModel } from '$views/game/ui/overlays/reputation/reputation_composition.ts';
import { getSettingsOverlayViewModel } from '$views/game/ui/overlays/settings/settings_overlay_composition.ts';
import { getTalkToPartyViewModel } from '$views/game/ui/overlays/talk_to_party/talk_to_party_composition.ts';
import { getQuestTrackerViewModel } from '$views/game/ui/quest_tracker_composition.ts';
import { getInventoryViewModel } from '$views/inventory/inventory_composition.ts';
import { getQuestViewModel } from '$views/quest/quest_composition.ts';
import { getVendorViewModel } from '$views/vendor/vendor_composition.ts';
import { createGameUIViewModel, type GameUIViewModelInterface } from './game_ui_view_model.svelte';

/**
 * Builds the game-UI ViewModel wired to the production service singletons and
 * child overlay compositions.
 */
export const getGameUIViewModel = (options: BaseViewModelOptions): GameUIViewModelInterface =>
  createGameUIViewModel({
    ...options,
    chat: chatService,
    combat: combatService,
    config: configService,
    runtimeConfig: runtimeConfigService,
    overlays: gameOverlayService,
    inputAction: inputActionService,
    npcDialogue: npcDialogueService,
    onboarding: onboardingHintService,
    playerState: playerStateService,
    questOverlay: questOverlayService,
    session: sessionService,
    time: timeService,
    engine: gameEngineService as GameEngineServiceInterface,
    createCombatViewModel: getCombatViewModel,
    createDialogueOverlayViewModel: getDialogueOverlayViewModel,
    createInventoryViewModel: getInventoryViewModel,
    createQuestViewModel: getQuestViewModel,
    createCharacterSheetViewModel: getCharacterSheetViewModel,
    createVendorViewModel: getVendorViewModel,
    createEndSessionViewModel: getEndSessionViewModel,
    createGameOverViewModel: getGameOverViewModel,
    createPauseMenuViewModel: getPauseMenuViewModel,
    createSettingsOverlayViewModel: getSettingsOverlayViewModel,
    createPartyRosterViewModel: getPartyRosterViewModel,
    createReputationViewModel: getReputationViewModel,
    createTalkToPartyViewModel: getTalkToPartyViewModel,
    createQuestTrackerViewModel: getQuestTrackerViewModel,
  });
