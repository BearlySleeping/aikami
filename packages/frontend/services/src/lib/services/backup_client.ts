// packages/frontend/services/src/lib/services/backup_client.ts
//
// C-462: Client-side backup client for the hub's R2 save backup endpoints.
// Mirrors the r2_storage.ts pattern: a factory taking the hub base URL,
// returning fetch wrappers with credentials: 'include' and consistent
// error handling (toAppErrorFromResponse).
//
// Operations: createBackup (POST /saves/backup), listBackups (GET /saves),
// getBackup (GET /saves/:id), deleteBackup (DELETE /saves/:id).

import { toAppError } from '@aikami/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A backup metadata entry as returned by the hub's list endpoint. */
export type BackupEntry = {
  id: string;
  r2Key: string;
  sizeBytes: number;
  createdAt: string;
};

/** Result of a create-backup call. */
export type CreateBackupResult = {
  backupId: string;
  r2Key: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toAppErrorFromResponse = async (response: Response): Promise<Error> => {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  return toAppError({
    errorType: 'internal',
    errorMessage: body.message ?? body.error ?? `Backup request failed (HTTP ${response.status})`,
  });
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type BackupClientInterface = {
  /**
   * Uploads the local database bytes as a new backup.
   * @param filename A descriptive filename for the backup (e.g. 'aikami.db').
   * @param bytes The raw database file bytes.
   * @returns The backup id and R2 key.
   */
  createBackup(filename: string, bytes: Uint8Array): Promise<CreateBackupResult>;

  /**
   * Lists the signed-in user's existing backups.
   * @returns Array of backup metadata entries.
   */
  listBackups(): Promise<BackupEntry[]>;

  /**
   * Downloads the bytes for a specific backup.
   * @param backupId The backup id.
   * @returns The raw database file bytes.
   */
  getBackup(backupId: string): Promise<Uint8Array>;

  /**
   * Deletes a specific backup (R2 object + D1 row).
   * @param backupId The backup id to delete.
   */
  deleteBackup(backupId: string): Promise<void>;
};

/**
 * Backup client backed by the hub's session-gated save backup endpoints.
 *
 * @param hubBase The hub base URL (same-origin `/api/hub` in emulator/testing,
 *                or the deployed hub origin in staging/production).
 */
export const createBackupClient = (hubBase: string): BackupClientInterface => {
  const createBackup = async (filename: string, bytes: Uint8Array): Promise<CreateBackupResult> => {
    const response = await fetch(
      `${hubBase}/saves/backup?filename=${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        credentials: 'include',
        body: new Uint8Array(bytes),
      },
    );
    if (!response.ok) {
      throw await toAppErrorFromResponse(response);
    }
    return (await response.json()) as CreateBackupResult;
  };

  const listBackups = async (): Promise<BackupEntry[]> => {
    const response = await fetch(`${hubBase}/saves`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) {
      throw await toAppErrorFromResponse(response);
    }
    return (await response.json()) as BackupEntry[];
  };

  const getBackup = async (backupId: string): Promise<Uint8Array> => {
    const response = await fetch(`${hubBase}/saves/${encodeURIComponent(backupId)}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw await toAppErrorFromResponse(response);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  };

  const deleteBackup = async (backupId: string): Promise<void> => {
    const response = await fetch(`${hubBase}/saves/${encodeURIComponent(backupId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      throw await toAppErrorFromResponse(response);
    }
  };

  return { createBackup, listBackups, getBackup, deleteBackup };
};
