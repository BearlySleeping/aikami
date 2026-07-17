// packages/frontend/repositories/src/lib/local_database_factory.ts
//
// C-321 AC-1, AC-2: Platform-selecting factory for the local SQLite
// database. Picks the native Tauri adapter (TursoStorageAdapter) when
// the @tursodatabase/database module is loadable, or the WASM/OPFS
// adapter (WasmStorageAdapter) otherwise. Applies AIKAMI_SCHEMA_DDL
// idempotently and returns the shared connection.
//
// The client owns ONE shared connection for the app session — opened
// lazily on first use and closed on app teardown. Repositories must
// NOT each open their own database file.

import { logger } from '$logger';
import type { LocalDatabaseInterface } from './storage_adapter.ts';
import { AIKAMI_SCHEMA_DDL, LOCAL_DB_FILE } from './storage_adapter.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the local database factory. */
export type LocalDatabaseFactoryOptions = {
  /** Overrides the default database path (useful for tests). */
  databasePath?: string;
  /** Forces a specific platform adapter instead of auto-detection (tests). */
  platform?: 'native' | 'wasm';
};

// ---------------------------------------------------------------------------
// Shared connection singleton
// ---------------------------------------------------------------------------

/** The single shared database connection for the app session. */
let _sharedDatabase: LocalDatabaseInterface | null = null;

/** Whether the shared database is currently being opened. */
let _opening: Promise<LocalDatabaseInterface> | null = null;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns (or creates) the shared local database connection.
 *
 * On first call: auto-detects the platform (native Tauri vs WASM/OPFS),
 * opens the database, applies {@link AIKAMI_SCHEMA_DDL} idempotently,
 * and returns the connection.
 *
 * Subsequent calls return the cached connection immediately.
 *
 * @param options - Optional overrides for database path or platform.
 * @returns The shared local database connection.
 */
export const getLocalDatabase = async (
  options?: LocalDatabaseFactoryOptions,
): Promise<LocalDatabaseInterface> => {
  // Return cached connection
  if (_sharedDatabase) {
    return _sharedDatabase;
  }

  // If already opening, wait for the in-flight open
  if (_opening) {
    return _opening;
  }

  const databasePath = options?.databasePath ?? LOCAL_DB_FILE;

  _opening = (async (): Promise<LocalDatabaseInterface> => {
    const platform = options?.platform ?? (await _detectPlatform());

    logger.debug('getLocalDatabase:platform', { platform, databasePath });

    const db = await _openAdapter({ platform, databasePath });

    // Apply DDL idempotently (CREATE TABLE IF NOT EXISTS)
    await _applySchema(db);

    _sharedDatabase = db;
    return db;
  })();

  try {
    return await _opening;
  } finally {
    _opening = null;
  }
};

/**
 * Closes the shared database connection (if open) and releases resources.
 *
 * Safe to call even if the database was never opened.
 */
export const closeLocalDatabase = async (): Promise<void> => {
  if (_sharedDatabase) {
    await _sharedDatabase.close();
    _sharedDatabase = null;
  }

  _opening = null;
};

/**
 * Resets the shared connection (primarily for tests).
 */
export const resetLocalDatabase = (): void => {
  _sharedDatabase = null;
  _opening = null;
};

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

/** Detects whether the native Tauri adapter is available. */
const _detectPlatform = async (): Promise<'native' | 'wasm'> => {
  try {
    // In Tauri, @tursodatabase/database is loadable. In a plain
    // browser webview it will throw (Node-native module not found).
    await import('@tursodatabase/database');
    return 'native';
  } catch {
    return 'wasm';
  }
};

/** Opens the selected adapter. */
const _openAdapter = async (options: {
  platform: 'native' | 'wasm';
  databasePath: string;
}): Promise<LocalDatabaseInterface> => {
  if (options.platform === 'native') {
    const { createTursoStorageAdapter } = await import('./turso_storage_adapter.ts');
    return createTursoStorageAdapter({ databasePath: options.databasePath });
  }

  const { createWasmStorageAdapter } = await import('./wasm_storage_adapter.ts');
  return createWasmStorageAdapter({ databasePath: options.databasePath });
};

/** Applies the schema DDL idempotently. */
const _applySchema = async (db: LocalDatabaseInterface): Promise<void> => {
  logger.debug('getLocalDatabase:applySchema', { statementCount: AIKAMI_SCHEMA_DDL.length });

  for (const ddl of AIKAMI_SCHEMA_DDL) {
    await db.execute({ sql: ddl, args: [] });
  }

  logger.debug('getLocalDatabase:applySchema:complete');
};
