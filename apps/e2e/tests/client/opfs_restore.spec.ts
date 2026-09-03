// apps/e2e/tests/client/opfs_restore.spec.ts

import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

type OpfsWorkerMessage = {
  error?: string;
  result?: { persistMode: string; rows: Record<string, unknown>[] };
};

const STORAGE_MODULE_URL = `/@fs${
  new URL('../../../../packages/frontend/storage/src/lib/wasm_storage_adapter.ts', import.meta.url)
    .pathname
}`;

const OPFS_RESTORE_WORKER_SOURCE = `
self.onmessage = async (event) => {
  try {
    const { createWasmStorageAdapter } = await import(event.data);
    const sourcePath = '/aikami-opfs-restore-source.db';
    const restoredPath = '/aikami-opfs-restore-target.db';

    const source = await createWasmStorageAdapter({ databasePath: sourcePath });
    await source.execute({
      sql: 'CREATE TABLE IF NOT EXISTS restore_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
      args: [],
    });
    await source.execute({ sql: 'DELETE FROM restore_probe', args: [] });
    await source.execute({
      sql: 'INSERT INTO restore_probe (id, value) VALUES (?, ?)',
      args: ['restored-row', 'from-backup'],
    });
    const snapshot = await source.exportBytes();
    const persistMode = source['_persistMode'];
    await source.close();

    const target = await createWasmStorageAdapter({ databasePath: restoredPath });
    await target.execute({
      sql: 'CREATE TABLE IF NOT EXISTS restore_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
      args: [],
    });
    await target.execute({ sql: 'DELETE FROM restore_probe', args: [] });
    await target.execute({
      sql: 'INSERT INTO restore_probe (id, value) VALUES (?, ?)',
      args: ['stale-row', 'before-restore'],
    });
    await target.importBytes(snapshot);
    await target.close();

    const reopened = await createWasmStorageAdapter({ databasePath: restoredPath });
    const rows = await reopened.query({
      sql: 'SELECT id, value FROM restore_probe ORDER BY id',
      args: [],
    });
    await reopened.close();

    self.postMessage({ result: { persistMode, rows: rows.rows } });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
`;

test('an imported snapshot persists when the same OPFS path is reopened', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      },
    });
  });
  await page.goto('/dev');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  const result = await page.evaluate(
    ({ moduleUrl, workerSource }) =>
      new Promise<{ persistMode: string; rows: Record<string, unknown>[] }>((resolve, reject) => {
        const workerUrl = URL.createObjectURL(
          new Blob([workerSource], { type: 'text/javascript' }),
        );
        const worker = new Worker(workerUrl, { type: 'module' });
        worker.onmessage = (event: MessageEvent<OpfsWorkerMessage>) => {
          const data = event.data;
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          if (data.error || !data.result) {
            reject(new Error(data.error ?? 'OPFS restore worker returned no result'));
            return;
          }
          resolve(data.result);
        };
        worker.onerror = (event) => {
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          reject(new Error(event.message));
        };
        worker.postMessage(new URL(moduleUrl, location.href).href);
      }),
    { moduleUrl: STORAGE_MODULE_URL, workerSource: OPFS_RESTORE_WORKER_SOURCE },
  );

  expect(result.persistMode).toBe('opfs');
  expect(result.rows).toEqual([{ id: 'restored-row', value: 'from-backup' }]);
});
