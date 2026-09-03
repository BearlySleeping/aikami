// packages/frontend/storage/src/lib/storage_adapter.ts
//
// C-203 AC-1, AC-2: Standardized local database interface for the
// Local-First Turso Sync architecture. Abstracts over platform-specific
// SQLite implementations:
//   - Tauri desktop: @tursodatabase/database (Rust-native libSQL)
//   - Web browser:   @libsql/client/web (WASM + OPFS)
//
// This interface provides query, execute, transaction, and sync primitives
// so that upper-layer services (GameSaveService, chat persistence, etc.)
// never depend on a concrete platform binding.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parameterised query descriptor for a single SQL statement.
 */
export type SqlQuery = {
  /** SQL statement with ? placeholders. */
  sql: string;
  /** Bound parameter values matching the placeholder count. */
  args: readonly unknown[];
};

/**
 * Result rows from a query operation. Each row is a column→value
 * dictionary matching the SELECT shape.
 */
export type QueryResultRow = Record<string, unknown>;

/**
 * Result of a query operation returning typed rows.
 */
export type QueryResult = {
  /** Row dictionaries keyed by column name. */
  readonly rows: readonly QueryResultRow[];
};

/**
 * Standardized local database interface for offline-first storage.
 *
 * Implementations:
 * - {@link TursoStorageAdapter} — @tursodatabase/database (Tauri native)
 * - WASM/OPFS adapter — @libsql/client/web (browser)
 */
export type LocalDatabaseInterface = {
  /**
   * Executes a SELECT query and returns typed result rows.
   *
   * @param options - SQL string and bound parameters.
   * @returns Query result with column-keyed row dictionaries.
   */
  query(options: SqlQuery): Promise<QueryResult>;

  /**
   * Executes a non-SELECT statement (INSERT, UPDATE, DELETE, CREATE, etc.).
   *
   * @param options - SQL string and bound parameters.
   */
  execute(options: SqlQuery): Promise<void>;

  /**
   * Executes multiple statements atomically in a single transaction.
   * Rolls back all changes if any statement fails.
   *
   * @param queries - Ordered array of parameterised queries.
   */
  transaction(queries: readonly SqlQuery[]): Promise<void>;

  /**
   * Triggers a bidirectional sync with the remote Turso database.
   * Pushes local changes and pulls remote updates.
   *
   * No-op when no sync URL is configured.
   */
  sync(): Promise<void>;

  /**
   * Exports the full database as raw bytes for backup or transfer.
   *
   * @returns The complete database file as a Uint8Array.
   */
  exportBytes(): Promise<Uint8Array>;

  /**
   * Replaces the database contents with the given bytes, then leaves
   * the adapter in a fully queryable state.
   *
   * @param bytes - Raw database file bytes (previously obtained from
   *   exportBytes()).
   */
  importBytes(bytes: Uint8Array): Promise<void>;

  /**
   * Closes the database connection and releases resources.
   */
  close(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Database constants
// ---------------------------------------------------------------------------

/** Database file name for the local SQLite store. */
export const LOCAL_DB_FILE = 'file:aikami.db';
