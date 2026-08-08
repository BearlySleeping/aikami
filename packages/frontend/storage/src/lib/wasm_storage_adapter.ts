// packages/frontend/storage/src/lib/wasm_storage_adapter.ts
//
// C-321 AC-1: Browser WASM/OPFS storage adapter implementing
// LocalDatabaseInterface. Uses @sqlite.org/sqlite-wasm with OPFS
// persistence so campaign/save/chat data survives app restarts
// in the browser without any network access.
//
// Persistence backends, in preference order:
//   1. OPFS SAH pool VFS (main-thread OPFS) — preferred, no size limit.
//   2. In-memory DB + whole-file IndexedDB snapshot (C-321 fallback) — used
//      when OPFS APIs are missing. A plain :memory: database is snapshotted
//      as whole-file bytes (sqlite3_js_db_export) to IndexedDB (debounced)
//      after writes, and restored via sqlite3_deserialize on open.
//      IndexedDB quotas are ~10% of disk, so the asset registry + saves
//      fit comfortably. localStorage was rejected as a fallback because
//      its ~5MB quota overflows with the asset registry.
//   3. Pure in-memory — last resort, no persistence across reloads.
//
// This adapter is dynamically imported at runtime — it never
// inflates the initial bundle. The factory in local_database_factory.ts
// selects this adapter when the native Tauri adapter is unavailable
// (i.e. in a plain browser webview).

// biome-ignore-all lint/complexity/useLiteralKeys: library API property access names

import { logger } from '$logger';
import type { LocalDatabaseInterface, QueryResult, SqlQuery } from './storage_adapter.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape from @sqlite.org/sqlite-wasm that we interact with. */
type WasmDatabase = {
  exec(options: {
    sql: string;
    bind?: readonly unknown[];
    returnValue?: string;
    resultRows?: Record<string, unknown>[];
    rowMode?: string;
  }): WasmDatabase | Record<string, unknown>[];
  transaction<T>(callback: () => T): T;
  close(): void;
  isOpen(): boolean;
};

/** Async key/value persistence backend (IndexedDB in production). */
type PersistenceBackend = {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
};

// ---------------------------------------------------------------------------
// IndexedDB persistence backend
// ---------------------------------------------------------------------------

const IDB_NAME = 'aikami-local-db';
const IDB_STORE = 'sqlite-snapshots';
const SNAPSHOT_KEY = 'kvvfs-export';

const _openIdb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });

const _idbBackend: PersistenceBackend = {
  async get(key) {
    try {
      const db = await _openIdb();
      try {
        return await new Promise<unknown | null>((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const req = tx.objectStore(IDB_STORE).get(key);
          req.onsuccess = () => resolve((req.result as unknown) ?? null);
          req.onerror = () => reject(req.error);
        });
      } finally {
        db.close();
      }
    } catch {
      return null; // IndexedDB unavailable — treat as no snapshot
    }
  },
  async set(key, value) {
    const db = await _openIdb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },
};

/** Swappable backend so unit tests can run without a real IndexedDB. */
let _persistenceBackend: PersistenceBackend = _idbBackend;

// biome-ignore lint/style/useNamingConvention: test hook
export const _setPersistenceBackendForTests = (backend: PersistenceBackend): void => {
  _persistenceBackend = backend;
};

// ---------------------------------------------------------------------------
// WasmStorageAdapter
// ---------------------------------------------------------------------------

/**
 * Browser-side SQLite storage adapter backed by
 * {@link https://www.npmjs.com/package/@sqlite.org/sqlite-wasm | @sqlite.org/sqlite-wasm}.
 *
 * Implements {@link LocalDatabaseInterface}. Uses dynamic import so the
 * ~1 MB WASM bundle never inflates the initial JS chunk.
 *
 * Instantiate via {@link createWasmStorageAdapter}. Must be closed via
 * {@link close} to release WASM resources.
 */
export class WasmStorageAdapter implements LocalDatabaseInterface {
  /** The underlying SQLite database handle. */
  private _db: WasmDatabase | null = null;

  /** Path to the database file within OPFS (or ':memory:' for tests). */
  private readonly _databasePath: string;

  /** Whether the adapter has been closed. */
  private _closed = false;

  /** sqlite3 module ref — needed for DB export in snapshot mode. */
  private _sqlite3: unknown = null;

