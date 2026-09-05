// apps/frontend/client/src/lib/services/export/export_service.test.ts
//
// Regression coverage for account-scoped bulk backups.

import { expect, mock, test } from 'bun:test';
import { localServicesMockBase } from '../../test_preload.ts';

const mockAuthService: { uid: string | undefined } = { uid: 'previous-account' };
const mockListChats = mock(async (_uid: string) => []);

mock.module('$services', () => ({
  ...localServicesMockBase(),
  authService: mockAuthService,
  chatStorage: { listChats: mockListChats },
}));

const { exportService } = await import('./export_service.svelte.ts');

test('sign-out blocks bulk backup before prior-account chats are read', async () => {
  mockAuthService.uid = undefined;

  await expect(exportService.exportBulkBackup()).rejects.toThrow(
    'Sign in before exporting a backup.',
  );
  expect(mockListChats).not.toHaveBeenCalled();
});
