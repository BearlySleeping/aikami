// packages/frontend/repositories/src/lib/storage_adapter.ts
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
   * Closes the database connection and releases resources.
   */
  close(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

/**
 * SQL DDL statements for initialising the aikami local database schema.
 * Applies to both Tauri (native) and browser (WASM) backends.
 */
export const AIKAMI_SCHEMA_DDL: readonly string[] = [
  // ── Game saves ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS saves (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Characters ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    appearance_json TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Chat history ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── String registry (C-195) ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS string_registry (
    id INTEGER PRIMARY KEY,
    value TEXT NOT NULL UNIQUE
  )`,

  // ── Index for session-scoped chat queries ──────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_chat_history_session
    ON chat_history(session_id, created_at)`,
];

/** Database file name for the local SQLite store. */
export const LOCAL_DB_FILE = 'file:aikami.db';
