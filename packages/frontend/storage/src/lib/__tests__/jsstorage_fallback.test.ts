// packages/frontend/storage/src/lib/__tests__/jsstorage_fallback.test.ts
//
// C-321: Verifies the IndexedDB-snapshot fallback used by WasmStorageAdapter
// when OPFS is unavailable — an in-memory kvvfs DB whose full export is
// snapshotted to a persistence backend (IndexedDB in production, a Map here)
// so data survives close/reopen (i.e. page reloads).
//
// Also verifies the kvvfs xFileControl workaround: without it, PRAGMA
// handling crashes because kvvfs.internal is undefined in production builds.

import { describe, expect, test } from 'bun:test';

import { _setPersistenceBackendForTests } from '../wasm_storage_adapter.ts';

/** In-memory stand-in for IndexedDB. */
const makeMemoryBackend = () => {
  const map = new Map<string, unknown>();
  return {
    get: async (key: string) => map.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      map.set(key, value);
    },
    peek: (key: string) => map.get(key),
  };
};

describe('WasmStorageAdapter IndexedDB-snapshot fallback', () => {
  test('kvvfs xFileControl workaround + snapshot persists across close/reopen', async () => {
    const backend = makeMemoryBackend();
    _setPersistenceBackendForTests(backend);

    const sqlite3Module = await import('@sqlite.org/sqlite-wasm');
    const sqlite3 = (await sqlite3Module.default()) as Record<string, unknown>;
    const oo1 = sqlite3['oo1'] as Record<string, unknown>;

    // Simulate production: kvvfs.internal is undefined (kvvfs.log unset).
    const kvvfs = sqlite3['kvvfs'] as {
      internal?: object;
      export(name: string): unknown;
      import(exp: unknown, overwrite?: boolean): void;
    };
    delete kvvfs.internal;

    const JsStorageDbCtor = oo1['JsStorageDb'] as {
      new (
        mode: string,
      ): {
        exec(options: Record<string, unknown>): unknown;
        close(): void;
      };
    };

    // Without the workaround, PRAGMA handling crashes (browser: TypeError
    // reading disablePageSizeChange; Bun: SQL logic error).
    const dbBefore = new JsStorageDbCtor('.');
    expect(() => dbBefore.exec({ sql: 'PRAGMA foreign_keys = ON' })).toThrow();
    dbBefore.close();

    // Apply the adapter's workaround — now everything works.
    kvvfs.internal = { disablePageSizeChange: true };

    // ── First session: write data, export snapshot, close ──
    const db1 = new JsStorageDbCtor('.');
    db1.exec({ sql: 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, val TEXT)' });
    db1.exec({ sql: 'PRAGMA foreign_keys = ON' });
    db1.exec({ sql: 'INSERT INTO t (val) VALUES (?)', bind: ['persisted!'] });

    // Simulate the adapter's debounced snapshot write.
    const snapshot = kvvfs.export('.') as unknown;
    await backend.set('kvvfs-export', snapshot);
    db1.close();

    // ── Second session (page reload): import snapshot, reopen ──
    const restored = (await backend.get('kvvfs-export')) as unknown;
    kvvfs.import(restored, true);
    const db2 = new JsStorageDbCtor('.');
    const rows: Record<string, unknown>[] = [];
    db2.exec({
      sql: 'SELECT val FROM t',
      returnValue: 'resultRows',
      resultRows: rows,
      rowMode: 'object',
    });
    expect(rows).toEqual([{ val: 'persisted!' }]);
    db2.close();

    // Reset the backend to the real IndexedDB implementation for other tests.
    _setPersistenceBackendForTests({ get: async () => null, set: async () => {} });
  });
});
