// packages/frontend/engine/src/persistence/turso_registry_hydration.ts

import { BaseEngineClass, type BaseEngineClassOptions } from '../base_engine_class.ts';
import type { RegistryRow, StringRegistryService } from '../services/string_registry_service.ts';

// ---------------------------------------------------------------------------
// TursoRegistryHydration — offline Turso (libsql) → registry bridge
//
// Contract C-195 AC-2: Ingests row records from the local Turso SQLite
// database container during game boot and assigns sequential handle indices
// into the engine's unproxied StringRegistryService.
//
// Architecture:
// 1. At boot, the GameWorld initialization pipeline calls hydrate().
// 2. hydrate() queries the local Turso database for text records.
// 3. Each row is fed to StringRegistryService.bulkRegister().
// 4. Registration completes before active simulation starts — no runtime
//    allocations during gameplay.
//
// The Turso client library (@libsql/client) is an optional dependency.
// When unavailable, the bridge operates in stub mode and logs a warning.
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
  /** Optional Turso database URL. When omitted, operates in stub mode. */
  tursoUrl?: string;
  /** Optional Turso auth token. */
  tursoAuthToken?: string;
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

  /** Optional Turso database URL for live mode. */
  private readonly _tursoUrl?: string;

  /** Optional Turso auth token. */
  private readonly _tursoAuthToken?: string;

  /**
   * Do NOT use `new TursoRegistryHydration()`. Use
   * {@link TursoRegistryHydration.create} instead.
   */
  constructor(options: TursoRegistryHydrationOptions) {
    super(options);
    this._registry = options.registry;
    this._tursoUrl = options.tursoUrl;
    this._tursoAuthToken = options.tursoAuthToken;
  }

  // -----------------------------------------------------------------------
  // Public: hydration
  // -----------------------------------------------------------------------

  /**
   * Hydrates the string registry from Turso rows.
   *
   * In live mode (tursoUrl + tursoAuthToken provided): executes a SELECT
   * query against the local Turso database, converts rows to RegistryRow
   * entries, and bulk-registers them.
   *
   * In stub mode (no Turso credentials): returns an empty result set and
   * logs a warning. The game proceeds with lazy registration.
   *
   * @returns The number of rows ingested into the registry.
   */
  async hydrate(): Promise<number> {
    if (!this._tursoUrl || !this._tursoAuthToken) {
      this.debug('hydrate:stub-mode', {
        message: 'Turso not configured — registry will use lazy registration',
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
   * Uses dynamic import for @libsql/client to avoid a hard dependency.
   * When the package is unavailable, throws with a descriptive message.
   */
  private async _queryTurso(): Promise<TursoStringRow[]> {
    this.debug('_queryTurso:start', { url: this._tursoUrl });

    // Dynamic import — @libsql/client is an optional peer dependency
    const url = this._tursoUrl;
    const authToken = this._tursoAuthToken;

    if (!url || !authToken) {
      throw new Error(
        'TursoRegistryHydration: missing url or authToken. ' +
          'Provide credentials or operate in stub mode.',
      );
    }

    try {
      const libsql = await import('@libsql/client');

      const client = libsql.createClient({ url, authToken });

      const result = await client.execute('SELECT id, value FROM string_registry ORDER BY id ASC');

      this.debug('_queryTurso:complete', { rowCount: result.rows.length });
      return result.rows;
    } catch {
      throw new Error(
        'TursoRegistryHydration: @libsql/client is not installed. ' +
          'Install it with `bun add @libsql/client` or operate in stub mode.',
      );
    }
  }
}