  /** Which persistence mode is active (set during open()). */
  private _persistMode: 'opfs' | 'idb-snapshot' | 'memory' = 'memory';

  /** Debounced persistence timer (snapshot mode). */
  private _persistTimer: ReturnType<typeof setTimeout> | undefined;

  /** Debounce delay — settable for tests (0 = immediate). */
  private readonly _persistDebounceMs: number;

  /** pagehide handler — flushes pending snapshot on tab close/navigation. */
  private _unloadFlush: (() => void) | undefined;

  constructor(options: { databasePath: string; persistDebounceMs?: number }) {
    this._databasePath = options.databasePath;
    this._persistDebounceMs = options.persistDebounceMs ?? 300;
  }

  // -------------------------------------------------------------------
  // Public: lifecycle
  // -------------------------------------------------------------------

  /**
   * Opens the WASM SQLite database.
   *
   * Dynamically imports @sqlite.org/sqlite-wasm and initialises the
   * WASM runtime. Persistence is OPFS-first, falling back to an
   * in-memory DB snapshotted to IndexedDB, then pure in-memory.
   *
   * Must be called before any query/execute operations. Safe to call
   * multiple times — subsequent calls are no-ops.
   */
  async open(): Promise<void> {
    if (this._db) {
      return;
    }

    if (this._closed) {
      throw new Error('WasmStorageAdapter: cannot re-open a closed adapter');
    }

    // Dynamically import the WASM package (~1 MB, excluded from initial bundle)
    const sqlite3Module = await import('@sqlite.org/sqlite-wasm');

    // Initialise the WASM runtime
    const sqlite3 = await sqlite3Module.default();
    this._sqlite3 = sqlite3;

    // ── Workaround: @sqlite.org/sqlite-wasm only assigns kvvfs.internal
    // when sqlite3.__isUnderTest is truthy, but kvvfs xFileControl ALWAYS
    // reads kvvfs.internal.disablePageSizeChange. In production builds the
    // internal object stays undefined, so ANY statement prepare on a kvvfs
    // database crashes with 'Cannot read properties of undefined (reading
    // disablePageSizeChange)'. Provide the internal object explicitly so
    // the kvvfs VFS works outside test mode (page-size changes are disabled
    // — kvvfs uses a fixed page size internally).
    const kvvfs = (sqlite3 as unknown as { kvvfs?: { internal?: object } }).kvvfs;
    if (kvvfs && !kvvfs.internal) {
      kvvfs.internal = { disablePageSizeChange: true };
    }

    // Access oo1 API via bracket notation (library exports PascalCase names)
    const oo1 = sqlite3.oo1 as Record<string, unknown>;

    // ':memory:' special database — used for tests, no persistence needed
    if (this._databasePath === ':memory:') {
      const DbCtor = oo1['DB'] as { new (filename?: string, flags?: string): WasmDatabase };
      this._db = new DbCtor(':memory:', 'c');
      this._persistMode = 'memory';
    } else {
      // Request persistent storage — non-fatal if denied
      await this._requestPersistence();

      // ── 1. OPFS SAH pool VFS (preferred) ──
      // The only OPFS backend that works on the main thread — the classic
      // sqlite3_vfs (OpfsDb) requires Atomics.wait() and can only run in a
      // Worker. The SAH pool must be installed first: the OpfsSAHPoolDb
      // constructor is exposed on the resolved pool utility, NOT on
      // sqlite3.oo1.
      try {
        const installOpfsSahPoolVfs = sqlite3['installOpfsSAHPoolVfs'] as
          | ((opts?: Record<string, unknown>) => Promise<{
              // biome-ignore lint/style/useNamingConvention: sqlite-wasm API name
              OpfsSAHPoolDb?: new (
                filename: string,
              ) => WasmDatabase;
            }>)
          | undefined;

        if (installOpfsSahPoolVfs) {
          const poolUtil = await installOpfsSahPoolVfs.call(sqlite3);
          const SahCtor = poolUtil?.OpfsSAHPoolDb;
          if (SahCtor) {
            this._db = new SahCtor(this._databasePath);
            this._persistMode = 'opfs';
            logger.debug('WasmStorageAdapter:opened-opfs-sahpool', {
              databasePath: this._databasePath,
            });
          }
        }
      } catch (error) {
        // OPFS not available (missing FileSystem APIs, sandboxed iframe, no
        // cross-origin isolation). Fall through to the IndexedDB snapshot
        // fallback below.
        logger.warn(
          'WasmStorageAdapter: OPFS unavailable — falling back to IndexedDB-snapshotted database.',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }

      // ── 2. In-memory DB + whole-file IndexedDB snapshot ──
      // localStorage was rejected: its ~5MB quota overflows with the asset
      // registry. The kvvfs export/import VFS was also rejected — it sorts
      // page contents and loses the page-id mapping (SQLITE_CORRUPT after
      // import in this sqlite-wasm version). Instead we run a plain
      // :memory: database and snapshot the ENTIRE db file (sqlite3_js_db_
      // export) to IndexedDB after writes, restoring via sqlite3_deserialize
      // on open. IndexedDB quotas are ~10% of disk.
      if (!this._db) {
        try {
          const DbCtor = oo1['DB'] as { new (filename?: string, flags?: string): WasmDatabase };
          this._db = new DbCtor(':memory:', 'c');

          const saved = await _persistenceBackend.get(SNAPSHOT_KEY);
          if (saved instanceof Uint8Array && saved.byteLength > 0) {
            this._restoreSnapshotBytes(saved);
            logger.debug('WasmStorageAdapter:restored-snapshot', {
              bytes: saved.byteLength,
            });
          }

          this._persistMode = 'idb-snapshot';
          logger.warn(
            'WasmStorageAdapter: opened in-memory database snapshotted to IndexedDB — persists ' +
              'across reloads (no OPFS available).',
          );

          // ── Durability: the debounce is the only guarantee that a write
          // reaches IndexedDB. Flush on pagehide (tab close / navigation /
          // refresh) so a save followed by an immediate unload is not lost.
          if (typeof window !== 'undefined') {
            this._unloadFlush = () => {
              void this._persistNow();
            };
            window.addEventListener('pagehide', this._unloadFlush);
          }
        } catch (error) {
          logger.warn(
            'WasmStorageAdapter: IndexedDB snapshot fallback failed — falling back to in-memory ' +
              'database. Campaign data will NOT persist across page reloads.',
            { error: error instanceof Error ? error.message : String(error) },
          );
        }
      }

      // ── 3. Pure in-memory (last resort) ──
      if (!this._db) {
        const DbCtor = oo1['DB'] as { new (filename?: string, flags?: string): WasmDatabase };
        this._db = new DbCtor(':memory:', 'c');
        this._persistMode = 'memory';
      }
    }

    // Foreign-key enforcement ON — asset_sources/install_state reference
    // assets(id); deleting an asset must first remove its dependent rows.
    this._db?.exec({ sql: 'PRAGMA foreign_keys = ON' });
  }

  /** Closes the database connection and releases WASM resources. */
  async close(): Promise<void> {
    if (this._closed) {
      return;
    }

    // Flush any pending snapshot before closing (snapshot mode).
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = undefined;
    }
    if (this._unloadFlush) {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', this._unloadFlush);
      }
      this._unloadFlush = undefined;
    }
    if (this._persistMode === 'idb-snapshot') {
      await this._persistNow();
    }

