// apps/frontend/client/src/lib/views/settings/export/export_view_model.test.ts
//
// Unit tests for the Export & Data settings ViewModel. Collaborators are
// injected capabilities, so no global `$services` mock is required.

import { describe, expect, mock, test } from 'bun:test';
import {
  createExportViewModel,
  type ExportPrivacyCapabilities,
  type ExportPrivacySettings,
  type ExportServiceCapabilities,
} from './export_view_model.svelte';

const createService = (
  overrides: Partial<ExportServiceCapabilities> = {},
): ExportServiceCapabilities => ({
  listChats: mock(async () => []),
  listCompletedSessions: mock(() => []),
  listExportableCharacters: mock(async () => []),
  exportChatAsJsonl: mock(async () => {}),
  exportChatAsPlainText: mock(async () => {}),
  exportCharacterAsJson: mock(async () => {}),
  exportCharacterAsPng: mock(async () => {}),
  exportSessionAsEpub: mock(async () => {}),
  exportBulkBackup: mock(async () => {}),
  downloadDeviceBackup: mock(async () => {}),
  restoreDeviceBackup: mock(async () => {}),
  deleteAllLocalData: mock(async () => {}),
  ...overrides,
});

const createPrivacy = (
  overrides: Partial<ExportPrivacyCapabilities> = {},
): ExportPrivacyCapabilities => ({
  read: () => ({ offlineMode: false, telemetryOptOut: false }),
  write: mock((_settings: ExportPrivacySettings) => {}),
  ...overrides,
});

const createViewModel = (options?: {
  service?: ExportServiceCapabilities;
  privacy?: ExportPrivacyCapabilities;
}) =>
  createExportViewModel({
    className: 'ExportViewModelTest',
    service: options?.service ?? createService(),
    privacy: options?.privacy ?? createPrivacy(),
  });

describe('ExportViewModel — data loading', () => {
  test('initialize loads chats, characters and sessions', async () => {
    const listChats = mock(async () => []);
    const listExportableCharacters = mock(async () => []);
    const listCompletedSessions = mock(() => []);
    const vm = createViewModel({
      service: createService({ listChats, listExportableCharacters, listCompletedSessions }),
    });

    await vm.initialize();

    expect(listChats).toHaveBeenCalledTimes(1);
    expect(listExportableCharacters).toHaveBeenCalledTimes(1);
    expect(listCompletedSessions).toHaveBeenCalledTimes(1);
    expect(vm.isLoading).toBe(false);
  });

  test('initialize restores persisted privacy settings', async () => {
    const vm = createViewModel({
      privacy: createPrivacy({
        read: () => ({ offlineMode: true, telemetryOptOut: true }),
      }),
    });

    await vm.initialize();

    expect(vm.offlineMode).toBe(true);
    expect(vm.telemetryOptOut).toBe(true);
  });
});

describe('ExportViewModel — privacy toggles', () => {
  test('toggleOfflineMode flips state and persists via the privacy capability', () => {
    const write = mock((_settings: ExportPrivacySettings) => {});
    const vm = createViewModel({ privacy: createPrivacy({ write }) });

    vm.toggleOfflineMode();

    expect(vm.offlineMode).toBe(true);
    expect(write).toHaveBeenCalledWith({ offlineMode: true, telemetryOptOut: false });
  });
});

describe('ExportViewModel — delete local data', () => {
  test('confirm requires DELETE text', async () => {
    const deleteAllLocalData = mock(async () => {});
    const vm = createViewModel({ service: createService({ deleteAllLocalData }) });

    vm.openDeleteLocalDialog();
    vm.updateDeleteLocalConfirmText('wrong');
    await vm.confirmDeleteLocalData();

    expect(deleteAllLocalData).not.toHaveBeenCalled();
  });
});

describe('ExportViewModel — device backup', () => {
  test('downloadDeviceBackup calls the service', async () => {
    const downloadDeviceBackup = mock(async () => {});
    const vm = createViewModel({ service: createService({ downloadDeviceBackup }) });

    await vm.downloadDeviceBackup();

    expect(downloadDeviceBackup).toHaveBeenCalledTimes(1);
    expect(vm.isBackupBusy).toBe(false);
  });

  test('selectRestoreFile opens the dialog with the chosen filename', () => {
    const vm = createViewModel();
    const file = new File(['x'], 'backup.db', { type: 'application/octet-stream' });
    const input = { files: [file], value: 'chosen' } as unknown as HTMLInputElement;

    vm.selectRestoreFile({ event: { target: input } as unknown as Event });

    expect(vm.isRestoreDialogOpen).toBe(true);
    expect(vm.pendingRestoreName).toBe('backup.db');
    expect(input.value).toBe('');
  });

  test('confirmRestoreBackup restores the selected file and closes the dialog', async () => {
    const restoreDeviceBackup = mock(async () => {});
    const vm = createViewModel({ service: createService({ restoreDeviceBackup }) });
    const file = new File(['x'], 'backup.db', { type: 'application/octet-stream' });

    vm.selectRestoreFile({
      event: { target: { files: [file], value: '' } } as unknown as Event,
    });
    await vm.confirmRestoreBackup();

    expect(restoreDeviceBackup).toHaveBeenCalledTimes(1);
    expect(restoreDeviceBackup).toHaveBeenCalledWith({ file });
    expect(vm.isRestoreDialogOpen).toBe(false);
    expect(vm.pendingRestoreName).toBeUndefined();
  });
});
