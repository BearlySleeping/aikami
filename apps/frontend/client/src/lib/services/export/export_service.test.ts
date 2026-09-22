// apps/frontend/client/src/lib/services/export/export_service.test.ts
//
// Regression coverage for account-scoped bulk backups.

import { expect, mock, test } from 'bun:test';

const mockAuthService: { uid: string | undefined } = { uid: 'previous-account' };
const mockListChats = mock(async (_uid: string) => []);

const executedSql: string[] = [];
const mockFlush = mock(async () => {});
const mockDb = {
  transaction: mock(async (queries: readonly { sql: string }[]) => {
    executedSql.push(...queries.map((query) => query.sql));
  }),
  flush: mockFlush,
};

mock.module('../auth/auth_service.svelte.ts', () => ({
  authService: mockAuthService,
}));

mock.module('../chat/chat_storage.svelte.ts', () => ({
  chatStorage: { listChats: mockListChats },
}));

// Keep the real storage module's exports intact — the export service pulls in
// modules that import other values (e.g. findArtifactReferences) from it — and
// override only the connection factory.
const actualStorage = await import('@aikami/frontend/storage');
mock.module('@aikami/frontend/storage', () => ({
  ...actualStorage,
  getLocalDatabase: async () => mockDb,
}));

const { exportService } = await import('./export_service.svelte.ts');

test('sign-out blocks bulk backup before prior-account chats are read', async () => {
  mockAuthService.uid = undefined;

  await expect(exportService.exportBulkBackup()).rejects.toThrow(
    'Sign in before exporting a backup.',
  );
  expect(mockListChats).not.toHaveBeenCalled();
});

test('deleteAllLocalData clears every table and flushes before resolving', async () => {
  executedSql.length = 0;
  mockFlush.mockClear();

  await exportService.deleteAllLocalData();

  // The reported regression: campaigns survived a delete + immediate reload
  // because the debounced IndexedDB snapshot was never flushed.
  expect(executedSql).toContain('DELETE FROM campaigns');
  expect(executedSql).toContain('DELETE FROM game_operations');
  expect(executedSql).toContain('DELETE FROM generation_candidates');
  expect(mockFlush).toHaveBeenCalledTimes(1);

  // The flush must be awaited strictly after the deletes commit, or the
  // reload races the snapshot write.
  expect(mockDb.transaction.mock.invocationCallOrder[0]).toBeLessThan(
    mockFlush.mock.invocationCallOrder[0],
  );
});
