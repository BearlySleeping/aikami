// apps/frontend/client/src/lib/views/settings/account/account_composition.ts
//
// Production wiring for the account settings feature. This is the only module
// in the feature that imports the `$services` barrel; the ViewModel receives
// its dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { authService, backupService } from '$services';
import {
  type AccountViewModelInterface,
  createAccountViewModel,
} from './account_view_model.svelte';

/**
 * Builds the account ViewModel wired to the production identity and backup
 * singletons.
 */
export const getAccountViewModel = (options: BaseViewModelOptions): AccountViewModelInterface =>
  createAccountViewModel({
    ...options,
    account: authService,
    backups: backupService,
  });
