// apps/frontend/client/src/lib/views/dev/image/image_composition.ts
//
// Production wiring for the dev image sandbox. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import {
  compileImagePrompt,
  getConfiguredImageEngineId,
  imageGenerationService,
  styleProfileService,
} from '$services';
import { createImageViewModel, type ImageViewModelInterface } from './image_view_model.svelte';

/**
 * Builds the image ViewModel wired to the production image-generation,
 * style-profile, and prompt-compiler singletons.
 */
export const getImageViewModel = (options: BaseViewModelOptions): ImageViewModelInterface =>
  createImageViewModel({
    ...options,
    imageGeneration: imageGenerationService,
    styleProfiles: styleProfileService,
    compiler: { compileImagePrompt },
    getConfiguredEngineId: getConfiguredImageEngineId,
  });
