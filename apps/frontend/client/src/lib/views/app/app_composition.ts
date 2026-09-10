// apps/frontend/client/src/lib/views/app/app_composition.ts
//
// Boot composition for the root application ViewModel. This is the seam where
// the app-wide dialog implementation is registered into the base class
// hierarchy (see dialog_capabilities.ts). Keeping it here means importing
// `BaseViewModel` no longer drags in the dialog singleton, and tests can
// construct base subclasses without an application graph.

import { setDialogCapabilities } from '@aikami/frontend/services/base';
import { dialogService } from '$services';
import {
  type AppViewModelInterface,
  type AppViewModelOptions,
  createAppViewModel,
} from './app_view_model.svelte';

/**
 * Builds the root AppViewModel and registers the production dialog
 * capabilities. Idempotent; safe to call from tests that boot the app.
 */
export const getAppViewModel = (options: AppViewModelOptions): AppViewModelInterface => {
  setDialogCapabilities(dialogService);
  return createAppViewModel(options);
};
