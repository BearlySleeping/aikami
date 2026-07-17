// packages/frontend/repositories/src/lib/wasm_storage_adapter.ts
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

    // Access oo1 API via bracket notation (library exports PascalCase names)
    const oo1 = sqlite3.oo1 as Record<string, unknown>;

    // ':memory:' special database — used for tests, no OPFS needed
    if (this._databasePath === ':memory:') {
      const DbCtor = oo1['DB'] as { new (filename?: string, flags?: string): WasmDatabase };
      this._db = new DbCtor(':memory:', 'c');
      return;
    }

    // Request persistent storage — non-fatal if denied
    await this._requestPersistence();

    // Try SAH pool first (works without COOP/COEP headers), fall back to OpfsDb
    if (oo1['OpfsSAHPoolDb']) {
      const SahCtor = oo1['OpfsSAHPoolDb'] as { new (filename: string): WasmDatabase };
      this._db = new SahCtor(this._databasePath);
    } else if (oo1['OpfsDb']) {
      const OpfsCtor = oo1['OpfsDb'] as {
        new (filename: string, flags?: string): WasmDatabase;
      };
      this._db = new OpfsCtor(this._databasePath, 'c');
    } else {
      throw new Error(
        'WasmStorageAdapter: OPFS VFS not available. ' +
          'The browser may be missing required File System Access APIs.',
      );
    }
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
