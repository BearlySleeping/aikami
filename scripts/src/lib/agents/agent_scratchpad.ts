// scripts/src/lib/agents/agent_scratchpad.ts
// biome-ignore-all lint/style/useNamingConvention: SQLite column names and HerDr API field names (snake_case) — must match external contracts
/**
 * Coherent Ephemeral SQLite-WAL Scratchpad Engine.
 *
 * Implements an ephemeral, high-speed file-backed scratchpad database using
 * SQLite in Write-Ahead Logging (WAL) mode. Serves as the central state
 * synchronization ledger for parallel agents, tracking resource versions,
 * maintaining an append-only historical mutation record (delivery log),
 * and enforcing strict Optimistic Concurrency Control (OCC) over isolated
 * agent write shards.
 *
 * Key features:
 * - WAL journal mode for concurrent reads without blocking writers
 * - Atomic Compare-And-Swap (CAS) commit verification
 * - Append-only delivery log tracking every read operation
 * - Epoch-fenced heartbeat sweep for zombie process lease cleanup
 * - `BEGIN IMMEDIATE` write transactions to prevent serialization conflicts
 *
 * @module agent_scratchpad
 */

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';

// ── Types ──────────────────────────────────────────────────

/** Artifact lifecycle state. */
export type ArtifactState = 'SHARED' | 'EXCLUSIVE' | 'INVALID';

/** A versioned artifact record stored in the scratchpad. */
export type ArtifactRecord = {
  key: string;
  version: number;
  contentHash: string;
  content: string;
  state: ArtifactState;
  ownerId: string | null;
  epoch: number;
};

/** Payload envelope for scratchpad operations. */
export type ScratchpadPayloadEnvelope = {
  schemaVersion: string;
  sessionId: string;
  workspaceRoot: string;
  readSet: Array<{ key: string; version: number }>;
  writeDelta: {
    key: string;
    expectedVersion: number;
    eventType: 'create' | 'update' | 'delete';
    content: string;
  };
};

/** Single write delta for CAS commit. */
export type WriteDelta = {
  key: string;
  expectedVersion: number;
  eventType: 'create' | 'update' | 'delete';
  content: string;
  /** Optional owner assignment for EXCLUSIVE lock acquisition */
  ownerId?: string;
  /** Optional target state */
  targetState?: ArtifactState;
};

/** Delivery log entry recording a read operation. */
export type DeliveryLogEntry = {
  id: number;
  key: string;
  version: number;
  readBy: string;
  readAt: string;
  contentHash: string;
};

/** Configuration for the scratchpad engine. */
export type ScratchpadOptions = {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Agent identifier for delivery log attribution */
  agentId: string;
  /** Optional WAL checkpoint interval in ms (0 = auto) */
  walCheckpointIntervalMs?: number;
};

// ── C-306: Swarm hardening types ───────────────────────────

/** Swarm agent state row stored in the SQLite heartbeat table. */
export type SwarmStateRow = {
  taskId: string;
  workspaceId: string;
  agentKey: string;
  agentStatus: 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
  lastContextHash: string | null;
  lastHeartbeatTimestamp: number;
  agentOutput: string;
};

/** AST outline cache entry for token router prefix stability. */
export type AstOutlineCacheRecord = {
  filePathKey: string;
  contentHash: string;
  conventionsVersion: string;
  compressedAstFootprint: string;
};

/** Exponential backoff configuration for OCC write retries. */
export type BackoffConfig = {
  /** Base delay in ms */
  baseDelayMs: number;
  /** Maximum delay cap in ms */
  maxDelayMs: number;
  /** Maximum number of retry attempts */
  maxRetries: number;
};

export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 50,
  maxDelayMs: 2000,
  maxRetries: 5,
} as const;

/** Error thrown on stale write (OCC violation). */
export class ConflictError extends Error {
  readonly key: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(options: { key: string; expectedVersion: number; actualVersion: number }) {
    super(
      `OCC conflict on "${options.key}": expected v${options.expectedVersion}, actual v${options.actualVersion}`,
    );
    this.name = 'ConflictError';
    this.key = options.key;
    this.expectedVersion = options.expectedVersion;
    this.actualVersion = options.actualVersion;
  }
}

// ── Constants ──────────────────────────────────────────────

