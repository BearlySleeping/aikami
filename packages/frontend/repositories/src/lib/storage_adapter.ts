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
  // ── Campaigns (C-321) ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ── Capability profile (C-321) ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS capability_profile (
    campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),
    text_provider INTEGER NOT NULL,
    image_provider INTEGER NOT NULL,
    voice_provider INTEGER NOT NULL
  )`,

  // ── Meta key/value store (C-321) ───────────────────────────────────
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  // ── Game saves (C-321 realigned to SaveDocument) ───────────────────
  `CREATE TABLE IF NOT EXISTS saves (
    id TEXT PRIMARY KEY,
    slot_id TEXT NOT NULL,
    campaign_id TEXT,
    timestamp INTEGER NOT NULL,
    map_name TEXT NOT NULL,
    payload TEXT NOT NULL
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

  // ── Sessions (C-344 — replaces IndexedDB aikami_sessions) ─────────
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    session_number INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    summary_json TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    duration_minutes INTEGER,
    character_snapshots_json TEXT NOT NULL DEFAULT '{}',
    recap_reviewed INTEGER NOT NULL DEFAULT 0,
    edited_synopsis TEXT,
    checkpoint_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Session checkpoints (C-344) ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS session_checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    session_number INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    save_slot_id TEXT NOT NULL UNIQUE,
    has_forks INTEGER NOT NULL DEFAULT 0
  )`,

  // ── Player journal entries (C-344) ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    session_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Compacted campaign summaries (C-344) ────────────────────────────
  `CREATE TABLE IF NOT EXISTS compacted_summaries (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    session_range_first INTEGER NOT NULL,
    session_range_last INTEGER NOT NULL,
    compacted_session_ids_json TEXT NOT NULL,
    synopsis TEXT NOT NULL,
    key_events_json TEXT NOT NULL DEFAULT '[]',
    method TEXT NOT NULL CHECK(method IN ('ai', 'truncation')),
    compacted_at TEXT NOT NULL
  )`,

  // ── Index for session-scoped chat queries ──────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_chat_history_session
    ON chat_history(session_id, created_at)`,

  // ── Indexes for C-344 tables ────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_sessions_game ON sessions(game_id, session_number)`,
  `CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session ON session_checkpoints(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_session_checkpoints_campaign ON session_checkpoints(campaign_id)`,
  `CREATE INDEX IF NOT EXISTS idx_journal_campaign ON journal_entries(campaign_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_compacted_campaign ON compacted_summaries(campaign_id, compacted_at)`,
];

/** Database file name for the local SQLite store. */
export const LOCAL_DB_FILE = 'file:aikami.db';
