// apps/frontend/client/src/lib/views/studio/studio_composition.ts
//
// C-512: production wiring for the Creator Studio. This is the only module in
// the feature that imports the `$services` barrel; the ViewModel receives the
// resolved capabilities as a typed option.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import { studioRecipeLabel } from '@aikami/constants';
import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { listRecipes } from '@aikami/local-ai';
import type { StudioRecipeOption } from '@aikami/types';
import {
  assetManager,
  assetPrefetchService,
  createGeneratedAssetWorkflow,
  detectImageEngine,
  imageGenerationService,
  isAssetGenerationEnabled,
  runtimeConfigService,
} from '$services';
import { createStudioViewModel, type StudioViewModelInterface } from './studio_view_model.svelte';

/**
 * The studio's byte/descriptor seam.
 *
 * A dedicated instance — the contextual trigger owns the shared singleton. The
 * studio holds pending bytes between the review step and the save, and must not
 * evict a contextual generation's pending result to make room.
 */
const studioWorkflow = createGeneratedAssetWorkflow({
  generateImage: async (options) => {
    const result = await imageGenerationService.generateImage({
      prompt: options.prompt,
      ...(options.negativePrompt === undefined ? {} : { negativePrompt: options.negativePrompt }),
      ...(options.initImage === undefined ? {} : { initImage: options.initImage }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return {
      blob: result.blob,
      mimeType: result.mimeType,
      engineId: result.engineId,
      ...(result.seed === undefined ? {} : { seed: result.seed }),
      isDemo: result.isDemo,
    };
  },
  registerGenerated: (asset, bytes) => assetManager.registerGenerated(asset, bytes),
});

/**
 * Opens everything the studio reads before it reads it.
 *
 * `/studio/assets` is reachable from the start menu and by deep link, so it can
 * load before the game boot pipeline has opened the registry — and
 * `resolveImageBaseUrl` reads the runtime config, which is empty until
 * `loadConfig()` resolves. Both calls are memoized/idempotent.
 */
const ensureStudioReady = async (): Promise<void> => {
  await runtimeConfigService.loadConfig();
  await assetPrefetchService.ensureRegistryReady();
};

/**
 * Recipe options with availability resolved per modality.
 *
 * Only image recipes can be generated from the studio today: the client's
 * generation path is `imageGenerationService`, so an audio recipe is listed but
 * stays unavailable until an audio engine is wired into the studio (C-511 ships
 * the engine server-side, not the client path).
 */
const buildRecipeOptions = async (): Promise<readonly StudioRecipeOption[]> => {
  // The engine's base URL comes from the runtime config chain; probing before
  // it loads reports "no engine" on a cold load even when one is running.
  await runtimeConfigService.loadConfig();
  const engine = await detectImageEngine();
  return listRecipes().map((recipe) => ({
    recipeId: recipe.id,
    label: studioRecipeLabel(recipe.id),
    category: recipe.category,
    modality: recipe.modality,
    engineAvailable: recipe.modality === 'image' && engine !== undefined,
  }));
};

/**
 * Builds the Creator Studio ViewModel wired to the production engine, registry
 * and library.
 */
export const getStudioViewModel = (options: BaseViewModelOptions): StudioViewModelInterface =>
  createStudioViewModel({
    ...options,
    capabilities: {
      ensureReady: ensureStudioReady,
      listRecipeOptions: buildRecipeOptions,
      generate: (request) => studioWorkflow.generate(request),
      save: (request) => studioWorkflow.save(request),
      cancelGeneration: () => imageGenerationService.cancel(),
      listLibrary: () => assetManager.listGeneratedAssets(),
      renameGenerated: (request) => assetManager.renameGeneratedAsset(request),
      deleteGenerated: (request) => assetManager.deleteGeneratedAsset(request),
      isGenerationEnabled: () => isAssetGenerationEnabled(),
    },
  });
