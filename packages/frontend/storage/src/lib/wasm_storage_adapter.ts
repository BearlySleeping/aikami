// packages/frontend/storage/src/lib/wasm_storage_adapter.ts
//
// C-321 AC-1: Browser WASM/OPFS storage adapter implementing
// LocalDatabaseInterface. Uses @sqlite.org/sqlite-wasm with OPFS
// persistence so campaign/save/chat data survives app restarts
// in the browser without any network access.
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

// ---------------------------------------------------------------------------
// WasmStorageAdapter
// ---------------------------------------------------------------------------

/**
 * Browser-side SQLite storage adapter backed by
 * {@link https://www.npmjs.com/package/@sqlite.org/sqlite-wasm | @sqlite.org/sqlite-wasm}
 * with OPFS persistence.
 *
 * Implements {@link LocalDatabaseInterface}. Uses dynamic import so the
 * ~1 MB WASM bundle never inflates the initial JS chunk.
 *
 * Instantiate via {@link createWasmStorageAdapter}. Must be closed via
 * {@link close} to release WASM resources.
 */
export class WasmStorageAdapter implements LocalDatabaseInterface {
  /** The underlying OPFS-backed SQLite database handle. */
  private _db: WasmDatabase | null = null;

  /** Path to the database file within OPFS. */
  private readonly _databasePath: string;

  /** Whether the adapter has been closed. */
  private _closed = false;

  constructor(options: { databasePath: string }) {
    this._databasePath = options.databasePath;
  }

  // -------------------------------------------------------------------
  // Public: lifecycle
  // -------------------------------------------------------------------

  /**
   * Opens the WASM SQLite database on OPFS.
   *
   * Dynamically imports @sqlite.org/sqlite-wasm and initialises the
   * WASM runtime. Requests persistent storage from the browser so
   * OPFS data is not evicted under disk pressure.
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

    // ── Workaround: @sqlite.org/sqlite-wasm only assigns kvvfs.internal
    // when sqlite3.__isUnderTest is truthy, but kvvfs xFileControl ALWAYS
    // reads kvvfs.internal.disablePageSizeChange. In production builds the
    // internal object stays undefined, so ANY statement prepare on a
    // localStorage-backed (kvvfs) database crashes with
    // 'Cannot read properties of undefined (reading disablePageSizeChange)'.
    // Provide the internal object explicitly so the kvvfs VFS works outside
    // test mode (page-size changes are disabled — kvvfs uses a fixed page
    // size internally).
    const kvvfs = (sqlite3 as unknown as { kvvfs?: { internal?: object } }).kvvfs;
    if (kvvfs && !kvvfs.internal) {
      kvvfs.internal = { disablePageSizeChange: true };
    }

    // Access oo1 API via bracket notation (library exports PascalCase names)
    const oo1 = sqlite3.oo1 as Record<string, unknown>;

    // ':memory:' special database — used for tests, no OPFS needed
    if (this._databasePath === ':memory:') {
      const DbCtor = oo1['DB'] as { new (filename?: string, flags?: string): WasmDatabase };
      this._db = new DbCtor(':memory:', 'c');
    } else {
      // Request persistent storage — non-fatal if denied
      await this._requestPersistence();

      // Main-thread OPFS persistence via the SAH pool VFS. This VFS is the
      // only OPFS backend that works on the main thread — the classic
      // sqlite3_vfs (OpfsDb) requires Atomics.wait() and can only run in a
      // Worker. The SAH pool must be installed first: the OpfsSAHPoolDb
      // constructor is exposed on the resolved pool utility, NOT on
      // sqlite3.oo1. Checking oo1['OpfsSAHPoolDb'] directly (as older code
      // did) always fails and silently drops to in-memory, losing all
      // campaign/save/chat data on reload.
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
            logger.debug('WasmStorageAdapter:opened-opfs-sahpool', {
              databasePath: this._databasePath,
            });
          }
        }
      } catch (error) {
        // OPFS not available (missing FileSystem APIs, sandboxed iframe, no
        // cross-origin isolation). Fall through to the persistent kvvfs
        // fallback below instead of silently dropping to in-memory.
        logger.warn(
          'WasmStorageAdapter: OPFS unavailable — falling back to localStorage-backed database.',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }

      // ── Persistent fallback: localStorage-backed kvvfs (JsStorageDb) ──
      // OPFS is the preferred backend, but when it is unavailable the
      // built-in kvvfs VFS persists SQLite pages in localStorage — which
      // survives page reloads (quota-limited to ~5MB). Last resort is an
      // in-memory database (no persistence across reloads).
      if (!this._db) {
        try {
          const JsStorageDbCtor = oo1['JsStorageDb'] as
            | { new (mode: 'local' | 'session'): WasmDatabase }
            | undefined;
          if (JsStorageDbCtor) {
            this._db = new JsStorageDbCtor('local');
            logger.warn(
              'WasmStorageAdapter: opened localStorage-backed database — persists across ' +
                'reloads but is quota-limited (~5MB). OPFS would be preferred.',
            );
          }
        } catch (storageError) {
          // localStorage kvvfs unavailable (private mode, storage disabled)
          logger.warn(
            'WasmStorageAdapter: localStorage kvvfs unavailable — falling back to ' +
              'in-memory database. Campaign data will NOT persist across page reloads.',
            { error: storageError instanceof Error ? storageError.message : String(storageError) },
          );
        }
      }

      if (!this._db) {
        const DbCtor = oo1['DB'] as { new (filename?: string, flags?: string): WasmDatabase };
        this._db = new DbCtor(':memory:', 'c');
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
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and opens a {@link WasmStorageAdapter}.
 *
 * Initialises the WASM runtime and opens the OPFS-backed SQLite
 * database before returning the ready-to-use adapter.
 *
 * @param options - Database file name within OPFS.
 * @returns A connected WasmStorageAdapter instance.
 */
export const createWasmStorageAdapter = async (options: {
  databasePath: string;
}): Promise<WasmStorageAdapter> => {
  const adapter = new WasmStorageAdapter(options);
  await adapter.open();
  return adapter;
};
