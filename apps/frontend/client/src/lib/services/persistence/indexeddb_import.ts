// apps/frontend/client/src/lib/services/persistence/indexeddb_import.ts
//
// C-321 AC-4: One-time IndexedDB → Turso import.
// Runs at app boot before the first repository read. Reads all
// campaigns and saves from IndexedDB aikami_saves and copies them
// into the local Turso/libSQL database exactly once.
//
// The import is idempotent via a marker in the `meta` table.
// IndexedDB source data is left in place (rollback safety).

import { getLocalDatabase } from '@aikami/frontend/repositories';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IndexedDB database name — must match the legacy IDB names. */
const LEGACY_DB_NAME = 'aikami_saves';

/** Key in the `meta` table marking completion. */
const IMPORT_MARKER_KEY = 'indexeddb_import_completed';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a legacy IndexedDB campaign document. */
type LegacyCampaignDoc = {
  id: string;
  data: string;
  updatedAt: string;
};

/** Shape of a legacy IndexedDB save document. */
type LegacySaveDoc = {
  id: string;
  slotId: string;
  timestamp: number;
  mapName: string;
  payload: string;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the one-time IndexedDB → Turso import if it hasn't already
 * been completed.
 *
 * Safe to call multiple times — checks the `meta` marker first.
 * The import runs inside a transaction for atomicity. A crash mid-import
 * rolls back and re-runs cleanly on the next boot.
 *
 * @returns A summary of what was imported.
 */
export const runIndexedDBImport = async (): Promise<{
  importedCampaigns: number;
  importedSaves: number;
  skipped: number;
  alreadyCompleted: boolean;
}> => {
  const db = await getLocalDatabase();

  // Check if already completed
  const markerResult = await db.query({
    sql: 'SELECT value FROM meta WHERE key = ?',
    args: [IMPORT_MARKER_KEY],
  });

  if (markerResult.rows.length > 0 && markerResult.rows[0].value === '1') {
    logger.debug('indexeddb_import:already-completed');
    return { importedCampaigns: 0, importedSaves: 0, skipped: 0, alreadyCompleted: true };
  }

  logger.debug('indexeddb_import:start');

  // Read legacy data from IndexedDB
  const legacyDocs = await _readLegacyIndexedDB();

  // Import into Turso in a single transaction
  let importedCampaigns = 0;
  let importedSaves = 0;
  let skipped = 0;

  try {
    // Build query array for the transaction
    const queries: { sql: string; args: readonly unknown[] }[] = [];

    for (const doc of legacyDocs.campaigns) {
      queries.push({
        sql: `INSERT OR IGNORE INTO campaigns (id, data, updated_at) VALUES (?, ?, ?)`,
        args: [doc.id, doc.data, doc.updatedAt],
      });
      importedCampaigns++;
    }

    for (const doc of legacyDocs.saves) {
      queries.push({
        sql: `INSERT OR IGNORE INTO saves (id, slot_id, campaign_id, timestamp, map_name, payload) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [doc.id, doc.slotId, null, doc.timestamp, doc.mapName, doc.payload],
      });
      importedSaves++;
    }

    // Set the marker as the last statement
    queries.push({
      sql: `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
      args: [IMPORT_MARKER_KEY, '1'],
    });

    // Execute all in one transaction
    if (queries.length > 1) {
      await db.transaction(queries);
    } else {
      // Only the marker — nothing to import
      await db.execute(queries[0]);
    }

    logger.debug('indexeddb_import:complete', { importedCampaigns, importedSaves, skipped });
  } catch (error) {
    logger.error('indexeddb_import:failed', { error });
    // IndexedDB data is untouched — safe to retry on next boot
    skipped = importedCampaigns + importedSaves;
    importedCampaigns = 0;
    importedSaves = 0;
  }

  return { importedCampaigns, importedSaves, skipped, alreadyCompleted: false };
};

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

/** Reads all legacy documents from IndexedDB. */
const _readLegacyIndexedDB = async (): Promise<{
  campaigns: LegacyCampaignDoc[];
  saves: LegacySaveDoc[];
}> => {
  const campaigns: LegacyCampaignDoc[] = [];
  const saves: LegacySaveDoc[] = [];

  try {
    const database = await _openLegacyDatabase();

    // Read campaigns store if it exists
    if (database.objectStoreNames.contains('campaigns')) {
      const campaignDocs = await _readAllFromStore<LegacyCampaignDoc>(database, 'campaigns');
      campaigns.push(...campaignDocs);
      logger.debug('indexeddb_import:read-campaigns', { count: campaignDocs.length });
    }

    // Read saves store if it exists
    if (database.objectStoreNames.contains('saves')) {
      const saveDocs = await _readAllFromStore<LegacySaveDoc>(database, 'saves');
      saves.push(...saveDocs);
      logger.debug('indexeddb_import:read-saves', { count: saveDocs.length });
    }

    database.close();
  } catch (error) {
    logger.warn('indexeddb_import:read-legacy-failed', { error });
    // If IDB can't be opened, there's nothing to import
  }

  return { campaigns, saves };
};

/** Opens the legacy IndexedDB database without specifying a version. */
const _openLegacyDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);

    request.onupgradeneeded = (): void => {
      // We don't create stores — we only read
    };

    request.onsuccess = (): void => {
      resolve(request.result);
    };

    request.onerror = (): void => {
      reject(request.error ?? new Error('Failed to open legacy IndexedDB'));
    };
  });
};

/** Reads all documents from a specific object store. */
const _readAllFromStore = <T>(db: IDBDatabase, storeName: string): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = (): void => {
        resolve(request.result as T[]);
      };

      request.onerror = (): void => {
        reject(request.error ?? new Error(`Failed to read store: ${storeName}`));
      };
    } catch (error) {
      reject(error);
    }
  });
};
