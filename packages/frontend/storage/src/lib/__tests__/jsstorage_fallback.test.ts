// packages/frontend/storage/src/lib/__tests__/jsstorage_fallback.test.ts
//
// C-321: Verifies the localStorage-backed kvvfs (JsStorageDb) fallback used
// by WasmStorageAdapter when OPFS is unavailable — data must survive
// close/reopen (i.e. page reloads), and the kvvfs xFileControl workaround
// must prevent the production crash where kvvfs.internal is undefined.

import { describe, expect, test } from 'bun:test';

// Minimal Storage-like mock so `globalThis.localStorage instanceof
// globalThis.Storage` passes inside sqlite-wasm's storage-pool init.
class MockStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

/** Mirrors the workaround in WasmStorageAdapter.open(). */
const applyKvvfsWorkaround = (sqlite3: Record<string, unknown>): void => {
  const kvvfs = sqlite3['kvvfs'] as { internal?: object } | undefined;
  if (kvvfs && !kvvfs.internal) {
    kvvfs.internal = { disablePageSizeChange: true };
  }
};

describe('JsStorageDb localStorage fallback (WasmStorageAdapter)', () => {
  test('survives the production kvvfs xFileControl bug + persists across close/reopen', async () => {
    const mockStorage = new MockStorage();
    (globalThis as Record<string, unknown>).Storage = MockStorage;
    (globalThis as Record<string, unknown>).localStorage = mockStorage;
    (globalThis as Record<string, unknown>).sessionStorage = mockStorage;

    const sqlite3Module = await import('@sqlite.org/sqlite-wasm');
    const sqlite3 = (await sqlite3Module.default()) as Record<string, unknown>;
    const oo1 = sqlite3['oo1'] as Record<string, unknown>;

    // Simulate production: kvvfs.log is not set, so kvvfs.internal is
    // undefined — this is what crashed xFileControl in the browser.
    const kvvfs = sqlite3['kvvfs'] as { internal?: object };
    delete kvvfs.internal;

    // Without the workaround, any prepare crashes:
    const JsStorageDbCtor = oo1['JsStorageDb'] as {
      new (
        mode: 'local' | 'session',
      ): {
        exec(options: Record<string, unknown>): unknown;
        close(): void;
      };
    };
    const dbBefore = new JsStorageDbCtor('local');
    // PRAGMA statements trigger SQLITE_FCNTL_PRAGMA → xFileControl, which
    // reads kvvfs.internal.disablePageSizeChange → TypeError in production.
    // (Browser: TypeError reading disablePageSizeChange; Bun: SQL logic
    // error — both are failures caused by the missing internal object.)
    expect(() => dbBefore.exec({ sql: 'PRAGMA foreign_keys = ON' })).toThrow();
    dbBefore.close();

    // Apply the adapter's workaround — now everything works.
    applyKvvfsWorkaround(sqlite3);

    const db1 = new JsStorageDbCtor('local');
    db1.exec({ sql: 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, val TEXT)' });
    db1.exec({ sql: 'PRAGMA foreign_keys = ON' });
    db1.exec({ sql: 'INSERT INTO t (val) VALUES (?)', bind: ['persisted!'] });
    db1.close();

    // Reopen a NEW instance — data must still be there (persisted via kvvfs)
    const db2 = new JsStorageDbCtor('local');
    const rows: Record<string, unknown>[] = [];
    db2.exec({
      sql: 'SELECT val FROM t',
      returnValue: 'resultRows',
      resultRows: rows,
      rowMode: 'object',
    });
    expect(rows).toEqual([{ val: 'persisted!' }]);
    db2.close();

    // Cleanup globals so other tests are unaffected
    delete (globalThis as Record<string, unknown>).Storage;
    delete (globalThis as Record<string, unknown>).localStorage;
    delete (globalThis as Record<string, unknown>).sessionStorage;
  });
});
