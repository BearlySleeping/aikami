// apps/frontend/client/src/lib/services/assets/catalog_snapshot_store.ts
//
// Device-backed persistence for the verified asset catalog (offline boot).
//
// The AssetStore is a pure reactive view over whichever catalog release is
// active; WHERE that release graph is kept between boots is this module's
// concern. It is the single production writer/reader of the snapshot, backed
// by the shared local database (Turso in the browser, libSQL on desktop) —
// public catalog metadata, no identity and no save data.
//
// The database connection is created lazily and memoized: the snapshot is
// consulted during boot catalog resolution, which can run before any prefetch
// pipeline has opened the local store, and opening it twice would hand two
// writers the same connection.

import {
  AssetRegistryRepository,
  type CatalogSnapshot,
  type CatalogSnapshotMetaStore,
  getLocalDatabase,
  readCatalogSnapshot,
  writeCatalogSnapshot,
} from '@aikami/frontend/storage';
import { logger } from '$logger';

/**
 * Read/write seam over the device's persisted catalog snapshot.
 *
 * Narrow on purpose: `undefined` from {@link CatalogSnapshotStore.read} means
 * "no usable snapshot" — absent, malformed or digest-rejected alike, since all
 * three mean the same thing to the caller (there is nothing to boot from).
 */
export type CatalogSnapshotStore = {
  read: () => Promise<CatalogSnapshot | undefined>;
  write: (snapshot: CatalogSnapshot) => Promise<void>;
};

/**
 * Opens (once) the local database and wraps it in the asset registry that
 * owns the `meta` key/value store the snapshot lives in.
 */
const openRegistry = async (): Promise<AssetRegistryRepository> =>
  new AssetRegistryRepository(await getLocalDatabase());

/**
 * The registry seen as a snapshot meta store, with DURABILITY wired to the
 * connection it was opened from.
 *
 * `setMeta` returning only means "committed in SQLite". In the browser the
 * database lives in memory and is snapshotted to IndexedDB on a debounce, so a
 * record written and then reloaded inside that window is gone — which is
 * exactly how a freshly cached catalog evaporates across a reload. Awaiting
 * the existing `LocalDatabaseInterface.flush()` (a no-op under OPFS and under
 * native libSQL, which have nothing deferred) makes the write claim honest.
 *
 * The handle is the connection the registry already captured; no second
 * connection and no new lifetime is introduced here.
 */
const metaStoreOf = (registry: AssetRegistryRepository): CatalogSnapshotMetaStore => ({
  getMeta: (key) => registry.getMeta(key),
  setMeta: (key, value) => registry.setMeta(key, value),
  flush: async () => {
    await registry.database.flush?.();
  },
});

/**
 * The production {@link CatalogSnapshotStore}: the local device database.
 *
 * Memoizes the registry handle across boots so repeated reads do not reopen
 * the connection. Persistence failures are surfaced to the caller, which
 * treats them as a cache miss — a device that cannot persist its catalog
 * still boots online.
 */
export const createDatabaseCatalogSnapshotStore = (): CatalogSnapshotStore => {
  let registry: Promise<AssetRegistryRepository> | undefined;

  const resolveRegistry = (): Promise<AssetRegistryRepository> => {
    registry ??= openRegistry().catch((error: unknown) => {
      // Never cache a rejected open: the next boot attempt must be able to
      // retry rather than inherit this failure forever.
      registry = undefined;
      throw error;
    });
    return registry;
  };

  return {
    read: async () => {
      const handle = await resolveRegistry();
      logger.debug('catalogSnapshotStore:read');
      return readCatalogSnapshot(metaStoreOf(handle));
    },
    write: async (snapshot: CatalogSnapshot) => {
      const handle = await resolveRegistry();
      logger.debug('catalogSnapshotStore:write', {
        releaseId: snapshot.releaseId,
        rows: snapshot.seed.rows.length,
        coreTags: snapshot.coreTags.length,
      });
      // Resolves only once the record is DURABLE, so the store may treat a
      // returned promise as "the device holds this release".
      await writeCatalogSnapshot(metaStoreOf(handle), snapshot);
    },
  };
};
