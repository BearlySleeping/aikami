// apps/frontend/client/src/lib/views/dev/backup/backup_composition.ts
//
// Production wiring for the dev R2 backup/restore sandbox. This is the only
// module in the feature that imports the `$services` barrel; the ViewModel
// receives its dependencies as typed capabilities, so unit tests never touch
// the global service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { getLocalDatabase } from '@aikami/frontend/storage';
import { authService, backupService } from '$services';
import { type BackupViewModelInterface, createBackupViewModel } from './backup_view_model.svelte';

/**
 * Builds the backup ViewModel wired to the production auth and backup
 * singletons.
 */
export const getBackupViewModel = (options: BaseViewModelOptions): BackupViewModelInterface =>
  createBackupViewModel({
    ...options,
    auth: authService,
    backup: backupService,
    database: { getLocalDatabase },
  });
