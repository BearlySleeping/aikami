// packages/frontend/storage/src/lib/assets.ts
//
// C-373: AssetRegistryRepository — Turso-backed asset registry over the
// shared LocalDatabaseInterface. Owns the `assets`, `asset_sources`, and
// `install_state` tables (created by schema migration v1, C-384) and
// provides batched, idempotent seeding from the bootstrap manifest + hash
// sidecar.
//
// The registry is metadata-only: raw binaries never touch SQLite rows.
// Cache backends (OPFS / Tauri FS) are managed by the client AssetManager.

import type {
  AssetHashesFile,
  AssetManifest,
  AssetRecord,
  AssetSource,
  InstallStateRecord,
} from '@aikami/types';
import { logger } from '$logger';
import type { LocalDatabaseInterface, QueryResultRow } from './storage_adapter.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Meta key recording the manifest `scannedAt` the registry was last seeded with. */
export const ASSET_REGISTRY_SEEDED_KEY = 'asset_registry_seeded';

/** Rows per seeding transaction — large single transactions stall WASM SQLite. */
export const SEED_CHUNK_SIZE = 500;

/** Backend identifier for the bundled static manifest source. */
export const BUNDLED_SOURCE_BACKEND = 'bundled' as const;

/** Base URL prefix for bundled asset files served from static/game-data. */
const BUNDLED_ASSET_BASE = '/game-data';

/**
 * R2 object key for an asset, matching the C-395 published layout.
 * `hash` is the sha256 already stored on the assets row; `ext` includes
 * the leading dot and is taken from the bundled source URL.
 */
