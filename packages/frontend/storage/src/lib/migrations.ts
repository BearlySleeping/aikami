// packages/frontend/storage/src/lib/migrations.ts
//
// C-384: Numbered local SQLite migrations keyed on `PRAGMA user_version`.
// Replaces the unversioned "apply all DDL every boot" scheme
// (`AIKAMI_SCHEMA_DDL`, deleted by C-384). Migration 1 is the pre-contract
// schema verbatim, so every existing install converges on version 1 as a
// no-op. Every subsequent schema change becomes a new numbered entry that
// runs exactly once per database, atomically.
//
// The migration list is DATA, not code: no conditional logic, no environment
// checks, no schema-probing inside a migration. Migrations are append-only —
// editing an already-released version is prohibited because it produces
// divergent schemas across installs with no way to detect the divergence.

import { logger } from '$logger';
import type { LocalDatabaseInterface, SqlQuery } from './storage_adapter.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single, immutable, numbered schema revision.
 */
export type Migration = {
  /** 1-based, contiguous, strictly increasing. Never reused, never reordered. */
  version: number;
  /** Human-readable summary — appears in migration logs. */
  name: string;
  /** Statements applied atomically, in order, exactly once per database. */
  statements: readonly string[];
};

// ---------------------------------------------------------------------------
// Migration list
// ---------------------------------------------------------------------------

/**
 * Ordered, append-only migration list for the aikami local database.
 *
 * Version 1 is the pre-C-384 schema (formerly `AIKAMI_SCHEMA_DDL`) verbatim.
 * Existing installs are at `user_version = 0` with this schema already
 * applied; because every statement is `IF NOT EXISTS`, migrating them to
 * version 1 is a no-op that produces a schema identical to a fresh install.
 *
 * Do NOT edit entries below. Append new versions at the end.
 */
export const AIKAMI_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    statements: [
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

      // ── NPC schedules (C-248 Turso migration) ──────────────────────────
      `CREATE TABLE IF NOT EXISTS npc_schedules (
    npc_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
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

      // ── Asset registry (C-373) ───────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    category TEXT NOT NULL,
    hash TEXT NOT NULL,
    version INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    license TEXT NOT NULL DEFAULT 'unknown',
    attribution TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]'
  )`,

      `CREATE TABLE IF NOT EXISTS asset_sources (
    asset_id TEXT NOT NULL REFERENCES assets(id),
    backend TEXT NOT NULL, -- 'bundled' | 'r2' | 'self-hosted'
    url TEXT NOT NULL,
    priority INTEGER NOT NULL,
    PRIMARY KEY (asset_id, backend)
  )`,

      `CREATE TABLE IF NOT EXISTS install_state (
    asset_id TEXT PRIMARY KEY REFERENCES assets(id),
    status TEXT NOT NULL CHECK(status IN ('not_downloaded', 'downloading', 'cached', 'stale')),
    local_path TEXT,
    cached_hash TEXT,
    downloaded_at TEXT
  )`,

      `CREATE INDEX IF NOT EXISTS idx_assets_pack ON assets(pack_id)`,
      `CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(hash)`,
      `CREATE INDEX IF NOT EXISTS idx_install_state_status ON install_state(status)`,
    ],
  },

  // ── v2: chat metadata + ChatLink (C-386a) ────────────────────────────
  // `chat_history` already holds turns (v1). This migration adds the
  // chat-level metadata the Firestore `chats` collection used to own
  // (npcId, npcName, affection, stats, background image) plus the local
  // ChatLink bridge table. Messages stay in `chat_history` — no dual write.
  {
    version: 2,
    name: 'chat-metadata-and-chatlinks',
    statements: [
      `CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    npc_id TEXT NOT NULL,
    npc_name TEXT NOT NULL DEFAULT '',
    npc_avatar_url TEXT,
    uid TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private',
    affection INTEGER NOT NULL DEFAULT 0,
    stats_json TEXT NOT NULL DEFAULT '{}',
    background_image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
      `CREATE INDEX IF NOT EXISTS idx_chats_npc_uid ON chats(npc_id, uid)`,

      `CREATE TABLE IF NOT EXISTS chat_links (
    link_id TEXT PRIMARY KEY,
    target_chat_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
      `CREATE INDEX IF NOT EXISTS idx_chat_links_target ON chat_links(target_chat_id)`,
    ],
  },

  // ── v3: personas (C-386b) ────────────────────────────────────────────
  // Partial unique index gives the one-active-persona invariant at the
  // database level — the constraint that needed a hand-applied migration
  // under Data Connect becomes a single local transaction.
  {
    version: 3,
    name: 'personas',
    statements: [
      `CREATE TABLE IF NOT EXISTS personas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 0,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_personas_one_active
  ON personas(is_active) WHERE is_active = 1`,
    ],
  },

  // ── v4: npcs (C-386b) ────────────────────────────────────────────────
  // Per-install NPCs — no is_active/ownership columns (OQ3: no catalog
  // exists to own or filter against). creatorUid/visibility fold into data.
  {
    version: 4,
    name: 'npcs',
    statements: [
      `CREATE TABLE IF NOT EXISTS npcs (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    ],
  },

  // ── v5: custom_agents (C-386b) ───────────────────────────────────────
  // `folder` is an explicit column because listAgents({ folder }) filters
  // on it today — same convention as personas.is_active.
  {
    version: 5,
    name: 'custom_agents',
    statements: [
      `CREATE TABLE IF NOT EXISTS custom_agents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    folder      TEXT,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
      `CREATE INDEX IF NOT EXISTS idx_custom_agents_folder ON custom_agents(folder)`,
    ],
  },
];

