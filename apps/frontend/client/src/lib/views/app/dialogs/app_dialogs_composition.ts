// apps/frontend/client/src/lib/views/app/dialogs/app_dialogs_composition.ts
//
// Production wiring for the app-wide dialog surface. This is the only module in
// the feature that imports the `$services` singletons; the ViewModel receives
// them as typed capabilities.

import { dialogService } from '$services';
import { imageGenerationService } from '$services/image/image_generation_service.svelte';
import {
  type AppDialogsViewModelInterface,
  type AppDialogsViewModelOptions,
  createAppDialogsViewModel,
} from './app_dialogs_view_model.svelte';

/**
 * Builds the app-dialogs ViewModel wired to the production dialog and image
 * generation singletons.
 */
export const getAppDialogsViewModel = (
  options: Omit<AppDialogsViewModelOptions, 'dialog' | 'progress'>,
): AppDialogsViewModelInterface =>
  createAppDialogsViewModel({
    ...options,
    dialog: dialogService,
    progress: imageGenerationService,
  });
