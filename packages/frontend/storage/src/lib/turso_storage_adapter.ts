// packages/frontend/storage/src/lib/turso_storage_adapter.ts
//
// C-203 AC-1, AC-2: Native SQLite storage adapter for Tauri desktop.
// Uses @tursodatabase/database (Rust-based libSQL client) for direct
// file-system access. Provides query, execute, transaction, and sync
// primitives via the LocalDatabaseInterface contract.
//
// Platform: Tauri desktop (Linux, macOS, Windows).
// For browser, see the WASM + OPFS adapter.

import { logger } from '$logger';
import type { LocalDatabaseInterface, QueryResult, SqlQuery } from './storage_adapter.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for constructing a {@link TursoStorageAdapter}.
 */
export type TursoStorageAdapterOptions = {
  /** Path to the local SQLite database file (e.g. 'file:aikami.db'). */
  databasePath: string;
  /** Optional remote Turso sync URL for cloud replication. */
  syncUrl?: string;
  /** Optional Turso auth token for sync URL authentication. */
  authToken?: string;
};

// ---------------------------------------------------------------------------
// TursoStorageAdapter
// ---------------------------------------------------------------------------

/**
 * Local SQLite storage adapter backed by @tursodatabase/database.
 *
 * Opens a native SQLite connection on construction. Supports the full
 * {@link LocalDatabaseInterface} contract: query, execute, transaction,
 * and cloud sync.
 *
 * Instantiate via {@link createTursoStorageAdapter}. The instance must
 * be closed via {@link close} when no longer needed.
 */
export class TursoStorageAdapter implements LocalDatabaseInterface {
  /** The connected Turso database handle. */
  private _db: Awaited<ReturnType<typeof import('@tursodatabase/database').connect>> | null = null;

  /** Path to the database file. */
  private readonly _databasePath: string;

  /** Optional remote sync URL. */
  private readonly _syncUrl?: string;

  /** Optional auth token for sync. */
  private readonly _authToken?: string;

  /** Whether the adapter has been closed. */
  private _closed = false;

  constructor(options: TursoStorageAdapterOptions) {
    this._databasePath = options.databasePath;
    this._syncUrl = options.syncUrl;
    this._authToken = options.authToken;
  }

  // -------------------------------------------------------------------
  // Public: lifecycle
  // -------------------------------------------------------------------

  /**
   * Opens the native SQLite connection.
   *
   * Must be called before any query or execute operations. Safe to call
   * multiple times — subsequent calls are no-ops if already connected.
   */
  async open(): Promise<void> {
    if (this._db) {
      return;
    }

    if (this._closed) {
      throw new Error('TursoStorageAdapter: cannot re-open a closed adapter');
    }

    logger.debug('TursoStorageAdapter.open', { path: this._databasePath });

    // @vite-ignore: optional native module — Vite must not statically
    // analyze it (its `node:module` import would otherwise be externalized
    // with browser-compatibility warnings). This adapter is only reached
    // in the Tauri runtime; plain browsers use the WASM adapter instead.
    const turso = await import(/* @vite-ignore */ '@tursodatabase/database');
    this._db = await turso.connect(this._databasePath);

    // Foreign-key enforcement ON — asset_sources/install_state reference
    // assets(id); deleting an asset must first remove its dependent rows.
    await this.execute({ sql: 'PRAGMA foreign_keys = ON', args: [] });

    logger.debug('TursoStorageAdapter.open:connected');
  }

  /** Closes the database connection and releases native resources. */
  async close(): Promise<void> {
    if (this._closed) {
      return;
    }

    logger.debug('TursoStorageAdapter.close');

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
    this._assertOpen();
    logger.debug('TursoStorageAdapter.query', { sql: options.sql });

    // @tursodatabase/database: prepare and all are async
    const db = this._db;
    if (!db) {
      throw new Error('TursoStorageAdapter: not open');
    }
    const stmt = await db.prepare(options.sql);
    if (options.args.length > 0) {
      stmt.bind(...options.args);
    }

    const rows = (await stmt.all()) as QueryResult['rows'];
    return { rows };
  }

  /** @inheritdoc */
  async execute(options: SqlQuery): Promise<void> {
    this._assertOpen();
    logger.debug('TursoStorageAdapter.execute', { sql: options.sql });

    // @tursodatabase/database: prepare and run are async
    const db = this._db;
    if (!db) {
      throw new Error('TursoStorageAdapter: not open');
    }
    const stmt = await db.prepare(options.sql);
    if (options.args.length > 0) {
      stmt.bind(...options.args);
    }

    await stmt.run();
  }

  /** @inheritdoc */
  async transaction(queries: readonly SqlQuery[]): Promise<void> {
    this._assertOpen();
    logger.debug('TursoStorageAdapter.transaction', { count: queries.length });

    const db = this._db;
    if (!db) {
      throw new Error('TursoStorageAdapter: not open');
    }

    // C-384 AC-4: the batch must be atomic. Without explicit BEGIN/COMMIT
    // each statement commits in autocommit mode, so a failure mid-batch
    // leaves earlier statements committed. Wrap the batch so either every
    // statement lands or none do (the migration runner depends on this).
    const begin = await db.prepare('BEGIN');
    await begin.run();
    try {
      for (const query of queries) {
        const stmt = await db.prepare(query.sql);
        if (query.args.length > 0) {
          stmt.bind(...query.args);
        }
        await stmt.run();
      }
      const commit = await db.prepare('COMMIT');
      await commit.run();
    } catch (error) {
      try {
        const rollback = await db.prepare('ROLLBACK');
        await rollback.run();
      } catch (rollbackError) {
        logger.error('TursoStorageAdapter.transaction:rollback-failed', {
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
      throw error;
    }
  }

  /** @inheritdoc */
  async sync(): Promise<void> {
    this._assertOpen();

    if (!this._syncUrl || !this._authToken) {
      logger.debug('TursoStorageAdapter.sync:skipped', {
        message: 'No sync URL or auth token configured',
      });
      return;
    }

    logger.debug('TursoStorageAdapter.sync:start', { syncUrl: this._syncUrl });

    try {
      // @tursodatabase/database sync API uses the sync() method on the
      // database handle. If the library version doesn't support it, this
      // degrades gracefully.
      const db = this._db as unknown as Record<string, unknown>;
      if (typeof db.sync === 'function') {
        await (db.sync as () => Promise<void>)();
      } else {
        logger.warn('TursoStorageAdapter.sync:unsupported', {
          message: '@tursodatabase/database sync() not available in this version',
        });
      }

      logger.debug('TursoStorageAdapter.sync:complete');
    } catch (error) {
      logger.warn('TursoStorageAdapter.sync:failed', { error });
      // Sync failure is non-fatal — local operations continue
    }
  }

  // -------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------

  /** Asserts the database connection is open. */
  private _assertOpen(): void {
    if (this._closed) {
      throw new Error('TursoStorageAdapter: adapter is closed');
    }

    if (!this._db) {
      throw new Error('TursoStorageAdapter: not connected — call open() first');
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and opens a {@link TursoStorageAdapter}.
 *
 * Connects to the native SQLite database and runs schema initialisation
 * before returning the ready-to-use adapter.
 *
 * @param options - Database path and optional sync credentials.
 * @returns A connected TursoStorageAdapter instance.
 */
export const createTursoStorageAdapter = async (
  options: TursoStorageAdapterOptions,
): Promise<TursoStorageAdapter> => {
  const adapter = new TursoStorageAdapter(options);
  await adapter.open();
  return adapter;
};