// ---------------------------------------------------------------------------
// Migration list validation
// ---------------------------------------------------------------------------

/**
 * Validates a migration list at load time.
 *
 * Versions must start at 1, be strictly increasing, and have no gaps. A
 * silently skipped migration is unrecoverable in the field, so a malformed
 * list fails fast at startup instead of corrupting databases.
 *
 * @param migrations - The migration list to validate.
 * @throws When versions are non-contiguous, duplicated, or start above 1.
 */
export const assertValidMigrations = (migrations: readonly Migration[]): void => {
  for (let index = 0; index < migrations.length; index++) {
    const migration = migrations[index];
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Invalid migration list: expected version ${expectedVersion} at index ${index} ` +
          `but found ${migration.version} (${migration.name}). Versions must start at 1, ` +
          'be strictly increasing, and have no gaps.',
      );
    }
  }
};

// Validate the production list once at module load.
assertValidMigrations(AIKAMI_MIGRATIONS);

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Reads the current `PRAGMA user_version` from the database. */
const _readUserVersion = async (db: LocalDatabaseInterface): Promise<number> => {
  const result = await db.query({ sql: 'SELECT * FROM pragma_user_version', args: [] });
  const row = result.rows[0];
  if (!row) {
    throw new Error('applyMigrations: could not read PRAGMA user_version (no result row)');
  }
  const version = row.user_version ?? row.pragma_user_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new Error(`applyMigrations: invalid user_version value: ${String(version)}`);
  }
  return version;
};

/** Builds a version-bump statement with a validated integer. */
const _userVersionSetStatement = (version: number): SqlQuery => {
  // PRAGMA user_version cannot be parameterised — the value must be
  // interpolated. It MUST come from Migration.version (validated below as a
  // non-negative safe integer), never from user input or query results.
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error(`applyMigrations: invalid migration version: ${String(version)}`);
  }
  return { sql: `PRAGMA user_version = ${version}`, args: [] };
};

/**
 * Brings the database up to the latest migration version.
 *
 * Reads `PRAGMA user_version`, applies every migration with a greater
 * version in ascending order, each inside a transaction that also bumps
 * `user_version`. Idempotent: a database already at the latest version
 * performs one pragma read and returns.
 *
 * A failed migration rolls back its own transaction; the database stays at
 * the previous version and the error propagates to the caller.
 *
 * @param db - The local database to migrate.
 * @param migrations - Optional migration list (defaults to {@link AIKAMI_MIGRATIONS}).
 * @returns The resulting `user_version` after migration.
 */
export const applyMigrations = async (
  db: LocalDatabaseInterface,
  migrations: readonly Migration[] = AIKAMI_MIGRATIONS,
): Promise<number> => {
  assertValidMigrations(migrations);

  const currentVersion = await _readUserVersion(db);
  const pending = migrations.filter((migration) => migration.version > currentVersion);

  if (pending.length === 0) {
    logger.debug('applyMigrations:current', { version: currentVersion });
    return currentVersion;
  }

  let version = currentVersion;
  for (const migration of pending) {
    logger.info('applyMigrations:applying', {
      from: version,
      to: migration.version,
      name: migration.name,
    });

    try {
      const queries: SqlQuery[] = migration.statements.map((sql) => ({ sql, args: [] }));
      // The version bump lives inside the same transaction as the migration
      // statements: a crash or failure mid-run rolls back both, so the
      // database stays at the last fully-applied version and the next boot
      // resumes from there.
      queries.push(_userVersionSetStatement(migration.version));
      await db.transaction(queries);
    } catch (error) {
      logger.error('applyMigrations:failed', {
        version: migration.version,
        name: migration.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    version = migration.version;
  }

  return version;
};
