// apps/frontend/client/src/lib/test_setup.test.ts

import { expect, mock, test } from 'bun:test';

test('IndexedDB polyfill upgrades an existing database to a higher version', async () => {
  const databaseName = `test-setup-upgrade-${crypto.randomUUID()}`;
  const firstRequest = indexedDB.open(databaseName, 1);
  const firstUpgrade = mock(() => {
    firstRequest.result.createObjectStore('records');
  });
  firstRequest.onupgradeneeded = firstUpgrade;

  try {
    await new Promise<void>((resolve, reject) => {
      firstRequest.onsuccess = () => resolve();
      firstRequest.onerror = () => reject(firstRequest.error);
    });

    const secondRequest = indexedDB.open(databaseName, 2);
    const secondUpgrade = mock(() => {});
    secondRequest.onupgradeneeded = secondUpgrade;
    await new Promise<void>((resolve, reject) => {
      secondRequest.onsuccess = () => resolve();
      secondRequest.onerror = () => reject(secondRequest.error);
    });

    expect(firstUpgrade).toHaveBeenCalledTimes(1);
    expect(secondUpgrade).toHaveBeenCalledTimes(1);
  } finally {
    indexedDB.deleteDatabase(databaseName);
  }
});
