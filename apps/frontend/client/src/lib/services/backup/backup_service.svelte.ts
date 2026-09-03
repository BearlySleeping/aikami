// apps/frontend/client/src/lib/services/backup/backup_service.svelte.ts
//
// C-462: Client-side backup service for R2 save backup & restore.
// Wraps the hub's backup endpoints (via BackupClientInterface) behind
// BaseFrontendClass, following the same pattern as StorageService.
//
// Operations:
//   backupNow()   — export local DB bytes → upload to R2
//   listBackups() — list existing backups for the signed-in user
//   restore(id)   — download backup bytes → import into local DB
//   deleteBackup(id) — delete a backup from R2 + D1

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  createBackupClient,
  type BackupClientInterface,
  type BackupEntry,
  type CreateBackupResult,
} from '@aikami/frontend/services';
import type { LocalDatabaseInterface } from '@aikami/frontend/storage';
import { hubApiBase } from '../api/hub_api_client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackupServiceOptions = BaseFrontendClassOptions & {
  backupClient: BackupClientInterface;
  database: LocalDatabaseInterface;
};

export type BackupServiceInterface = BaseFrontendClassInterface & {
  /**
   * Exports the local database bytes and uploads them as a new backup.
   * @returns The backup id and R2 key, or undefined on failure.
   */
  backupNow(): Promise<CreateBackupResult | undefined>;

  /**
   * Lists the signed-in user's existing backups.
   * @returns Array of backup metadata entries.
   */
  listBackups(): Promise<BackupEntry[]>;

  /**
   * Downloads a backup's bytes and restores them into the local database.
   * @param backupId The backup id to restore from.
   */
  restore(backupId: string): Promise<void>;

  /**
   * Deletes a backup (R2 object + D1 metadata row).
   * @param backupId The backup id to delete.
   */
  deleteBackup(backupId: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// BackupService
// ---------------------------------------------------------------------------

class BackupService
  extends BaseFrontendClass<BackupServiceOptions>
  implements BackupServiceInterface
{
  private get _backupClient(): BackupClientInterface {
    return this._options.backupClient;
  }

  private get _database(): LocalDatabaseInterface {
    return this._options.database;
  }

  async backupNow(): Promise<CreateBackupResult | undefined> {
    try {
      const bytes = await this._database.exportBytes();
      this.log('backupNow', { byteLength: bytes.byteLength });

      if (bytes.byteLength === 0) {
        this.error('backupNow:empty-database');
        return;
      }

      const result = await this._backupClient.createBackup('aikami.db', bytes);
      this.log('backupNow:complete', { backupId: result.backupId });
      return result;
    } catch (error) {
      this.error('backupNow:failed', error);
      return;
    }
  }

  async listBackups(): Promise<BackupEntry[]> {
    try {
      const entries = await this._backupClient.listBackups();
      return entries;
    } catch (error) {
      this.error('listBackups:failed', error);
      return [];
    }
  }

  async restore(backupId: string): Promise<void> {
    try {
      this.log('restore', { backupId });

      const bytes = await this._backupClient.getBackup(backupId);
      if (bytes.byteLength === 0) {
        throw new Error('Downloaded backup is empty');
      }

      await this._database.importBytes(bytes);
      this.log('restore:complete', { backupId, byteLength: bytes.byteLength });
    } catch (error) {
      this.error('restore:failed', { backupId, error });
      throw error;
    }
  }

  async deleteBackup(backupId: string): Promise<void> {
    try {
      this.log('deleteBackup', { backupId });
      await this._backupClient.deleteBackup(backupId);
      this.log('deleteBackup:complete', { backupId });
    } catch (error) {
      this.error('deleteBackup:failed', { backupId, error });
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const backupService: BackupServiceInterface = BackupService.create({
  backupClient: createBackupClient(hubApiBase()),
  database: undefined as unknown as LocalDatabaseInterface, // set lazily via setDatabase
  className: 'BackupService',
});

/**
 * Sets the local database adapter on the backup service singleton.
 * Must be called before any backup/restore operation.
 */
export const setBackupDatabase = (database: LocalDatabaseInterface): void => {
  (backupService as unknown as { _options: BackupServiceOptions })._options.database = database;
};
