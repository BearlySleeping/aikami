// apps/frontend/client/src/lib/views/app/app_composition.ts
//
// Boot composition for the root application ViewModel. This is the seam where
// the app-wide dialog implementation is registered into the base class
// hierarchy (see dialog_capabilities.ts) and where the production service
// singletons are injected into the ViewModel's typed capabilities.

import { setDialogCapabilities } from '@aikami/frontend/services/base';
import {
  appService,
  authService,
  dialogService,
  emulatorSeedService,
  routerService,
  runtimeConfigService,
  updaterService,
} from '$services';
import {
  type AppViewModelCallerOptions,
  type AppViewModelInterface,
  createAppViewModel,
} from './app_view_model.svelte';

/**
 * Builds the root AppViewModel and registers the production dialog
 * capabilities. Idempotent; safe to call from tests that boot the app.
 */
export const getAppViewModel = (options: AppViewModelCallerOptions): AppViewModelInterface => {
  setDialogCapabilities(dialogService);
  return createAppViewModel({
    ...options,
    auth: authService,
    app: appService,
    router: routerService,
    runtimeConfig: runtimeConfigService,
    emulatorSeed: emulatorSeedService,
    updater: updaterService,
  });
};
