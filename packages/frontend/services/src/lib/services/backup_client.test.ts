// packages/frontend/services/src/lib/services/backup_client.test.ts

import { afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('@aikami/utils', () => ({
  toAppError: (options: { errorMessage: string }): Error => new Error(options.errorMessage),
}));

const getCreateBackupClient = async () => (await import('./backup_client.ts')).createBackupClient;

const originalFetch = globalThis.fetch;
type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchOptions = Parameters<typeof globalThis.fetch>[1];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('BackupClient', () => {
  test('uploads an independent byte view without changing the payload', async () => {
    let requestBody: RequestInit['body'];
    globalThis.fetch = Object.assign(
      async (_input: FetchInput, options: FetchOptions): Promise<Response> => {
        requestBody = options?.body;
        return new Response(JSON.stringify({ backupId: 'backup-1', r2Key: 'saves/backup-1' }), {
          status: 201,
        });
      },
      { preconnect: originalFetch.preconnect },
    );

    const bytes = new Uint8Array([1, 2, 3]);
    const createBackupClient = await getCreateBackupClient();
    await createBackupClient('https://hub.example/api').createBackup('aikami.db', bytes);

    expect(requestBody).toBeInstanceOf(Uint8Array);
    if (!(requestBody instanceof Uint8Array)) {
      throw new Error('Expected a Uint8Array request body');
    }
    expect(Array.from(requestBody)).toEqual([1, 2, 3]);
  });

  test('disables the fetch cache when downloading a backup', async () => {
    let requestOptions: RequestInit | undefined;
    globalThis.fetch = Object.assign(
      async (_input: FetchInput, options: FetchOptions): Promise<Response> => {
        requestOptions = options;
        return new Response(new Uint8Array([4, 5, 6]));
      },
      { preconnect: originalFetch.preconnect },
    );

    const createBackupClient = await getCreateBackupClient();
    const bytes = await createBackupClient('https://hub.example/api').getBackup('backup/1');

    expect(requestOptions?.cache).toBe('no-store');
    expect(bytes).toEqual(new Uint8Array([4, 5, 6]));
  });
});
