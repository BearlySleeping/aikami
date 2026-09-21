// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_composition.ts
//
// Production wiring for the in-game dialogue overlay. This is the only module
// in the feature that imports the `$services` barrel; the ViewModel receives
// its collaborators as typed capabilities so unit tests and the dev sandbox
// never touch the global service registry.

import type { NpcDialogueServiceInterface, PlayerStateServiceInterface } from '$services';
import * as appServices from '$services';
import {
  createDialogueOverlayViewModel,
  type DialogueOverlayCapabilities,
  type DialogueOverlayViewModelInterface,
  type DialogueOverlayViewModelOptions,
} from './dialogue_overlay_view_model.svelte';

/**
 * The production capabilities for the dialogue overlay ViewModel. Exposed so
 * dev subclasses can build the same wiring without duplicating it.
 */
export const createDialogueOverlayCapabilities = (): DialogueOverlayCapabilities => ({
  combat: appServices.combatService,
  dice: appServices.diceService,
  draft: appServices.draftStore,
  expression: appServices.expressionService,
  gameMode: appServices.gameModeService,
  image: appServices.imageGenerationService,
  messageBranch: appServices.messageBranchStore,
  quest: appServices.questStateService,
  router: appServices.routerService,
  tts: appServices.ttsService,
  chunker: appServices.SentenceBoundaryChunker,
  gameStateFacts: appServices.buildGameStateFacts,
  playerState: appServices.playerStateService,
  operations: appServices.operationLedgerService,
  campaign: {
    get campaignId() {
      return appServices.campaignService.activeCampaign?.id;
    },
  },
});

/**
 * Caller-facing options for the production factory. Mirrors the pre-migration
 * signature: the capabilities and the NPC orchestrator are supplied here, and
 * `playerStateService` remains an optional override.
 */
export type DialogueOverlayCompositionOptions = Omit<
  DialogueOverlayViewModelOptions,
  keyof DialogueOverlayCapabilities | 'npcDialogueService'
> & {
  npcDialogueService?: NpcDialogueServiceInterface;
  playerStateService?: PlayerStateServiceInterface;
};

/**
 * Builds the dialogue overlay ViewModel wired to the production singletons.
 */
export const getDialogueOverlayViewModel = (
  options: DialogueOverlayCompositionOptions,
): DialogueOverlayViewModelInterface =>
  createDialogueOverlayViewModel({
    ...options,
    ...createDialogueOverlayCapabilities(),
    npcDialogueService: options.npcDialogueService ?? appServices.npcDialogueService,
    playerState: options.playerStateService ?? appServices.playerStateService,
  });
