// apps/frontend/client/src/lib/views/dev/world_gen_sandbox_composition.ts
//
// Production wiring for the dev world-generation sandbox. This is the only
// module in the sandbox feature that imports the `$services` barrel; the
// sandbox ViewModel receives its dependencies as typed capabilities.

import {
  campaignService,
  routerService,
  textGenerationService,
  worldGenSeedingService,
  worldStateService,
} from '$services';
import {
  createWorldGenSandboxViewModel,
  type WorldGenSandboxViewModelInterface,
  type WorldGenSandboxViewModelOptions,
} from './world_gen_sandbox_view_model.svelte.ts';

/** Sandbox options with the wired capabilities removed. */
export type WorldGenSandboxPublicOptions = Omit<
  WorldGenSandboxViewModelOptions,
  'campaign' | 'router' | 'textGeneration' | 'worldState' | 'worldGenSeeding'
>;

/**
 * Builds the dev sandbox ViewModel wired to the production campaign, router,
 * LLM, world-state, and seeding singletons.
 */
export const getWorldGenSandboxViewModel = (
  options: WorldGenSandboxPublicOptions,
): WorldGenSandboxViewModelInterface =>
  createWorldGenSandboxViewModel({
    ...options,
    campaign: campaignService,
    router: routerService,
    textGeneration: textGenerationService,
    worldState: worldStateService,
    worldGenSeeding: worldGenSeedingService,
  });
