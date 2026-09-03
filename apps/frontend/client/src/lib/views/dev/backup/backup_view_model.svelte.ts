// apps/frontend/client/src/lib/views/dev/backup/backup_view_model.svelte.ts
//
// C-462: Dev sandbox ViewModel for testing the R2 save backup/restore
// pipeline. Gates behind auth; surfaces backup, list, restore, and delete
// operations via BackupService.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { BackupEntry } from '@aikami/frontend/services';
import { getLocalDatabase } from '@aikami/frontend/storage';
import { authService, backupService, setBackupDatabase } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackupViewModelInterface = BaseViewModelInterface & {
  /** Whether the user is signed in. */
  readonly isLoggedIn: boolean;

  /** The signed-in user's UID (or undefined). */
  readonly uid: string | undefined;

  /** Whether a backup/restore/delete operation is in progress. */
  readonly isBusy: boolean;

  /** Whether the backup list is currently loading. */
  readonly isLoading: boolean;

  /** The list of existing backups. */
  readonly backups: BackupEntry[];

  /** Feedback message (success or error). */
  readonly message: string | undefined;

  /** Whether the message is an error (for styling). */
  readonly isError: boolean;

  /** Triggers a new backup of the local database. */
  backupNow(): Promise<void>;

  /** Refreshes the backup list. */
  refresh(): Promise<void>;

  /** Restores a specific backup into the local database. */
  restore(backupId: string): Promise<void>;

  /** Deletes a specific backup. */
  deleteBackup(backupId: string): Promise<void>;
};

export type BackupViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// BackupViewModel
// ---------------------------------------------------------------------------

class BackupViewModel
  extends BaseViewModel<BackupViewModelOptions>
  implements BackupViewModelInterface
{
  isBusy = $state(false);
  isLoading = $state(false);
  backups: BackupEntry[] = $state([]);
  message = $state<string | undefined>(undefined);
  isError = $state(false);

  get isLoggedIn(): boolean {
    return authService.isLoggedIn;
  }

  get uid(): string | undefined {
    return authService.uid;
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    await authService.initialize();

    // Ensure the backup service has the local database adapter.
    const db = await getLocalDatabase();
    setBackupDatabase(db);

    if (this.isLoggedIn) {
      await this.refresh();
    }
    await super.initialize();
  }

  /** @inheritdoc */
  async backupNow(): Promise<void> {
    if (!this.isLoggedIn) {
      this._setMessage('Not signed in — backup requires authentication.', true);
      return;
    }

    this.isBusy = true;
    this.message = undefined;

    try {
      const result = await backupService.backupNow();
      if (result) {
        this._setMessage(`Backup created: ${result.backupId}`, false);
      } else {
        this._setMessage('Backup failed — see console for details.', true);
      }
      await this.refresh();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this._setMessage(`Backup failed: ${msg}`, true);
      this.debug('backupNow:error', { error: msg });
    } finally {
      this.isBusy = false;
    }
  }

  /** @inheritdoc */
  async refresh(): Promise<void> {
    if (!this.isLoggedIn) {
      this.backups = [];
      return;
    }

    this.isLoading = true;

    try {
      this.backups = await backupService.listBackups();
    } catch (error) {
      this.debug('refresh:error', { error: String(error) });
      this.backups = [];
    } finally {
      this.isLoading = false;
    }
  }

  /** @inheritdoc */
  async restore(backupId: string): Promise<void> {
    if (!this.isLoggedIn) {
      this._setMessage('Not signed in.', true);
      return;
    }

    this.isBusy = true;
    this.message = undefined;

    try {
      await backupService.restore(backupId);
      this._setMessage(`Restored backup ${backupId}.`, false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this._setMessage(`Restore failed: ${msg}`, true);
      this.debug('restore:error', { backupId, error: msg });
    } finally {
      this.isBusy = false;
    }
  }

  /** @inheritdoc */
  async deleteBackup(backupId: string): Promise<void> {
    if (!this.isLoggedIn) {
      this._setMessage('Not signed in.', true);
      return;
    }

    this.isBusy = true;
    this.message = undefined;

    try {
      await backupService.deleteBackup(backupId);
      this._setMessage(`Deleted backup ${backupId}.`, false);
      await this.refresh();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this._setMessage(`Delete failed: ${msg}`, true);
      this.debug('deleteBackup:error', { backupId, error: msg });
    } finally {
      this.isBusy = false;
    }
  }

  // -------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------

  private _setMessage(text: string, isError: boolean): void {
    this.message = text;
    this.isError = isError;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getBackupViewModel = (
  options: BackupViewModelOptions,
): BackupViewModelInterface => BackupViewModel.create(options);
