// apps/frontend/client/src/lib/services/export/export_service.test.ts
//
// Regression coverage for account-scoped bulk backups.

import { expect, mock, test } from 'bun:test';

const mockAuthService: { uid: string | undefined } = { uid: 'previous-account' };
const mockListChats = mock(async (_uid: string) => []);

mock.module('../auth/auth_service.svelte.ts', () => ({
  authService: mockAuthService,
}));

mock.module('../chat/chat_storage.svelte.ts', () => ({
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