    if (this._db) {
      this._db.close();
      this._db = null;
    }

    this._closed = true;
  }

  // -------------------------------------------------------------------
  // Public: LocalDatabaseInterface
  // -------------------------------------------------------------------

  /** @inheritdoc */
  async query(options: SqlQuery): Promise<QueryResult> {
    const db = this._getDb();

    const resultRows: Record<string, unknown>[] = [];
    db.exec({
      sql: options.sql,
      bind: options.args as unknown[],
      returnValue: 'resultRows',
      resultRows,
      rowMode: 'object',
    });

    return { rows: resultRows };
  }

  /** @inheritdoc */
  async execute(options: SqlQuery): Promise<void> {
    const db = this._getDb();

    db.exec({
      sql: options.sql,
      bind: options.args as unknown[],
    });

    this._schedulePersist();
  }

  /** @inheritdoc */
  async transaction(queries: readonly SqlQuery[]): Promise<void> {
    const db = this._getDb();

    db.transaction(() => {
      for (const query of queries) {
        db.exec({
          sql: query.sql,
          bind: query.args as unknown[],
        });
      }
    });

    this._schedulePersist();
  }

  /** @inheritdoc */
  async sync(): Promise<void> {
    // No-op: sync is not configured until C-357
  }

  // -------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------

  /** Returns the database handle, throwing if not connected. */
  private _getDb(): WasmDatabase {
    if (this._closed) {
      throw new Error('WasmStorageAdapter: adapter is closed');
    }

    if (!this._db?.isOpen()) {
      throw new Error('WasmStorageAdapter: not connected — call open() first');
    }

    return this._db;
  }

  /**
   * Requests persistent storage from the browser.
   *
   * Non-fatal — warns on denial but continues. OPFS data may be evicted
   * under disk pressure without persistence, but normal operation is not
   * affected.
   */
  private async _requestPersistence(): Promise<void> {
    try {
      if ('storage' in navigator && 'persist' in navigator.storage) {
        const granted = await navigator.storage.persist();
        if (!granted) {
          logger.warn(
            'WasmStorageAdapter: browser denied persistent storage. ' +
              'OPFS data may be evicted under disk pressure.',
          );
        }
      }
    } catch {
      // navigator.storage.persist() not available — OPFS still works,
      // just without the persistence guarantee
    }
  }

  /** Debounced persistence of the kvvfs storage to IndexedDB. */
  private _schedulePersist(): void {
    if (this._persistMode !== 'idb-snapshot') {
      return;
    }
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
    }
    this._persistTimer = setTimeout(() => {
      this._persistTimer = undefined;
      void this._persistNow();
    }, this._persistDebounceMs);
  }

  /** Exports the whole kvvfs storage and snapshots it to IndexedDB. */
  private async _persistNow(): Promise<void> {
    if (this._persistMode !== 'idb-snapshot' || !this._sqlite3) {
      return;
    }
    try {
      const capi = (this._sqlite3 as unknown as { capi?: Record<string, unknown> }).capi;
      const db = this._db as unknown as { pointer: number };
      const exportFn = capi?.['sqlite3_js_db_export'] as
        | ((pDb: number, schema?: number) => Uint8Array)
        | undefined;
      if (!exportFn) {
        return;
      }
      const bytes = exportFn(db.pointer);
      await _persistenceBackend.set(SNAPSHOT_KEY, bytes);
    } catch (error) {
      logger.warn('WasmStorageAdapter:persist-snapshot-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Restores a whole-DB byte snapshot into the open :memory: database. */
  private _restoreSnapshotBytes(bytes: Uint8Array): void {
    if (!this._db || !this._sqlite3) {
      return;
    }
    const capi = (this._sqlite3 as unknown as { capi?: Record<string, unknown> }).capi;
    const wasm = (this._sqlite3 as unknown as { wasm?: Record<string, unknown> }).wasm;
    const sqlite3 = this._sqlite3 as unknown as {
      capi?: { SQLITE_DESERIALIZE_FREEONCLOSE?: number; SQLITE_DESERIALIZE_RESIZEABLE?: number };
    };
    const deserialize = capi?.['sqlite3_deserialize'] as
      | ((
          pDb: number,
          schema: string,
          data: number,
          dbSize: number,
          bufferSize: number,
          flags: number,
        ) => number)
      | undefined;
    const allocFromTypedArray = wasm?.['allocFromTypedArray'] as
      | ((bytes: Uint8Array) => number)
      | undefined;
    if (!deserialize || !allocFromTypedArray) {
      return;
    }

    const db = this._db as unknown as { pointer: number };
    const pData = allocFromTypedArray(bytes);
    const flags =
      (sqlite3.capi?.SQLITE_DESERIALIZE_FREEONCLOSE ?? 1) |
      (sqlite3.capi?.SQLITE_DESERIALIZE_RESIZEABLE ?? 2);
    const rc = deserialize(db.pointer, 'main', pData, bytes.byteLength, bytes.byteLength, flags);
    if (rc !== 0) {
      logger.warn('WasmStorageAdapter:deserialize-failed', { rc });
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and opens a {@link WasmStorageAdapter}.
 *
 * Initialises the WASM runtime and opens the database before returning
 * the ready-to-use adapter.
 *
 * @param options - Database file name within OPFS, plus optional test overrides.
 * @returns A connected WasmStorageAdapter instance.
 */
export const createWasmStorageAdapter = async (options: {
  databasePath: string;
  persistDebounceMs?: number;
}): Promise<WasmStorageAdapter> => {
  const adapter = new WasmStorageAdapter(options);
  await adapter.open();
  return adapter;
};