const SCHEMA_VERSION = '1.0.0';
const DEFAULT_EPOCH_TIMEOUT_MS = 30_000;

const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS artifacts (
    key TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'SHARED'
      CHECK (state IN ('SHARED', 'EXCLUSIVE', 'INVALID')),
    owner_id TEXT,
    epoch INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS delivery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    version INTEGER NOT NULL,
    read_by TEXT NOT NULL,
    read_at TEXT NOT NULL,
    content_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scratchpad_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO scratchpad_config (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');

  -- C-306: AST outline cache for token router prefix stability
  CREATE TABLE IF NOT EXISTS ast_outline_cache (
    file_path_key TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    conventions_version TEXT NOT NULL,
    compressed_ast_footprint TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- C-306: Swarm agent heartbeat tracking
  CREATE TABLE IF NOT EXISTS swarm_heartbeat (
    task_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_key TEXT NOT NULL,
    agent_status TEXT NOT NULL DEFAULT 'idle'
      CHECK (agent_status IN ('idle', 'working', 'blocked', 'done', 'unknown')),
    last_context_hash TEXT,
    last_heartbeat_timestamp INTEGER NOT NULL,
    agent_output TEXT DEFAULT '',
    PRIMARY KEY (task_id, agent_key)
  );
`;

// ── Engine class ───────────────────────────────────────────

/**
 * Ephemeral SQLite scratchpad engine with OCC support.
 *
 * Usage:
 * ```typescript
 * const pad = new AgentScratchpad({
 *   dbPath: '/tmp/agent-scratchpad.db',
 *   agentId: 'agent-architect',
 * });
 *
 * // Read with delivery log tracking
 * const artifact = pad.readArtifact('task-001');
 *
 * // Write with CAS version check
 * pad.writeArtifact({
 *   key: 'task-001',
 *   expectedVersion: artifact?.version ?? -1,
 *   eventType: 'update',
 *   content: JSON.stringify({ status: 'done' }),
 * });
 * ```
 */
export class AgentScratchpad {
  private readonly _db: Database;
  private readonly _agentId: string;
  private _closed = false;

  constructor(options: ScratchpadOptions) {
    this._agentId = options.agentId;

    this._db = new Database(options.dbPath, { create: true });

    // Enable WAL mode before anything else
    this._db.exec(SCHEMA_SQL);

    // Migration: add agent_output column if missing (pre-existing DBs from swarm v1)
    const cols = this._db.query("PRAGMA table_info('swarm_heartbeat')").all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === 'agent_output')) {
      this._db.exec("ALTER TABLE swarm_heartbeat ADD COLUMN agent_output TEXT DEFAULT ''");
    }

    // Set up periodic WAL checkpoint if requested
    if (options.walCheckpointIntervalMs && options.walCheckpointIntervalMs > 0) {
      this._startWalCheckpoint(options.walCheckpointIntervalMs);
    }
  }

  // ── Public API ─────────────────────────────────────────

  /**
   * Read an artifact by key, appending a delivery log entry.
   *
   * AC-1: Concurrent Read-Set Isolation and Registration
   * - Returns the document with its current version
   * - Appends a strict record to the delivery log tracking the exact version read
   * - Does not block adjacent reading workflows (WAL allows concurrent readers)
   */
  readArtifact(key: string): ArtifactRecord | null {
    this._assertOpen();

    const row = this._db
      .query<
        {
          key: string;
          version: number;
          content_hash: string;
          content: string;
          state: string;
          owner_id: string | null;
          epoch: number;
        },
        [string]
      >('SELECT * FROM artifacts WHERE key = ?')
      .get(key);

    if (!row) {
      return null;
    }

    // ── Append delivery log entry ───────────────────────
    const contentHash = createHash('sha256').update(row.content).digest('hex');

    this._db.run(
      'INSERT INTO delivery_log (key, version, read_by, read_at, content_hash) VALUES (?, ?, ?, ?, ?)',
      [key, row.version, this._agentId, new Date().toISOString(), contentHash],
    );

    return {
      key: row.key,
      version: row.version,
      contentHash: row.content_hash,
      content: row.content,
      state: row.state as ArtifactState,
      ownerId: row.owner_id,
      epoch: row.epoch,
    };
  }

  /**
   * Write an artifact delta using Optimistic Concurrency Control.
   *
   * AC-2: Optimistic Concurrency Control and Stale Write Rejection
   * - Uses `BEGIN IMMEDIATE` to prevent deadlock
   * - Checks expectedVersion against the active database record version
   * - If stale: throws ConflictError, executes ROLLBACK, preserves existing state
   * - If current: atomically commits the update
   */
  writeArtifact(delta: WriteDelta): void {
    this._assertOpen();

    const { key, expectedVersion, eventType, content, ownerId, targetState } = delta;

    // ── Begin immediate transaction ──────────────────────
    this._db.run('BEGIN IMMEDIATE');

    try {
      if (eventType === 'delete') {
        this._writeDelete(key, expectedVersion);
      } else {
        this._writeUpsert(key, expectedVersion, content, ownerId, targetState);
      }

      this._db.run('COMMIT');
    } catch (error) {
      // ── Rollback on any error ──────────────────────────
      this._db.run('ROLLBACK');

      if (error instanceof ConflictError) {
        throw error;
      }

      throw error;
    }
  }

  // ── Write helpers ─────────────────────────────────────

  /** Delete an artifact with version check. */
  private _writeDelete(key: string, expectedVersion: number): void {
    const existing = this._db
      .query<{ version: number }, [string]>('SELECT version FROM artifacts WHERE key = ?')
      .get(key);

    if (!existing) {
      // Deleting a non-existent artifact — treat as no-op (idempotent)
      return;
    }

    if (expectedVersion > -1 && existing.version !== expectedVersion) {
      throw new ConflictError({
        key,
        expectedVersion,
        actualVersion: existing.version,
      });
    }

    this._db.run('DELETE FROM artifacts WHERE key = ?', [key]);
  }

  /** Upsert an artifact with version check. */
  private _writeUpsert(
    key: string,
    expectedVersion: number,
    content: string,
    ownerId?: string,
    targetState?: ArtifactState,
  ): void {
    const contentHash = createHash('sha256').update(content).digest('hex');
    const existing = this._db
      .query<{ version: number; state: string; owner_id: string | null }, [string]>(
        'SELECT version, state, owner_id FROM artifacts WHERE key = ?',
      )
      .get(key);

    if (existing) {
      // ── Existing artifact — check version ─────────────
      // expectedVersion of -1 means "create only" — reject if exists
      if (expectedVersion === -1) {
        throw new ConflictError({
          key,
          expectedVersion,
          actualVersion: existing.version,
        });
      }

      if (existing.version !== expectedVersion) {
        throw new ConflictError({
          key,
          expectedVersion,
          actualVersion: existing.version,
        });
      }

      const newVersion = existing.version + 1;
      const newState = targetState ?? (existing.state as ArtifactState);

      this._db.run(
        `UPDATE artifacts
         SET version = ?, content_hash = ?, content = ?, state = ?,
             owner_id = ?, epoch = ?
         WHERE key = ?`,
        [newVersion, contentHash, content, newState, ownerId ?? null, Date.now(), key],
      );
    } else {
      // ── New artifact — expectedVersion must be -1 ─────
      if (expectedVersion !== -1) {
        throw new ConflictError({
          key,
          expectedVersion,
          actualVersion: 0,
        });
      }

      this._db.run(
        `INSERT INTO artifacts (key, version, content_hash, content, state, owner_id, epoch)
         VALUES (?, 1, ?, ?, ?, ?, ?)`,
        [key, contentHash, content, targetState ?? 'SHARED', ownerId ?? null, Date.now()],
      );
    }
  }

  // ── Epoch heartbeat sweep ─────────────────────────────

  /**
   * Invalidate leases for artifacts held EXCLUSIVE past the epoch timeout.
   *
   * Edge case: Zombie Process Leases — if an agent crashes while holding
   * an exclusive write lease, the resource stalls. This sweep invalidates
   * leases after the timeout period.
   *
   * @returns Number of leases invalidated.
   */
  invalidateExpiredLeases(epochTimeoutMs = DEFAULT_EPOCH_TIMEOUT_MS): number {
    this._assertOpen();

    const cutoff = Date.now() - epochTimeoutMs;

    const result = this._db.run(
      `UPDATE artifacts
       SET state = 'SHARED', owner_id = NULL
       WHERE state = 'EXCLUSIVE' AND epoch < ?`,
      [cutoff],
    );

    return result.changes;
  }

  // ── Query helpers ─────────────────────────────────────

  /** List all artifacts currently in the scratchpad. */
  listArtifacts(): ArtifactRecord[] {
    this._assertOpen();

    const rows = this._db
      .query<
        {
          key: string;
          version: number;
          content_hash: string;
          content: string;
          state: string;
          owner_id: string | null;
          epoch: number;
        },
        []
      >('SELECT * FROM artifacts ORDER BY key')
      .all();

    return rows.map((row) => ({
      key: row.key,
      version: row.version,
      contentHash: row.content_hash,
      content: row.content,
      state: row.state as ArtifactState,
      ownerId: row.owner_id,
      epoch: row.epoch,
    }));
  }

  /** Get delivery log entries for a specific key. */
  getDeliveryLog(key: string, limit = 50): DeliveryLogEntry[] {
    this._assertOpen();

    const rows = this._db
      .query<
        {
          id: number;
          key: string;
          version: number;
          read_by: string;
          read_at: string;
          content_hash: string;
        },
        [string, number]
      >('SELECT * FROM delivery_log WHERE key = ? ORDER BY id DESC LIMIT ?')
      .all(key, limit);

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      version: row.version,
      readBy: row.read_by,
      readAt: row.read_at,
      contentHash: row.content_hash,
    }));
  }

  /** Get the current schema version. */
  getSchemaVersion(): string {
    const row = this._db
      .query<{ value: string }, []>(
        "SELECT value FROM scratchpad_config WHERE key = 'schema_version'",
      )
      .get();

    return row?.value ?? 'unknown';
  }

  // ── C-306: AST outline cache ─────────────────────────

  /**
   * Look up a cached AST outline footprint by file path key.
   *
   * AC-2: AST Outline Cache Synchronization
   * - Checks content_hash stability before returning cached footprint
   * - Skips redundant Tree-sitter parsing for unchanged files
   */
  getAstOutlineCache(filePathKey: string): AstOutlineCacheRecord | null {
    this._assertOpen();

    const row = this._db
      .query<
        {
          file_path_key: string;
          content_hash: string;
          conventions_version: string;
          compressed_ast_footprint: string;
        },
        [string]
      >('SELECT * FROM ast_outline_cache WHERE file_path_key = ?')
      .get(filePathKey);

    if (!row) {
      return null;
    }

    return {
      filePathKey: row.file_path_key,
      contentHash: row.content_hash,
      conventionsVersion: row.conventions_version,
      compressedAstFootprint: row.compressed_ast_footprint,
    };
  }

  /**
   * Store an AST outline footprint in the cache.
   * Uses INSERT OR REPLACE to overwrite stale entries.
   */
  setAstOutlineCache(record: AstOutlineCacheRecord): void {
    this._assertOpen();

    this._db.run(
      `INSERT OR REPLACE INTO ast_outline_cache
       (file_path_key, content_hash, conventions_version, compressed_ast_footprint, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        record.filePathKey,
        record.contentHash,
        record.conventionsVersion,
        record.compressedAstFootprint,
        Date.now(),
      ],
    );
  }

  /** Clear all stale cache entries that don't match the current conventions version. */
  invalidateStaleAstCache(currentConventionsVersion: string): number {
    this._assertOpen();

    const result = this._db.run('DELETE FROM ast_outline_cache WHERE conventions_version != ?', [
      currentConventionsVersion,
    ]);

    return result.changes;
  }

  // ── C-306: Swarm heartbeat ────────────────────────────

  /**
   * Update or insert a heartbeat entry for a swarm agent.
   */
  upsertHeartbeat(row: SwarmStateRow): void {
    this._assertOpen();

    this._db.run(
      `INSERT OR REPLACE INTO swarm_heartbeat
       (task_id, workspace_id, agent_key, agent_status, last_context_hash, last_heartbeat_timestamp, agent_output)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.taskId,
        row.workspaceId,
        row.agentKey,
        row.agentStatus,
        row.lastContextHash,
        row.lastHeartbeatTimestamp,
        row.agentOutput ?? '',
      ],
    );
  }

  /**
   * Delete all heartbeat rows for a task — called at pipeline start so the
   * ledger is task-scoped and never mixes rows from previous runs.
   */
  clearTaskHeartbeats(taskId: string): void {
    this._assertOpen();
    this._db.run('DELETE FROM swarm_heartbeat WHERE task_id = ?', [taskId]);
  }

  /**
   * Finalize a task — mark any remaining working/blocked agents as done,
   * so the ledger shows a clean state after pipeline completion.
   */
  finalizeTask(taskId: string): void {
    this._assertOpen();
    this._db.run(
      `UPDATE swarm_heartbeat
       SET agent_status = 'done'
       WHERE task_id = ? AND agent_status IN ('working', 'blocked')`,
      [taskId],
    );
  }

  /** Get heartbeat status for all agents in a task. */
  getHeartbeats(taskId: string): SwarmStateRow[] {
    this._assertOpen();

    const rows = this._db
      .query<
        {
          task_id: string;
          workspace_id: string;
          agent_key: string;
          agent_status: string;
          last_context_hash: string | null;
          last_heartbeat_timestamp: number;
          agent_output: string;
        },
        [string]
      >('SELECT * FROM swarm_heartbeat WHERE task_id = ? ORDER BY agent_key')
      .all(taskId);

    return rows.map((r) => ({
      taskId: r.task_id,
      workspaceId: r.workspace_id,
      agentKey: r.agent_key,
      agentStatus: r.agent_status as SwarmStateRow['agentStatus'],
      lastContextHash: r.last_context_hash,
      lastHeartbeatTimestamp: r.last_heartbeat_timestamp,
      agentOutput: r.agent_output ?? '',
    }));
  }

  /**
   * Detect stalled agents — those whose last heartbeat is older than the timeout.
   * Returns list of agent keys that appear stalled.
   */
  detectStalledAgents(taskId: string, heartbeatTimeoutMs: number): string[] {
    this._assertOpen();

    const cutoff = Date.now() - heartbeatTimeoutMs;

    const rows = this._db
      .query<{ agent_key: string }, [string, number]>(
        `SELECT agent_key FROM swarm_heartbeat
         WHERE task_id = ? AND agent_status IN ('working', 'blocked')
         AND last_heartbeat_timestamp < ?`,
      )
      .all(taskId, cutoff);

    return rows.map((r) => r.agent_key);
  }

  // ── C-306: Exponential backoff helper ─────────────────

  /**
   * Compute exponential backoff delay with jitter.
   *
   * Formula: min(cap, base * 2^attempt) + random_jitter
   * Jitter prevents thundering herd on concurrent write retries.
   */
  static backoffDelay(attempt: number, config: BackoffConfig = DEFAULT_BACKOFF_CONFIG): number {
    const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt);
    const jitter = Math.random() * config.baseDelayMs;
    return exponential + jitter;
  }

  // ── Lifecycle ─────────────────────────────────────────

  /** Close the database connection and perform a WAL checkpoint. */
  close(): void {
    if (this._closed) {
      return;
    }

    // Force WAL checkpoint to truncate the WAL file
    this._db.run('PRAGMA wal_checkpoint(TRUNCATE)');
    this._db.close();
    this._closed = true;
  }

  /** Delete the database file (for ephemeral cleanup). */
  destroy(): void {
    const dbPath = this._db.filename;
    this.close();
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  }

  // ── Internal helpers ──────────────────────────────────

  private _assertOpen(): void {
    if (this._closed) {
      throw new Error('AgentScratchpad has been closed');
    }
  }

  private _startWalCheckpoint(intervalMs: number): void {
    const timer = setInterval(() => {
      if (this._closed) {
        clearInterval(timer);
        return;
      }
      try {
        this._db.run('PRAGMA wal_checkpoint(PASSIVE)');
      } catch {
        // Checkpoint can fail during heavy writes — ignore
      }
    }, intervalMs);
  }
}

// ── Factory ────────────────────────────────────────────────

/**
 * Create and initialize a new scratchpad engine.
 */
export const createAgentScratchpad = (options: ScratchpadOptions): AgentScratchpad =>
  new AgentScratchpad(options);