const r2ObjectKey = (options: { hash: string; ext: string }): string =>
  `assets/${options.hash.slice(0, 2)}/${options.hash}${options.ext}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outcome counters from a single {@link AssetRegistryRepository.seedFromManifest} run. */
export type AssetSeedStats = {
  /** New asset rows inserted. */
  seeded: number;
  /** Existing rows whose hash/metadata changed (version bumped). */
  updated: number;
  /** Existing rows already current — no write needed. */
  unchanged: number;
  /** Manifest tags skipped because the sidecar has no hash entry for them. */
  skipped: number;
  /** Assets whose authoritative hash advanced — cache invalidation candidates. */
  hashChanges: readonly { id: string; oldHash: string; newHash: string }[];
};

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Local registry of asset metadata + install state, persisted in the shared
 * Turso/libSQL database. Seeded idempotently from `manifest.json` and the
 * `asset_hashes.json` sidecar; queried by the client AssetManager to resolve
 * asset binaries through the local cache before falling back to network.
 *
 * Plain class (no BaseClass dependency in this package) — instantiate with
 * {@link createAssetRegistryRepository} or `new AssetRegistryRepository(db)`.
 */
export class AssetRegistryRepository {
  /** The shared local database connection (constructor-injected). */
  private readonly _db: LocalDatabaseInterface;

  constructor(db: LocalDatabaseInterface) {
    this._db = db;
  }

  // ── Registry queries ─────────────────────────────────────────────────

  /** Lists every registered asset row. */
  async list(): Promise<AssetRecord[]> {
    const result = await this._db.query({
      sql: 'SELECT id, pack_id, category, hash, version, size_bytes, license, attribution, tags_json FROM assets ORDER BY id',
      args: [],
    });
    return result.rows.map(_rowToAssetRecord);
  }

  /** Finds a single asset row by tag, or undefined when unregistered. */
  async findById(id: string): Promise<AssetRecord | undefined> {
    const result = await this._db.query({
      sql: 'SELECT id, pack_id, category, hash, version, size_bytes, license, attribution, tags_json FROM assets WHERE id = ?',
      args: [id],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return _rowToAssetRecord(result.rows[0]);
  }

  /**
   * Finds every registered asset row whose id is in the given set (batched
   * read for boot rehydration — avoids per-id query fan-out). Chunked to
   * keep the IN clause bounded, mirroring {@link findIdsByHashes}.
   */
  async findByIds(ids: readonly string[]): Promise<AssetRecord[]> {
    const records: AssetRecord[] = [];
    const chunkSize = 500;
    for (let start = 0; start < ids.length; start += chunkSize) {
      const chunk = ids.slice(start, start + chunkSize);
      if (chunk.length === 0) {
        continue;
      }
      const placeholders = chunk.map(() => '?').join(', ');
      const result = await this._db.query({
        sql: `SELECT id, pack_id, category, hash, version, size_bytes, license, attribution, tags_json FROM assets WHERE id IN (${placeholders})`,
        args: [...chunk],
      });
      for (const row of result.rows) {
        records.push(_rowToAssetRecord(row));
      }
    }
    return records;
  }

  /**
   * Finds every registered tag whose authoritative hash is in the given set
   * (reverse lookup — maps cached content hashes back to manifest tags).
   * Chunked to keep the IN clause bounded.
   */
  async findIdsByHashes(hashes: readonly string[]): Promise<string[]> {
    const ids: string[] = [];
    const chunkSize = 500;
    for (let start = 0; start < hashes.length; start += chunkSize) {
      const chunk = hashes.slice(start, start + chunkSize);
      if (chunk.length === 0) {
        continue;
      }
      const placeholders = chunk.map(() => '?').join(', ');
      const result = await this._db.query({
        sql: `SELECT id FROM assets WHERE hash IN (${placeholders})`,
        args: [...chunk],
      });
      for (const row of result.rows) {
        ids.push(row.id as string);
      }
    }
    return ids;
  }

  /** Lists candidate download origins for an asset, ordered by priority. */
  async listSources(assetId: string): Promise<AssetSource[]> {
    const result = await this._db.query({
      sql: 'SELECT asset_id, backend, url, priority FROM asset_sources WHERE asset_id = ? ORDER BY priority ASC, backend ASC',
      args: [assetId],
    });
    return result.rows.map(_rowToAssetSource);
  }

  /**
   * Adds (or repairs) an `r2` fallback download origin for every seeded
   * asset (C-373 `asset_sources`): the content-addressed R2 public download
   * URL derived from the asset's SHA-256 hash (C-395 layout:
   * `assets/<hash[0:2]>/<hash>.<ext>`). Idempotent — `INSERT OR REPLACE` on
   * the (asset_id, backend) primary key.
   *
   * The AssetManager tries sources by priority: bundled (0) first, then the
   * R2 mirror (1) when the bundled path is unavailable. Assets are published
   * to the bucket under content-addressed keys — see C-395 for the publish
   * pipeline.
   *
   * Assets without a hash in the registry are skipped (never fabricate a
   * URL). Existing `r2` rows with stale (path-mirrored) URLs are rewritten
   * to the correct content-addressed URL on every boot.
   *
   * @param r2BaseUrl - R2 public base URL, e.g. `https://assets.bearlysleeping.com`.
   * @returns The number of source rows written.
   */
  async addR2Sources(r2BaseUrl: string): Promise<number> {
    // Select every seeded asset with its hash and bundled URL.
    // Assets without a hash are skipped — never fabricate a URL.
    const result = await this._db.query({
      sql: `SELECT s.asset_id, s.url, a.hash
            FROM asset_sources s
            JOIN assets a ON a.id = s.asset_id
            WHERE s.backend = ?
            AND a.hash IS NOT NULL`,
      args: [BUNDLED_SOURCE_BACKEND],
    });

    const base = r2BaseUrl.replace(/\/$/, '');
    const queries: { sql: string; args: unknown[] }[] = [];

    for (const row of result.rows) {
      const assetId = row.asset_id as string;
      const bundledUrl = row.url as string;
      const hash = row.hash as string;

      // Derive extension from the bundled URL (last segment after final dot).
      const lastSegment = bundledUrl.split('.').pop();
      const ext = lastSegment ? `.${lastSegment}` : '';
      const r2Url = `${base}/${r2ObjectKey({ hash, ext })}`;

      queries.push({
        sql: `INSERT OR REPLACE INTO asset_sources (asset_id, backend, url, priority)
              VALUES (?, 'r2', ?, 1)`,
        args: [assetId, r2Url],
      });
    }

    if (queries.length === 0) {
      return 0;
    }

    // Chunked like seeding — a single large transaction stalls WASM SQLite.
    for (let i = 0; i < queries.length; i += SEED_CHUNK_SIZE) {
      const chunk = queries.slice(i, i + SEED_CHUNK_SIZE);
      await this._db.transaction(chunk);

      // Yield between chunks to keep the WASM main thread responsive,
      // matching seedFromManifest's inter-chunk yielding behavior.
      if (i + SEED_CHUNK_SIZE < queries.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return queries.length;
  }

  // ── Install state ────────────────────────────────────────────────────

  /** Reads the installation status of an asset, or undefined when never downloaded. */
  async getInstallState(assetId: string): Promise<InstallStateRecord | undefined> {
    const result = await this._db.query({
      sql: 'SELECT asset_id, status, local_path, cached_hash, downloaded_at FROM install_state WHERE asset_id = ?',
      args: [assetId],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return _rowToInstallState(result.rows[0]);
  }

  /** Lists every install-state row (used for boot reconcile / LRU eviction). */
  async listInstallStates(): Promise<InstallStateRecord[]> {
    const result = await this._db.query({
      sql: 'SELECT asset_id, status, local_path, cached_hash, downloaded_at FROM install_state',
      args: [],
    });
    return result.rows.map(_rowToInstallState);
  }

  /** Upserts the installation status of an asset. */
  async setInstallState(record: InstallStateRecord): Promise<void> {
    await this._db.execute({
      sql: `INSERT INTO install_state (asset_id, status, local_path, cached_hash, downloaded_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(asset_id) DO UPDATE SET
              status = excluded.status,
              local_path = excluded.local_path,
              cached_hash = excluded.cached_hash,
              downloaded_at = excluded.downloaded_at`,
      args: [
        record.assetId,
        record.status,
        record.localPath ?? null,
        record.cachedHash ?? null,
        record.downloadedAt ?? null,
      ],
    });
  }

  /**
   * Lists cached install-state rows joined with their pack — used by the
   * AssetManager for LRU eviction under quota pressure. Non-core packs are
   * evicted oldest-downloaded-first.
   */
  async listCachedWithPack(): Promise<
    readonly { assetId: string; packId: string; cachedHash?: string; downloadedAt?: string }[]
  > {
    const result = await this._db.query({
      sql: `SELECT i.asset_id, a.pack_id, i.cached_hash, i.downloaded_at
            FROM install_state i
            JOIN assets a ON a.id = i.asset_id
            WHERE i.status = 'cached'`,
      args: [],
    });
    return result.rows.map((row) => ({
      assetId: row.asset_id as string,
      packId: row.pack_id as string,
      cachedHash: (row.cached_hash as string | null) ?? undefined,
      downloadedAt: (row.downloaded_at as string | null) ?? undefined,
    }));
  }

  /**
   * Resets interrupted downloads ('downloading' rows) back to
   * 'not_downloaded' so retries are safe and idempotent. Called at boot.
   *
   * @returns The number of rows reconciled.
   */
  async resetInterruptedDownloads(): Promise<number> {
    const affected = await this._db.query({
      sql: "SELECT COUNT(*) AS count FROM install_state WHERE status = 'downloading'",
      args: [],
    });
    const count = (affected.rows[0]?.count as number | undefined) ?? 0;
    if (count > 0) {
      // Single UPDATE — no per-row setInstallState loop.
      await this._db.execute({
        sql: "UPDATE install_state SET status = 'not_downloaded' WHERE status = 'downloading'",
        args: [],
      });
      logger.debug('AssetRegistryRepository.resetInterruptedDownloads', { count });
    }
    return count;
  }

  // ── Meta guard ───────────────────────────────────────────────────────

  /** Reads a value from the `meta` key/value store. */
  async getMeta(key: string): Promise<string | undefined> {
    const result = await this._db.query({
      sql: 'SELECT value FROM meta WHERE key = ?',
      args: [key],
    });
    if (result.rows.length === 0) {
      return undefined;
    }
    return result.rows[0].value as string;
  }

  /** Writes a value to the `meta` key/value store. */
  async setMeta(key: string, value: string): Promise<void> {
    await this._db.execute({
      sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      args: [key, value],
    });
  }

  /**
   * Whether the registry has already been seeded with the given manifest
   * revision. Idempotency guard keyed off `meta.asset_registry_seeded`.
   */
  async isSeeded(scannedAt: string): Promise<boolean> {
    const seeded = await this.getMeta(ASSET_REGISTRY_SEEDED_KEY);
    return seeded === scannedAt;
  }

  // ── Seeding ──────────────────────────────────────────────────────────

  /**
   * Seeds (or re-seeds) the registry from the bootstrap manifest + sidecar.
   *
   * - One `assets` row per manifest tag that has a sidecar hash entry.
   * - One `asset_sources` row per asset — `backend='bundled'`, priority 0,
   *   URL derived from the manifest entry path (`/game-data/<path>`).
   * - Tags missing from the sidecar are skipped — never seeded (`assets.hash`
   *   is NOT NULL and must never be fabricated).
   * - Upsert-by-id, chunked into {@link SEED_CHUNK_SIZE}-row transactions with
   *   a yield between chunks so WASM SQLite never stalls.
   * - `version` starts at 1 and increments when a re-seed observes a changed
   *   hash; unchanged rows are not touched.
   * - On success, records `meta.asset_registry_seeded = manifest.scannedAt`.
   *
   * @param options - Manifest + hash sidecar.
   * @returns Per-action counters + hash-change list (cache eviction candidates).
   */
  async seedFromManifest(options: {
    manifest: AssetManifest;
    hashes: AssetHashesFile;
    onProgress?: (progress: { chunk: number; totalChunks: number }) => void;
  }): Promise<AssetSeedStats> {
    const { manifest, hashes, onProgress } = options;

    // Tags without a sidecar hash entry are skipped — never seeded.
    const seedableTags = Object.keys(manifest.assets).filter(
      (tag) => hashes.hashes[tag] !== undefined,
    );

    const hashChanges: { id: string; oldHash: string; newHash: string }[] = [];
    const stats: AssetSeedStats = {
      seeded: 0,
      updated: 0,
      unchanged: 0,
      skipped: Object.keys(manifest.assets).length - seedableTags.length,
      hashChanges,
    };

    const t0 = performance.now();
    let chunkStart = 0;
    const totalChunks = Math.ceil(seedableTags.length / SEED_CHUNK_SIZE);

    while (chunkStart < seedableTags.length) {
      const chunk = seedableTags.slice(chunkStart, chunkStart + SEED_CHUNK_SIZE);
      await this._seedChunk({ manifest, hashes, tags: chunk, stats, hashChanges });
      chunkStart += SEED_CHUNK_SIZE;

      onProgress?.({ chunk: Math.ceil(chunkStart / SEED_CHUNK_SIZE), totalChunks });

      if (chunkStart < seedableTags.length) {
        // Yield between chunks — keeps the WASM main thread responsive.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Only mark seeded when every chunk committed.
    await this.setMeta(ASSET_REGISTRY_SEEDED_KEY, manifest.scannedAt);

    logger.debug('AssetRegistryRepository.seedFromManifest:complete', {
      ...stats,
      chunks: totalChunks,
      elapsedMs: Math.round(performance.now() - t0),
    });
    return stats;
  }

  /** Seeds one chunk of tags inside a single transaction. */
  private async _seedChunk(options: {
    manifest: AssetManifest;
    hashes: AssetHashesFile;
    tags: readonly string[];
    stats: AssetSeedStats;
    hashChanges: { id: string; oldHash: string; newHash: string }[];
  }): Promise<void> {
    const { manifest, hashes, tags, stats, hashChanges } = options;

    // Load existing rows for this chunk to compute version bumps.
    const placeholders = tags.map(() => '?').join(', ');
    const existingResult = await this._db.query({
      sql: `SELECT id, hash, version FROM assets WHERE id IN (${placeholders})`,
      args: [...tags],
    });
    const existingById = new Map<string, { hash: string; version: number }>();
    for (const row of existingResult.rows) {
      existingById.set(row.id as string, {
        hash: row.hash as string,
        version: row.version as number,
      });
    }

    const queries: { sql: string; args: readonly unknown[] }[] = [];

    for (const tag of tags) {
      const entry = manifest.assets[tag];
      const hashEntry = hashes.hashes[tag];
      if (!entry || !hashEntry) {
        continue;
      }

      const existing = existingById.get(tag);
      let version: number;
      if (existing) {
        version = existing.hash === hashEntry.hash ? existing.version : existing.version + 1;
      } else {
        version = 1;
      }

      if (existing && existing.hash === hashEntry.hash) {
        stats.unchanged += 1;
      } else if (existing) {
        stats.updated += 1;
        hashChanges.push({ id: tag, oldHash: existing.hash, newHash: hashEntry.hash });
      } else {
        stats.seeded += 1;
      }

      queries.push({
        sql: `INSERT INTO assets (id, pack_id, category, hash, version, size_bytes, license, attribution, tags_json)
              VALUES (?, ?, ?, ?, ?, ?, 'unknown', NULL, '[]')
              ON CONFLICT(id) DO UPDATE SET
                pack_id = excluded.pack_id,
                category = excluded.category,
                hash = excluded.hash,
                version = excluded.version,
                size_bytes = excluded.size_bytes`,
        args: [tag, entry.category, entry.category, hashEntry.hash, version, hashEntry.sizeBytes],
      });

      queries.push({
        sql: `INSERT OR REPLACE INTO asset_sources (asset_id, backend, url, priority)
              VALUES (?, ?, ?, 0)`,
        args: [tag, BUNDLED_SOURCE_BACKEND, `${BUNDLED_ASSET_BASE}/${entry.path}`],
      });
    }

    if (queries.length > 0) {
      await this._db.transaction(queries);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an {@link AssetRegistryRepository} over the given shared database.
 *
 * @param db - The shared LocalDatabaseInterface connection (from `getLocalDatabase`).
 * @returns A ready-to-use registry repository.
 */
export const createAssetRegistryRepository = (
  db: LocalDatabaseInterface,
): AssetRegistryRepository => new AssetRegistryRepository(db);

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

/** Maps an `assets` table row (snake_case) to an {@link AssetRecord}. */
const _rowToAssetRecord = (row: QueryResultRow): AssetRecord => {
  const tagsJson = row.tags_json as string | null;
  let tags: string[] | undefined;
  if (tagsJson) {
    try {
      tags = JSON.parse(tagsJson) as string[];
    } catch {
      tags = [];
    }
  }
  return {
    id: row.id as string,
    packId: row.pack_id as string,
    category: row.category as string,
    hash: row.hash as string,
    version: row.version as number,
    sizeBytes: row.size_bytes as number,
    license: row.license as string,
    attribution: (row.attribution as string | null) ?? undefined,
    tags,
  };
};

/** Maps an `asset_sources` table row to an {@link AssetSource}. */
const _rowToAssetSource = (row: QueryResultRow): AssetSource => ({
  assetId: row.asset_id as string,
  backend: row.backend as AssetSource['backend'],
  url: row.url as string,
  priority: row.priority as number,
});

/** Maps an `install_state` table row to an {@link InstallStateRecord}. */
const _rowToInstallState = (row: QueryResultRow): InstallStateRecord => ({
  assetId: row.asset_id as string,
  status: row.status as InstallStateRecord['status'],
  localPath: (row.local_path as string | null) ?? undefined,
  cachedHash: (row.cached_hash as string | null) ?? undefined,
  downloadedAt: (row.downloaded_at as string | null) ?? undefined,
});
