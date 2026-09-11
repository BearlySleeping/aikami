// apps/frontend/client/src/lib/views/dev/backup/backup_view_model.test.ts
//
// BackupViewModel — auth gating, backup/list/restore/delete delegation through
// explicit capability fixtures.
//
// Contract: C-462 R2 save backup/restore pipeline

import { describe, expect, mock, test } from 'bun:test';
import type { BackupEntry } from '@aikami/frontend/services';
import type { LocalDatabaseInterface } from '@aikami/frontend/storage';
import {
  type BackupAuthCapabilities,
  type BackupDatabaseCapabilities,
  type BackupServiceCapabilities,
  createBackupViewModel,
} from './backup_view_model.svelte.ts';

const BACKUP: BackupEntry = {
  id: 'backup-1',
  r2Key: 'saves/test-uid/backup-1.db',
  sizeBytes: 1024,
  createdAt: '2026-09-11T00:00:00.000Z',
};

const createHarness = (signedIn: boolean) => {
  const db = {} as LocalDatabaseInterface;

  const auth = {
    get isLoggedIn() {
      return signedIn;
    },
    uid: signedIn ? 'test-uid' : undefined,
    initialize: mock(async () => undefined),
  } satisfies BackupAuthCapabilities;

  const setup = mock((_database: LocalDatabaseInterface) => {});
  const backupNow = mock(async () => ({ backupId: 'backup-1', r2Key: BACKUP.r2Key }));
  const listBackups = mock(async () => [BACKUP]);
  const restore = mock(async (_backupId: string) => {});
  const deleteBackup = mock(async (_backupId: string) => {});
  const backup = {
    setup,
    backupNow,
    listBackups,
    restore,
    deleteBackup,
  } satisfies BackupServiceCapabilities;

  const database = { getLocalDatabase: mock(async () => db) } satisfies BackupDatabaseCapabilities;

  const viewModel = createBackupViewModel({
    className: 'BackupViewModel',
    auth,
    backup,
    database,
  });

  return { viewModel, setup, backupNow, listBackups, restore, deleteBackup, db };
};

describe('BackupViewModel — auth gating', () => {
  test('isLoggedIn and uid proxy the auth capability', () => {
    const { viewModel } = createHarness(true);
    expect(viewModel.isLoggedIn).toBe(true);
    expect(viewModel.uid).toBe('test-uid');
  });

  test('initialize wires the database and refreshes when signed in', async () => {
    const { viewModel, setup, listBackups, db } = createHarness(true);
    await viewModel.initialize();

    expect(setup).toHaveBeenCalledWith(db);
    expect(listBackups).toHaveBeenCalledTimes(1);
    expect(viewModel.backups).toEqual([BACKUP]);
  });

  test('does not list backups when signed out', async () => {
    const { viewModel, listBackups } = createHarness(false);
    await viewModel.initialize();
    expect(listBackups).not.toHaveBeenCalled();
  });

  test('backupNow refuses when signed out', async () => {
    const { viewModel, backupNow } = createHarness(false);
    await viewModel.backupNow();
    expect(backupNow).not.toHaveBeenCalled();
    expect(viewModel.message).toContain('Not signed in');
    expect(viewModel.isError).toBe(true);
  });
});

describe('BackupViewModel — operations', () => {
  test('backupNow delegates and refreshes', async () => {
    const { viewModel, backupNow, listBackups } = createHarness(true);
    await viewModel.backupNow();

    expect(backupNow).toHaveBeenCalledTimes(1);
    expect(listBackups).toHaveBeenCalledTimes(1);
    expect(viewModel.isBusy).toBe(false);
  });

  test('restore delegates to the backup capability', async () => {
    const { viewModel, restore } = createHarness(true);
    await viewModel.restore('backup-1');
    expect(restore).toHaveBeenCalledWith('backup-1');
  });

  test('deleteBackup delegates to the backup capability', async () => {
    const { viewModel, deleteBackup } = createHarness(true);
    await viewModel.deleteBackup('backup-1');
    expect(deleteBackup).toHaveBeenCalledWith('backup-1');
  });
});
