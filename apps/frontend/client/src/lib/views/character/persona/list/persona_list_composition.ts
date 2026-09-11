// apps/frontend/client/src/lib/views/character/persona/list/persona_list_composition.ts
//
// Production wiring for the persona list ViewModel. This is the only module in
// the feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import {
  authService,
  campaignService,
  compileCardToPersona,
  equipmentService,
  gameModeService,
  hasDeclaredAbilityScores,
  importFromJson,
  importFromPng,
  inventoryService,
  lorebookStore,
  personaService,
  playerStateService,
  routerService,
  storageService,
  worldStateService,
} from '$services';
import {
  createPersonaListViewModel,
  type PersonaListViewModelInterface,
} from './persona_list_view_model.svelte';

/**
 * Builds the persona list ViewModel wired to the production persona, identity,
 * storage, campaign, router, game-mode, card-parsing, and lorebook singletons.
 */
export const getPersonaListViewModel = (
  options: BaseViewModelOptions,
): PersonaListViewModelInterface =>
  createPersonaListViewModel({
    ...options,
    personas: personaService,
    auth: authService,
    storage: storageService,
    campaign: campaignService,
    router: routerService,
    gameState: {
      resetAll: () => {
        playerStateService.reset();
        inventoryService.reset();
        equipmentService.reset();
        gameModeService.reset();
        worldStateService.reset();
      },
    },
    cards: { compileCardToPersona, hasDeclaredAbilityScores, importFromJson, importFromPng },
    lorebook: lorebookStore,
  });
