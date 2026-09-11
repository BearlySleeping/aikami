// apps/frontend/client/src/lib/views/dev/save_load/save_load_composition.ts
//
// Production wiring for the dev cloud save/load sandbox. This is the only
// module in the feature that imports the `$services` barrel; the ViewModel
// receives its dependencies as typed capabilities, so unit tests never touch
// the global service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { authService, gameStateSyncService } from '$services';
import {
  createSaveLoadViewModel,
  type SaveLoadViewModelInterface,
} from './save_load_view_model.svelte';

/**
 * Builds the save/load ViewModel wired to the production auth and cloud-sync
 * singletons.
 */
export const getSaveLoadViewModel = (options: BaseViewModelOptions): SaveLoadViewModelInterface =>
  createSaveLoadViewModel({
    ...options,
    auth: authService,
    sync: gameStateSyncService,
  });
