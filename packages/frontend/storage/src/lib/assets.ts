// packages/frontend/storage/src/lib/assets.ts
//
// C-373: AssetRegistryRepository — Turso-backed asset registry over the
// shared LocalDatabaseInterface. Owns the `assets`, `asset_sources`, and
// `install_state` tables (created by schema migration v1, C-384) and
// provides batched, idempotent seeding from the compact boot seed (C-435).
//
// The registry is metadata-only: raw binaries never touch SQLite rows.
// Cache backends (OPFS / Tauri FS) are managed by the client AssetManager.

import { OFFLINE_CORE_PACK_ID, r2AssetUrl } from '@aikami/constants';
import type {
  AssetRecord,
  AssetSeedDocument,
  AssetSeedRow,
  AssetSource,
  InstallStateRecord,
} from '@aikami/types';
import { logger } from '$logger';
import type { LocalDatabaseInterface, QueryResultRow } from './storage_adapter.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Meta key recording the seed fingerprint the registry was last seeded with. */
export const ASSET_REGISTRY_SEEDED_KEY = 'asset_registry_seeded';

/**
 * Bumped whenever the *derivation* of `asset_sources` changes, independently of
 * the seed document's own `generatedAt`. A client shipping a source-derivation
 * fix must re-derive rows even against a seed it has already ingested, so the
 * idempotency guard is keyed on both.
 */
const SEED_DERIVATION_REVISION = 2;

/** Idempotency fingerprint for a seed document under the current derivation. */
const seedFingerprint = (generatedAt: string): string =>
  `${generatedAt}#r${SEED_DERIVATION_REVISION}`;

/** Rows per seeding transaction — large single transactions stall WASM SQLite. */
export const SEED_CHUNK_SIZE = 500;

