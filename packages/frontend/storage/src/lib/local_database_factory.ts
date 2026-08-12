// packages/frontend/storage/src/lib/local_database_factory.ts
//
// C-321 AC-1, AC-2: Platform-selecting factory for the local SQLite
// database. Picks the native Tauri adapter (TursoStorageAdapter) when
// the @tursodatabase/database module is loadable, or the WASM/OPFS
// adapter (WasmStorageAdapter) otherwise. Applies schema migrations
// (C-384) and returns the shared connection.
//
// The client owns ONE shared connection for the app session — opened
// lazily on first use and closed on app teardown. Repositories must
// NOT each open their own database file.

import { logger } from '$logger';
import { applyMigrations } from './migrations.ts';
import type { LocalDatabaseInterface } from './storage_adapter.ts';
import { LOCAL_DB_FILE } from './storage_adapter.ts';

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
 * opens the database, runs the C-384 migrations, and returns the
 * connection.
 *
 * Subsequent calls return the cached connection immediately.
 *
 * A failed migration rejects the promise, closes the underlying handle,
 * and clears the singleton so a later call retries with a fresh database
 * instead of returning a half-open one.
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

    try {
      // Run schema migrations (C-384) before any repository is allowed
      // to query. A failure rejects and clears the singleton below.
      await applyMigrations(db);
    } catch (error) {
      logger.error('getLocalDatabase:migrations-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Do not hand a half-open database to repositories — close the
      // handle so the file is not left locked, clear the cache, rethrow.
      _sharedDatabase = null;
      try {
        await db.close();
      } catch (closeError) {
        logger.warn('getLocalDatabase:close-after-failure-failed', {
          error: closeError instanceof Error ? closeError.message : String(closeError),
        });
      }
      throw error;
    }

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
    // @vite-ignore: optional native module — Vite must not statically
    // analyze it (its `node:module` import would otherwise be
    // externalized with browser-compatibility warnings).
    await import(/* @vite-ignore */ '@tursodatabase/database');
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
