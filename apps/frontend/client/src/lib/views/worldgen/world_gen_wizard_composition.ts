// apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_composition.ts
//
// Production wiring for the world-generation wizard. This is the only module
// in the feature that imports the `$services` barrel; the ViewModel receives
// its dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import {
  campaignService,
  routerService,
  textGenerationService,
  worldGenSeedingService,
  worldStateService,
} from '$services';
import {
  createWorldGenWizardViewModel,
  type WorldGenWizardViewModelInterface,
  type WorldGenWizardViewModelOptions,
} from './world_gen_wizard_view_model.svelte';

/** Wizard options with the wired capabilities removed. */
export type WorldGenWizardPublicOptions = Omit<
  WorldGenWizardViewModelOptions,
  'campaign' | 'router' | 'textGeneration' | 'worldState' | 'worldGenSeeding'
>;

/**
 * Builds the world-generation wizard ViewModel wired to the production
 * campaign, router, LLM, world-state, and seeding singletons.
 */
export const getWorldGenWizardViewModel = (
  options: WorldGenWizardPublicOptions,
): WorldGenWizardViewModelInterface =>
  createWorldGenWizardViewModel({
    ...options,
    campaign: campaignService,
    router: routerService,
    textGeneration: textGenerationService,
    worldState: worldStateService,
    worldGenSeeding: worldGenSeedingService,
  });
