// packages/frontend/engine/src/persistence/turso_registry_hydration.ts

import { BaseEngineClass, type BaseEngineClassOptions } from '../base_engine_class.ts';
import type { RegistryRow, StringRegistryService } from '../services/string_registry_service.ts';

// ---------------------------------------------------------------------------
// TursoRegistryHydration — offline Turso (libSQL) → registry bridge
//
// Contract C-195 AC-2 (updated C-203): Ingests row records from the local
// Turso SQLite database container during game boot and assigns sequential
// handle indices into the engine's unproxied StringRegistryService.
//
// Architecture:
// 1. At boot, the GameWorld initialization pipeline calls hydrate().
// 2. hydrate() queries the local Turso database for text records.
// 3. Each row is fed to StringRegistryService.bulkRegister().
// 4. Registration completes before active simulation starts — no runtime
//    allocations during gameplay.
//
// Uses @tursodatabase/database (Rust-based libSQL client) as the primary
// client library. When unavailable, the bridge operates in stub mode and
// logs a warning.
//
// C-203 update: Switched from @libsql/client to @tursodatabase/database
// for the new Rust-based embedded SQLite setup. The API uses connect()
// with path-based file URIs (e.g. 'file:aikami.db') and the familiar
// prepare → bind → all / run pattern.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Raw row shape returned from a Turso SQL query for registry strings.
 */
export type TursoStringRow = {
  /** Row primary key. */
  id: number;
  /** The text value to register. */
  value: string;
};

/**
 * Options for constructing a {@link TursoRegistryHydration}.
 */
export type TursoRegistryHydrationOptions = BaseEngineClassOptions & {
  /** Reference to the active StringRegistryService instance. */
  registry: StringRegistryService;
  /** Path to the local SQLite database file (e.g. 'file:aikami.db'). When omitted, operates in stub mode. */
  databasePath?: string;
  /** Optional remote Turso sync URL for cloud replication. */
  syncUrl?: string;
  /** Optional Turso auth token for sync URL authentication. */
  authToken?: string;
};

// ---------------------------------------------------------------------------
// TursoRegistryHydration
// ---------------------------------------------------------------------------

/**
 * Boot-time hydration bridge that ingests string records from a local
 * Turso (libsql) SQLite database and populates the StringRegistryService.
 *
 * When Turso is unavailable (stub mode), hydrate() returns an empty result
 * set and logs a warning. The game can still function — strings are
 * registered lazily via StringRegistryService.register() at runtime.
 *
 * Instantiate via {@link TursoRegistryHydration.create}, never with `new`.
 */
export class TursoRegistryHydration extends BaseEngineClass<TursoRegistryHydrationOptions> {
  /** Reference to the active string registry. */
  private readonly _registry: StringRegistryService;

  /** Path to the local SQLite database file for live mode. */
  private readonly _databasePath?: string;

  /** Optional remote Turso sync URL (reserved for C-203 AC-4). */
  private readonly _syncUrl?: string;

  /** Optional Turso auth token (reserved for C-203 AC-4). */
  private readonly _authToken?: string;

  /**
   * Do NOT use `new TursoRegistryHydration()`. Use
   * {@link TursoRegistryHydration.create} instead.
   */
  constructor(options: TursoRegistryHydrationOptions) {
    super(options);
    this._registry = options.registry;
    this._databasePath = options.databasePath;
    this._syncUrl = options.syncUrl;
    this._authToken = options.authToken;
  }

  // -----------------------------------------------------------------------
  // Public: hydration
  // -----------------------------------------------------------------------

  /**
   * Hydrates the string registry from Turso rows.
   *
   * In live mode (databasePath provided): executes a SELECT query against
   * the local Turso database, converts rows to RegistryRow entries, and
   * bulk-registers them.
   *
   * In stub mode (no database path): returns an empty result set and logs
   * a warning. The game proceeds with lazy registration.
   *
   * @returns The number of rows ingested into the registry.
   */
  async hydrate(): Promise<number> {
    // Reference sync fields to satisfy TS noUnusedLocals; wired in C-203 AC-4
    void this._syncUrl;
    void this._authToken;

    if (!this._databasePath) {
      this.debug('hydrate:stub-mode', {
        message: 'Turso database path not configured — registry will use lazy registration',
      });
      return 0;
    }

    try {
      const rows = await this._queryTurso();
      const registryRows: RegistryRow[] = rows.map((row) => ({ value: row.value }));
      const handles = this._registry.bulkRegister(registryRows);
      this.debug('hydrate:complete', { rowCount: rows.length, handleCount: handles.length });
      return rows.length;
    } catch (error) {
      this.error('hydrate:failed', { error });
      // Hydration failure is non-fatal — proceed with lazy registration
      return 0;
    }
  }

  /**
   * Hydrates the registry from pre-fetched rows (bypasses Turso).
   *
   * Use this when rows have already been fetched by the caller (e.g.,
   * from a loader module that wraps the Turso client) and the bridge
   * only needs to perform the register step.
   *
   * @param rows - Pre-fetched Turso row data.
   * @returns The number of rows ingested.
   */
  hydrateFromRows(rows: readonly TursoStringRow[]): number {
    const registryRows: RegistryRow[] = rows.map((row) => ({ value: row.value }));
    const handles = this._registry.bulkRegister(registryRows);
    this.debug('hydrateFromRows', { rowCount: rows.length, handleCount: handles.length });
    return rows.length;
  }

  // -----------------------------------------------------------------------
  // Private: Turso query
  // -----------------------------------------------------------------------

  /**
   * Queries the local Turso database for string registry records.
   *
   * Uses dynamic import for @tursodatabase/database (Rust-based libSQL
   * client) to avoid a hard native dependency at bundle time. When the
   * package is unavailable (e.g. in pure browser contexts where WASM is
   * the fallback), throws with a descriptive message.
   */
  private async _queryTurso(): Promise<TursoStringRow[]> {
    this.debug('_queryTurso:start', { path: this._databasePath });

    const databasePath = this._databasePath;

    if (!databasePath) {
      throw new Error(
        'TursoRegistryHydration: missing databasePath. ' +
          'Provide a file path or operate in stub mode.',
      );
    }

    try {
      const turso = await import('@tursodatabase/database');

      const db = await turso.connect(databasePath);

      // prepare → bind → all pattern with @tursodatabase/database
      const stmt = await db.prepare('SELECT id, value FROM string_registry ORDER BY id ASC');
      const rows = (await stmt.all()) as TursoStringRow[];

      this.debug('_queryTurso:complete', { rowCount: rows.length });
      return rows;
    } catch {
      throw new Error(
        'TursoRegistryHydration: @tursodatabase/database is not installed. ' +
          'Install it with `bun add @tursodatabase/database` or operate in stub mode.',
      );
    }
  }
}
