// apps/frontend/client/src/lib/services/backup/device_backup.ts
//
// The canonical device-backup artifact: the whole local database as raw
// bytes. Both the local file download/restore (Export & Data) and the R2
// cloud upload/restore (BackupService) produce and consume this same
// artifact, so there is exactly one definition of "a device backup".

import type { LocalDatabaseInterface } from '@aikami/frontend/storage';

/** A produced device backup: the DB bytes plus a descriptive filename. */
type DeviceBackupArtifact = {
  bytes: Uint8Array;
  filename: string;
  byteLength: number;
};

/** Timestamped backup filename, e.g. `aikami-backup-2026-09-11.db`. */
const deviceBackupFilename = (now: Date = new Date()): string =>
  `aikami-backup-${now.toISOString().slice(0, 10)}.db`;

/**
 * Exports the local database as a device-backup artifact.
 * @returns The artifact, or undefined when the database is empty.
 */
export const createDeviceBackupArtifact = async (
  database: LocalDatabaseInterface,
): Promise<DeviceBackupArtifact | undefined> => {
  const bytes = await database.exportBytes();
  if (bytes.byteLength === 0) {
    return undefined;
  }
  return { bytes, filename: deviceBackupFilename(), byteLength: bytes.byteLength };
};

/**
 * Replaces the local database contents with a device-backup artifact.
 * @throws When the supplied bytes are empty.
 */
export const restoreDeviceBackupArtifact = async (
  database: LocalDatabaseInterface,
  bytes: Uint8Array,
): Promise<void> => {
  if (bytes.byteLength === 0) {
    throw new Error('Backup file is empty');
  }
  await database.importBytes(bytes);
};
