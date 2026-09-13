// apps/frontend/client/src/lib/views/studio/studio_composition.ts
//
// C-512: production wiring for the Creator Studio. This is the only module in
// the feature that imports the `$services` barrel; the ViewModel receives the
// resolved capabilities as a typed option.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import { studioRecipeLabel } from '@aikami/constants';
import type { BaseViewModelOptions } from '@aikami/frontend/services/base';

import type { StudioRecipeOption } from '@aikami/types';
import {
  assetManager,
  assetPrefetchService,
  createGeneratedAssetWorkflow,
  detectImageEngine,
  imageGenerationService,
  isAssetGenerationEnabled,
  isAssetPublishingEnabled,
  runtimeConfigService,
} from '$services';
import {
  buildModalityRecipeOptions,
  createStudioEngineRegistry,
  createStudioGenerationRunner,
  type StudioEngineCapability,
} from './studio_generation_runner.ts';
import { createStudioViewModel, type StudioViewModelInterface } from './studio_view_model.svelte';

/**
 * The studio's engine registry (C-513 AC-12).
 *
 * One adapter per modality. The image adapter is the only engine the client
 * ships today; C-521 registers the audio adapter against this same registry
 * and the audio recipes become available without a change here — there is no
 * `modality === 'image'` switch left to update.
 */
const engineRegistry = createStudioEngineRegistry([
  {
    modality: 'image',
    unavailableReason:
      'No image engine is reachable — start the local engine (sd-server) and reload.',
    isAvailable: async (): Promise<boolean> => {
      // The engine's base URL comes from the runtime config chain; probing
      // before it loads reports "no engine" on a cold load even when one runs.
      await runtimeConfigService.loadConfig();
      return (await detectImageEngine()) !== undefined;
    },
    generate: async (options) => {
      const result = await imageGenerationService.generateImage({
        prompt: options.prompt,
        ...(options.negativePrompt === undefined ? {} : { negativePrompt: options.negativePrompt }),
        ...(options.initImage === undefined ? {} : { initImage: options.initImage }),
        ...(options.referenceImages === undefined
          ? {}
          : { referenceImages: options.referenceImages }),
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
    cancel: () => imageGenerationService.cancel(),
  },
]);

/**
 * The byte/descriptor seam for one modality.
 *
 * A dedicated workflow per engine — the contextual trigger owns the shared
 * singleton. The studio holds pending bytes between the review step and the
 * save, and must not evict a contextual generation's pending result.
 */
const createStudioWorkflow = (adapter: StudioEngineCapability) =>
  createGeneratedAssetWorkflow({
    generateImage: (options) => adapter.generate(options),
    registerGenerated: (asset, bytes) => assetManager.registerGenerated(asset, bytes),
  });

/** The shared, modality-neutral generation runner (C-513 AC-12). */
const studioRunner = createStudioGenerationRunner({
  registry: engineRegistry,
  createWorkflow: createStudioWorkflow,
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
 * Recipe options with availability resolved per modality (C-513 AC-12).
 *
 * Every recipe — image and audio alike — resolves through the engine registry
 * keyed by `recipe.modality`; an audio recipe reports `engineAvailable: true`
 * as soon as an audio adapter is registered, and carries a stated reason while
 * none is.
 */
const buildRecipeOptions = async (): Promise<readonly StudioRecipeOption[]> => {
  await runtimeConfigService.loadConfig();
  return buildModalityRecipeOptions({
    registry: engineRegistry,
    label: studioRecipeLabel,
  });
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
      generate: (request) => studioRunner.generate(request),
      save: (request) => studioRunner.save(request),
      cancelGeneration: () => studioRunner.cancel(),
      listLibrary: () => assetManager.listGeneratedAssets(),
      renameGenerated: (request) => assetManager.renameGeneratedAsset(request),
      deleteGenerated: (request) => assetManager.deleteGeneratedAsset(request),
      isGenerationEnabled: () => isAssetGenerationEnabled(),
      isPublishingEnabled: () => isAssetPublishingEnabled(),
      // The provenance projection comes from the asset's own registry row —
      // never a fabricated licence. An unknown source publishes as an empty
      // source, which the hub's gate refuses (fail closed).
      publish: async (request) => {
        const library = await assetManager.listGeneratedAssets();
        const entry = library.find((candidate) => candidate.tag === request.tag);
        return assetManager.publishCommunityAsset(request.tag, {
          title: request.title,
          provenance: { source: entry?.provenance.source ?? '' },
        });
      },
    },
  });
