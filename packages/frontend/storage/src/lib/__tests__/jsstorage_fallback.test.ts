// packages/frontend/storage/src/lib/__tests__/jsstorage_fallback.test.ts
//
// C-321: Verifies the IndexedDB whole-file snapshot fallback used by
// WasmStorageAdapter when OPFS is unavailable — a :memory: DB whose full
// byte image (sqlite3_js_db_export) is snapshotted to a persistence backend
// (IndexedDB in production, a Map here) so data survives close/reopen
// (i.e. page reloads), restored via sqlite3_deserialize.

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
  };
};

describe('WasmStorageAdapter IndexedDB snapshot fallback', () => {
  test('whole-file export/deserialize round-trip survives close/reopen', async () => {
    const backend = makeMemoryBackend();
    _setPersistenceBackendForTests(backend);

    const sqlite3Module = await import('@sqlite.org/sqlite-wasm');
    const sqlite3 = (await sqlite3Module.default()) as Record<string, unknown>;
    const oo1 = sqlite3.oo1 as Record<string, unknown>;
    const capi = sqlite3.capi as Record<string, unknown>;
    const wasm = sqlite3.wasm as Record<string, unknown>;
    const Db = oo1.DB as {
      new (
        filename?: string,
        flags?: string,
      ): {
        pointer: number;
        exec(options: Record<string, unknown>): unknown;
        transaction<T>(cb: () => T): T;
        close(): void;
        isOpen(): boolean;
      };
    };
    const exportFn = capi.sqlite3_js_db_export as (pDb: number) => Uint8Array;
    const deserialize = capi.sqlite3_deserialize as (
      pDb: number,
      schema: string,
      data: number,
      dbSize: number,
      bufferSize: number,
      flags: number,
    ) => number;
    const allocFromTypedArray = wasm.allocFromTypedArray as (b: Uint8Array) => number;

    // ── First session: write data, snapshot, close ──
    const db1 = new Db(':memory:', 'c');
    db1.exec({ sql: 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, val TEXT)' });
    db1.transaction(() => {
      for (let i = 0; i < 600; i++) {
        db1.exec({ sql: 'INSERT INTO t (val) VALUES (?)', bind: [`value-${i}`] });
      }
    });

    const bytes = exportFn(db1.pointer);
    expect(bytes.byteLength).toBeGreaterThan(0);
    await backend.set('kvvfs-export', bytes);
    db1.close();

    // ── Second session (page reload): restore bytes, reopen ──
    const restored = (await backend.get('kvvfs-export')) as Uint8Array;
    const db2 = new Db(':memory:', 'c');
    const pData = allocFromTypedArray(restored);
    const rc = deserialize(
      db2.pointer,
      'main',
      pData,
      restored.byteLength,
      restored.byteLength,
      1 | 2, // FREEONCLOSE | RESIZEABLE
    );
    expect(rc).toBe(0);

    const rows: Record<string, unknown>[] = [];
    db2.exec({
      sql: 'SELECT COUNT(*) AS c FROM t',
      returnValue: 'resultRows',
      resultRows: rows,
      rowMode: 'object',
    });
    expect(rows).toEqual([{ c: 600 }]);
    db2.close();

    // Reset the backend to the real IndexedDB implementation for other tests.
    _setPersistenceBackendForTests({ get: async () => null, set: async () => {} });
  });
});
