// apps/frontend/client/src/lib/services/backup/device_backup.test.ts
//
// Unit tests for the shared device-backup artifact producer/restorer.

import { describe, expect, test } from 'bun:test';
import type { LocalDatabaseInterface } from '@aikami/frontend/storage';
import { createDeviceBackupArtifact, restoreDeviceBackupArtifact } from './device_backup.ts';

const fakeDatabase = (overrides: Partial<LocalDatabaseInterface> = {}): LocalDatabaseInterface =>
  ({
    exportBytes: async () => new Uint8Array([1, 2, 3]),
    importBytes: async () => {},
    ...overrides,
  }) as unknown as LocalDatabaseInterface;

describe('createDeviceBackupArtifact', () => {
  test('returns the bytes, filename and byte length', async () => {
    const artifact = await createDeviceBackupArtifact(fakeDatabase());

    expect(artifact?.byteLength).toBe(3);
    expect(artifact?.filename).toMatch(/^aikami-backup-\d{4}-\d{2}-\d{2}\.db$/);
    expect(artifact?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  test('returns undefined for an empty database', async () => {
    const artifact = await createDeviceBackupArtifact(
      fakeDatabase({ exportBytes: async () => new Uint8Array() }),
    );

    expect(artifact).toBeUndefined();
  });
});

describe('restoreDeviceBackupArtifact', () => {
  test('imports non-empty bytes into the database', async () => {
    let imported: Uint8Array | undefined;
    await restoreDeviceBackupArtifact(
      fakeDatabase({
        importBytes: async (bytes: Uint8Array) => {
          imported = bytes;
        },
      }),
      new Uint8Array([9, 9]),
    );

    expect(imported).toEqual(new Uint8Array([9, 9]));
  });

  test('rejects empty bytes', async () => {
    await expect(restoreDeviceBackupArtifact(fakeDatabase(), new Uint8Array())).rejects.toThrow(
      'Backup file is empty',
    );
  });
});
