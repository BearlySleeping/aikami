// apps/frontend/client/src/lib/views/dev/image_gen/image_gen_composition.ts
//
// Production wiring for the dev image-generation pipeline sandbox. This is the
// only module in the feature that imports the `$services` barrel; the ViewModel
// receives its dependencies as typed capabilities, so unit tests never touch
// the global service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import {
  compileImagePrompt,
  contextualTriggerService,
  galleryService,
  styleProfileService,
} from '$services';
import {
  createImageGenViewModel,
  type ImageGenViewModelInterface,
} from './image_gen_view_model.svelte';

/**
 * Builds the image-gen ViewModel wired to the production style-profile,
 * contextual-trigger, gallery, and prompt-compiler singletons.
 */
export const getImageGenViewModel = (options: BaseViewModelOptions): ImageGenViewModelInterface =>
  createImageGenViewModel({
    ...options,
    styleProfiles: styleProfileService,
    triggers: contextualTriggerService,
    gallery: galleryService,
    compiler: { compileImagePrompt },
  });
