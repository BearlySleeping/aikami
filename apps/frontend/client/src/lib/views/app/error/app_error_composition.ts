// apps/frontend/client/src/lib/views/app/error/app_error_composition.ts
//
// Production wiring for the app-error feature. This is the only module in the
// feature that imports the `$services` singleton; the ViewModel receives it as
// a typed capability.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { routerService } from '$services';
import {
  type AppErrorViewModelInterface,
  createAppErrorViewModel,
} from './app_error_view_model.svelte';

/**
 * Builds the app-error ViewModel wired to the production router singleton.
 */
export const getAppErrorViewModel = (options: BaseViewModelOptions): AppErrorViewModelInterface =>
  createAppErrorViewModel({
    ...options,
    router: routerService,
  });