/** Backend identifier for assets that ship inside the client. */
export const BUNDLED_SOURCE_BACKEND = 'bundled' as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outcome counters from a single {@link AssetRegistryRepository.seedFromCompactSeed} run. */
export type AssetSeedStats = {
  /** New asset rows inserted. */
  seeded: number;
  /** Existing rows whose hash/metadata changed (version bumped). */
  updated: number;
  /** Existing rows already current — no write needed. */
  unchanged: number;
  /** Seed rows skipped as unusable. Always 0 for the compact seed. */
  skipped: number;
  /** Assets whose authoritative hash advanced — cache invalidation candidates. */
  hashChanges: readonly { id: string; oldHash: string; newHash: string }[];
};

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Local registry of asset metadata + install state, persisted in the shared
 * Turso/libSQL database. Seeded idempotently from the compact boot seed
 * (`asset_seed.json`); queried by the client AssetManager to resolve asset
 * binaries through the local cache before falling back to network.
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
   * Whether the registry is already seeded from this seed document *under the
   * current source derivation*. Idempotency guard keyed off
   * `meta.asset_registry_seeded`.
   *
   * The fingerprint includes {@link SEED_DERIVATION_REVISION}, so a client that
   * ships a fix to how `asset_sources` rows are built re-seeds once even though
   * the seed document itself is unchanged.
   *
   * @param generatedAt - `generatedAt` of the seed document about to be applied.
   */
  async isSeeded(generatedAt: string): Promise<boolean> {
    const seeded = await this.getMeta(ASSET_REGISTRY_SEEDED_KEY);
    return seeded === seedFingerprint(generatedAt);
  }

  // ── Seeding ──────────────────────────────────────────────────────────

  /**
   * Seeds (or re-seeds) the registry from the compact boot seed document —
   * `assets` rows *and* their `asset_sources` rows, in one pass (C-435).
   *
   * Sources are derived here rather than in a follow-up pass because the
   * compact seed is the only place `ext` exists: the `assets` table does not
   * store it, so nothing downstream can rebuild an R2 key once the document
   * is gone.
   *
   * Every asset gets an `r2` source at priority 0 — nothing is bundled in the
   * client anymore (C-435 follow-up). Tags in `bundledTags` get `pack_id =
   * 'core'` so LRU eviction skips them; all other assets are packed by
   * category and may be evicted under quota pressure.
   *
   * Stale `bundled` source rows from a pre-C-435 registry are dropped (they
   * point at files no longer shipped, and at priority 0 they would 404 ahead
   * of the working source).
   *
   * Upsert-by-id, chunked into {@link SEED_CHUNK_SIZE}-row transactions with a
   * yield between chunks so WASM SQLite never stalls. `version` starts at 1 and
   * increments when a re-seed observes a changed hash; unchanged rows are not
   * touched. On success, records the seed fingerprint in
   * `meta.asset_registry_seeded`.
   *
   * @param options - Seed document, publish origin, offline-core tags, progress.
   * @returns Per-action counters + hash-change list (cache eviction candidates).
   */
  async seedFromCompactSeed(options: {
    /** The compact boot seed document. */
    seed: AssetSeedDocument;
    /**
     * R2 public base URL, e.g. `https://assets.bearlysleeping.com`. When
     * omitted no remote sources are written — only bundled assets resolve.
     */
    r2BaseUrl?: string;
    /** Tags that ship inside the client (the offline-core declaration). */
    bundledTags?: readonly string[];
    onProgress?: (progress: { chunk: number; totalChunks: number }) => void;
  }): Promise<AssetSeedStats> {
    const { seed, r2BaseUrl, bundledTags = [], onProgress } = options;
    const bundled = new Set(bundledTags);
    const r2Base = r2BaseUrl?.replace(/\/$/, '');

    const hashChanges: { id: string; oldHash: string; newHash: string }[] = [];
    const stats: AssetSeedStats = {
      seeded: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      hashChanges,
    };

    const t0 = performance.now();
    const totalChunks = Math.ceil(seed.rows.length / SEED_CHUNK_SIZE);
    let chunkStart = 0;

    while (chunkStart < seed.rows.length) {
      const chunk = seed.rows.slice(chunkStart, chunkStart + SEED_CHUNK_SIZE);
      await this._seedCompactChunk({ rows: chunk, bundled, r2Base, stats, hashChanges });
      chunkStart += SEED_CHUNK_SIZE;

      onProgress?.({ chunk: Math.ceil(chunkStart / SEED_CHUNK_SIZE), totalChunks });

      if (chunkStart < seed.rows.length) {
        // Yield between chunks — keeps the WASM main thread responsive.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Drop bundled rows for anything outside the core. A registry seeded before
    // C-435 has a priority-0 bundled row for every asset; those files no longer
    // ship, so leaving them makes every fetch try a 404 first.
    const staleBundled = await this._pruneBundledSources(bundled);

    // Only mark seeded when every chunk committed.
    await this.setMeta(ASSET_REGISTRY_SEEDED_KEY, seedFingerprint(seed.generatedAt));

    logger.debug('AssetRegistryRepository.seedFromCompactSeed:complete', {
      ...stats,
      chunks: totalChunks,
      bundledTags: bundled.size,
      staleBundledPruned: staleBundled,
      hasR2Origin: r2Base !== undefined,
      elapsedMs: Math.round(performance.now() - t0),
    });
    return stats;
  }

  /**
   * Deletes `bundled` source rows for every asset outside the offline core.
   *
   * @param bundled - Tags that legitimately keep a bundled source.
   * @returns The number of rows deleted.
   */
  /**
   * Prunes ALL stale bundled source rows. Nothing is bundled in the client
   * anymore (C-435 follow-up), so every `bundled` source from a pre-C-435
   * registry is removed regardless of the offline-core declaration.
   */
  private async _pruneBundledSources(_bundled: ReadonlySet<string>): Promise<number> {
    const before = await this._db.query({
      sql: `SELECT COUNT(*) AS n FROM asset_sources WHERE backend = ?`,
      args: [BUNDLED_SOURCE_BACKEND],
    });
    const count = Number(before.rows[0]?.n ?? 0);
    if (count === 0) {
      return 0;
    }

    await this._db.execute({
      sql: `DELETE FROM asset_sources WHERE backend = ?`,
      args: [BUNDLED_SOURCE_BACKEND],
    });
    return count;
  }

  /**
   * Seeds one chunk of compact seed rows — `assets` upsert plus the asset's
   * `asset_sources` rows — inside a single transaction.
   */
  private async _seedCompactChunk(options: {
    rows: readonly AssetSeedRow[];
    /** Tags in the offline core (bundled priority 0, never LRU-evicted). */
    bundled: ReadonlySet<string>;
    /** Trailing-slash-stripped R2 base URL, or undefined when no origin is set. */
    r2Base: string | undefined;
    stats: AssetSeedStats;
    hashChanges: { id: string; oldHash: string; newHash: string }[];
  }): Promise<void> {
    const { rows, bundled, r2Base, stats, hashChanges } = options;
    const tags = rows.map((row) => row.tag);

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

    for (const seedRow of rows) {
      const existing = existingById.get(seedRow.tag);
      let version: number;
      if (existing) {
        version = existing.hash === seedRow.hash ? existing.version : existing.version + 1;
      } else {
        version = 1;
      }

      if (existing && existing.hash === seedRow.hash) {
        stats.unchanged += 1;
      } else if (existing) {
        stats.updated += 1;
        hashChanges.push({ id: seedRow.tag, oldHash: existing.hash, newHash: seedRow.hash });
      } else {
        stats.seeded += 1;
      }

      const isCore = bundled.has(seedRow.tag);

      queries.push({
        sql: `INSERT INTO assets (id, pack_id, category, hash, version, size_bytes, license, attribution, tags_json)
              VALUES (?, ?, ?, ?, ?, ?, 'unknown', NULL, '[]')
              ON CONFLICT(id) DO UPDATE SET
                pack_id = excluded.pack_id,
                category = excluded.category,
                hash = excluded.hash,
                version = excluded.version,
                size_bytes = excluded.size_bytes`,
        args: [
          seedRow.tag,
          isCore ? OFFLINE_CORE_PACK_ID : seedRow.category,
          seedRow.category,
          seedRow.hash,
          version,
          seedRow.sizeBytes,
        ],
      });

      if (r2Base !== undefined) {
        const url = r2AssetUrl({ baseUrl: r2Base, hash: seedRow.hash, ext: seedRow.ext });
        queries.push({
          sql: `INSERT OR REPLACE INTO asset_sources (asset_id, backend, url, priority)
                VALUES (?, 'r2', ?, 0)`,
          // Every asset now resolves from R2 at priority 0 — nothing is bundled
          // in the client anymore (C-435 follow-up). The offline core (pack_id
          // 'core') is still eviction-protected in the local cache.
          args: [seedRow.tag, url],
        });
      }
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
