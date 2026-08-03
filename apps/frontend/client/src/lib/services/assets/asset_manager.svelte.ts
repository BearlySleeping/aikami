// apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts
//
// C-373: AssetManager — hybrid asset resolution: registry → cache → sources.
//
// Resolves asset tags through the Turso-backed registry, serves verified
// binaries from the content-hash-keyed cache backend (OPFS on Web,
// Tauri FS on Desktop), fetches + SHA-256-verifies on miss, tracks
// per-asset install state, evicts stale binaries when the registry hash
// advances, and hands callers refcounted blob: object URLs (revoked after
// decode via releaseUrl). Raw binaries never touch SQLite rows.
//
// The wrapped resolvers (asset_store.resolveUrl + LPC resolver wiring)
// call acquireUrl() synchronously (refcounted) and warm() in the
// background, so cached assets resolve with zero network traffic and
// uncached assets degrade to the C-372 static-URL fallback.

import { ASSET_CATEGORIES } from '@aikami/constants';
import type { AssetRegistryRepository } from '@aikami/frontend/repositories';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { sha256Hex } from './asset_hasher.ts';
import './blob_url_loader.ts';
import type { AssetCacheBackend } from './cache_backend.ts';
import { OpfsCacheBackend } from './opfs_cache_backend.ts';
import { TauriFSCacheBackend } from './tauri_fs_cache_backend.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Packs that are never LRU-evicted under quota pressure. In v1 every bundled
 * category (manifest category → pack_id) seeds as the eviction-protected core
 * pack per C-373 Resolved Decisions; future optional packs become evictable.
 */
const _EVICTION_PROTECTED_PACKS = new Set<string>(Object.keys(ASSET_CATEGORIES));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for constructing the {@link AssetManager}. */
export type AssetManagerOptions = BaseFrontendClassOptions;

/** Result of a reconcile pass. */
export type AssetReconcileResult = {
  /** Interrupted downloads reset to 'not_downloaded'. */
  interruptedReset: number;
  /** Stale cache entries evicted (hash mismatch vs registry). */
  staleEvicted: number;
};

export type AssetManagerInterface = BaseFrontendClassInterface & {
  /** Whether the manager has been initialized with registry + backend. */
  readonly isInitialized: boolean;
  /** Binds the registry + cache backend and pre-registers cached binaries. */
  initialize(options: {
    registry: AssetRegistryRepository;
    backend: AssetCacheBackend;
  }): Promise<void>;
  /**
   * Resolves an asset tag to a blob: URL, fetching + verifying + caching on
   * miss. Returns null when unresolvable (caller falls back to the static
   * manifest URL or the C-372 null fallback).
   */
  resolve(tag: string, options?: { signal?: AbortSignal }): Promise<string | null>;
  /** Synchronous lookup of a cached asset's blob URL (wrapped resolvers). */
  peekBlobUrl(tag: string): string | null;
  /**
   * Acquires a reference to a cached asset's blob URL (synchronous fast-path
   * for wrapped resolvers). Every returned URL is refcounted — callers must
   * release via {@link release} / {@link releaseUrl} when done, otherwise
   * the URL stays alive (never revoked while in use).
   */
  acquireUrl(tag: string): string | null;
  /** Fire-and-forget prefetch — same as resolve, safe to not await. */
  warm(tag: string): Promise<string | null>;
  /** Boot-time reconcile: reset interrupted downloads + evict stale binaries. */
  reconcile(): Promise<AssetReconcileResult>;
  /** Aborts an in-flight download for the given tag. */
  cancelDownload(tag: string): void;
  /** Releases a blob URL reference (refcounted; revoked at zero). */
  release(tag: string): void;
  /** Releases a blob URL by its URL string (post-decode revocation). */
  releaseUrl(url: string): void;
  /** Revokes all blob URLs and resets the manager. */
  teardown(): Promise<void>;
};

// ---------------------------------------------------------------------------
// AssetManager
// ---------------------------------------------------------------------------

/**
 * See {@link AssetManagerInterface}.
 */
class AssetManager extends BaseFrontendClass<AssetManagerOptions> implements AssetManagerInterface {
  /** Whether initialize() has completed. */
  isInitialized = false;

  /** The registry over the shared local DB. */
  private _registry: AssetRegistryRepository | null = null;

  /** The platform cache backend (OPFS or Tauri FS). */
  private _backend: AssetCacheBackend | null = null;

  /** Blob URLs keyed by tag — refcounted for post-decode revocation. */
  private readonly _blobUrls = new Map<string, { url: string; refs: number }>();

  /**
   * Verified tag → content-hash mappings recorded during initialize()
   * rehydration. Kept separate from {@link _blobUrls} so rehydration never
   * needs to materialise object URLs eagerly; resolve() materialises lazily
   * on first access for any tag whose backend file was missing at boot.
   */
  private readonly _verifiedHashes = new Map<string, string>();

  /** Reverse lookup: blob URL → tag. */
  private readonly _urlToTag = new Map<string, string>();

  /** In-flight resolve promises keyed by tag (dedupe concurrent requests). */
  private readonly _inflight = new Map<string, Promise<string | null>>();

  /** AbortControllers for in-flight downloads keyed by tag. */
  private readonly _abortControllers = new Map<string, AbortController>();

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** @inheritdoc */
  async initialize(options: {
    registry: AssetRegistryRepository;
    backend: AssetCacheBackend;
  }): Promise<void> {
    // Idempotent across boots — drop any state from a previous session.
    await this.teardown();

    this._registry = options.registry;
    this._backend = options.backend;
    this.isInitialized = true;

    // Rehydrate verified cached binaries so offline reloads resolve instantly
    // (synchronous acquireUrl/peekBlobUrl) without touching the network.
    // Queries are BATCHED (one listInstallStates + one findByIds, one
    // listHashes + one findIdsByHashes) — no per-entry DB fan-out.
    let registered = 0;
    const states = await this._registry.listInstallStates();
    const stateById = new Map(states.map((state) => [state.assetId, state]));
    const cachedStates = states.filter(
      (state) => state.status === 'cached' && state.cachedHash !== undefined,
    );
    const recordsById = new Map(
      (await this._registry.findByIds(cachedStates.map((state) => state.assetId))).map(
        (record) => [record.id, record] as const,
      ),
    );

    // Known-downloaded set: the registry hash must still match the recorded
    // cachedHash before the binary is served (stale rows are left for
    // reconcile()). Blob URLs are materialised eagerly for this set — the
    // engine resolves through a synchronous resolver, so offline first-access
    // needs the URL ready before the first resolveUrl() call.
    for (const state of cachedStates) {
      const record = recordsById.get(state.assetId);
      if (!record || record.hash !== state.cachedHash) {
        continue;
      }
      this._verifiedHashes.set(state.assetId, state.cachedHash);
      const blob = await this._backend.get(state.cachedHash);
      if (blob) {
        this._registerBlobUrl(state.assetId, blob);
        registered += 1;
      }
    }

    // Content-addressed rehydration: even when install_state bookkeeping was
    // lost (e.g. an in-memory DB fallback across reloads), hash-named files
    // in the cache are authoritative. Reverse-map them to registry tags,
    // register blob URLs, and repair the bookkeeping — all batched.
    const cachedHashes = await this._backend.listHashes().catch(() => [] as string[]);
    if (cachedHashes.length > 0) {
      const ids = await this._registry.findIdsByHashes(cachedHashes);
      const records = await this._registry.findByIds(ids);
      for (const record of records) {
        this._verifiedHashes.set(record.id, record.hash);
        const blob = await this._backend.get(record.hash);
        if (blob) {
          if (!this._blobUrls.has(record.id)) {
            this._registerBlobUrl(record.id, blob);
            registered += 1;
          }
          const state = stateById.get(record.id);
          if (state?.status !== 'cached') {
            await this._registry.setInstallState({
              assetId: record.id,
              status: 'cached',
              cachedHash: record.hash,
              localPath: record.hash,
              downloadedAt: state?.downloadedAt ?? new Date().toISOString(),
            });
          }
        }
      }
    }

    this.debug('asset_manager:initialized', { cachedRows: states.length, registered });
  }

  /** @inheritdoc */
  async teardown(): Promise<void> {
    for (const [tag, entry] of this._blobUrls) {
      this._revokeUrl(tag, entry.url);
    }
    this._blobUrls.clear();
    this._urlToTag.clear();
    this._verifiedHashes.clear();
    this._inflight.clear();
    this._abortControllers.clear();
    this._registry = null;
    this._backend = null;
    this.isInitialized = false;
  }

  // ── Resolution ───────────────────────────────────────────────────────

  /** @inheritdoc */
  peekBlobUrl(tag: string): string | null {
    return this._blobUrls.get(tag)?.url ?? null;
  }

  /** @inheritdoc */
  acquireUrl(tag: string): string | null {
    const entry = this._blobUrls.get(tag);
    if (!entry) {
      return null;
    }
    entry.refs += 1;
    return entry.url;
  }

  /** @inheritdoc */
  warm(tag: string): Promise<string | null> {
    return this.resolve(tag);
  }

  /** @inheritdoc */
  async resolve(tag: string, options?: { signal?: AbortSignal }): Promise<string | null> {
    if (!this.isInitialized) {
      return null;
    }

    // Dedupe concurrent resolves for the same tag.
    const inFlight = this._inflight.get(tag);
    if (inFlight) {
      return inFlight;
    }

    const promise = this._doResolve(tag, options?.signal);
    this._inflight.set(tag, promise);
    try {
      const url = await promise;
      if (url) {
        // Every returned URL holds one reference for THIS caller. The
        // _inflight promise is shared by concurrent resolvers, so each of
        // them must acquire — otherwise a sibling's release() could revoke
        // a URL that is still in use.
        const entry = this._blobUrls.get(tag);
        if (entry) {
          entry.refs += 1;
        }
      }
      return url;
    } finally {
      this._inflight.delete(tag);
    }
  }

  /** @inheritdoc */
  cancelDownload(tag: string): void {
    const controller = this._abortControllers.get(tag);
    controller?.abort();
  }

  // ── Reconcile (AC-3) ─────────────────────────────────────────────────

  /** @inheritdoc */
  async reconcile(): Promise<AssetReconcileResult> {
    if (!this._registry || !this._backend) {
      return { interruptedReset: 0, staleEvicted: 0 };
    }

    const interruptedReset = await this._registry.resetInterruptedDownloads();

    // Evict binaries whose cached hash no longer matches the registry
    // (a new build bumped the sidecar) — AC-3 stale eviction.
    let staleEvicted = 0;
    const states = await this._registry.listInstallStates();
    for (const state of states) {
      if (state.status !== 'cached' || !state.cachedHash) {
        continue;
      }
      const record = await this._registry.findById(state.assetId);
      if (!record || record.hash === state.cachedHash) {
        continue;
      }
      await this._backend.remove(state.cachedHash);
      await this._registry.setInstallState({
        assetId: state.assetId,
        status: 'stale',
        cachedHash: state.cachedHash,
        localPath: state.localPath,
        downloadedAt: state.downloadedAt,
      });
      this.warn('asset_manager:reconcile:stale-evicted', {
        assetId: state.assetId,
        oldHash: state.cachedHash,
        newHash: record.hash,
      });
      staleEvicted += 1;
    }

    this.debug('asset_manager:reconcile:complete', { interruptedReset, staleEvicted });
    return { interruptedReset, staleEvicted };
  }

  // ── Blob URL refcounting ─────────────────────────────────────────────

  /** @inheritdoc */
  release(tag: string): void {
    const entry = this._blobUrls.get(tag);
    if (!entry) {
      return;
    }
    entry.refs -= 1;
    if (entry.refs <= 0) {
      this._blobUrls.delete(tag);
      this._urlToTag.delete(entry.url);
      this._revokeUrl(tag, entry.url);
    }
  }

  /** @inheritdoc */
  releaseUrl(url: string): void {
    const tag = this._urlToTag.get(url);
    if (tag) {
      this.release(tag);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  /** Full resolve pipeline for a single tag. */
  private async _doResolve(tag: string, externalSignal?: AbortSignal): Promise<string | null> {
    const registry = this._registry;
    const backend = this._backend;
    if (!registry || !backend) {
      return null;
    }

    // 1. Already registered → serve the existing blob URL. (The caller's
    //    reference is acquired by resolve(), not here, so concurrent
    //    inflight-shared callers each hold their own ref.)
    const existing = this._blobUrls.get(tag);
    if (existing) {
      return existing.url;
    }

    // 1b. Rehydration recorded a verified tag→hash mapping but the blob URL
    //     was not materialised (e.g. the backend file was missing at boot) —
    //     materialise lazily on first access.
    const verifiedHash = this._verifiedHashes.get(tag);
    if (verifiedHash) {
      this._verifiedHashes.delete(tag);
      const blob = await backend.get(verifiedHash);
      if (blob) {
        const state = await registry.getInstallState(tag);
        if (state?.status !== 'cached') {
          await registry.setInstallState({
            assetId: tag,
            status: 'cached',
            cachedHash: verifiedHash,
            localPath: verifiedHash,
            downloadedAt: state?.downloadedAt ?? new Date().toISOString(),
          });
        }
        const url = this._registerBlobUrl(tag, blob);
        this.debug('asset_manager:lazy-materialised', { assetId: tag });
        return url;
      }
    }

    // 2. Registry row — unknown tags fall back to the static manifest URL.
    const record = await registry.findById(tag);
    if (!record) {
      this.debug('asset_manager:unregistered', { assetId: tag });
      return null;
    }

    const t0 = performance.now();
    const state = await registry.getInstallState(tag);

    // 3. Cache hit: the backend holds the authoritative hash. The content
    //    hash IS the cache key, so presence alone is sufficient — even when
    //    install_state bookkeeping is missing (e.g. an in-memory DB fallback
    //    lost the rows). Target: <10ms/item.
    const cachedHash = state?.status === 'cached' ? state.cachedHash : record.hash;
    if (cachedHash === record.hash && (await backend.has(record.hash))) {
      const blob = await backend.get(record.hash);
      if (blob) {
        if (state?.status !== 'cached') {
          await registry.setInstallState({
            assetId: tag,
            status: 'cached',
            cachedHash: record.hash,
            localPath: record.hash,
            downloadedAt: new Date().toISOString(),
          });
        }
        const url = this._registerBlobUrl(tag, blob);
        this.debug('asset_manager:cache-hit', {
          assetId: tag,
          ms: Math.round(performance.now() - t0),
        });
        return url;
      }
      // Backend lost the file — fall through and re-fetch.
    }

    // 4. Stale entry: backend has an old hash → evict it now.
    if (state?.cachedHash && state.cachedHash !== record.hash) {
      await backend.remove(state.cachedHash);
      await registry.setInstallState({
        assetId: tag,
        status: 'stale',
        cachedHash: state.cachedHash,
        localPath: state.localPath,
        downloadedAt: state.downloadedAt,
      });
      this.warn('asset_manager:stale-evicted', {
        assetId: tag,
        oldHash: state.cachedHash,
        newHash: record.hash,
      });
    }

    // 5. Fetch from sources (highest priority first), verify, cache, serve.
    const sources = await registry.listSources(tag);
    if (sources.length === 0) {
      return null;
    }
    const sorted = [...sources].sort((a, b) => a.priority - b.priority);

    const controller = externalSignal ? undefined : new AbortController();
    const signal = externalSignal ?? controller?.signal;
    if (controller) {
      this._abortControllers.set(tag, controller);
    }

    try {
      await registry.setInstallState({
        assetId: tag,
        status: 'downloading',
        downloadedAt: new Date().toISOString(),
      });

      for (const source of sorted) {
        if (signal?.aborted) {
          return null;
        }
        try {
          const response = await fetch(source.url, { signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
          }
          const blob = await response.blob();

          // Verify SHA-256 against the registry hash BEFORE caching/serving.
          const actualHash = await sha256Hex(blob);
          if (actualHash !== record.hash) {
            this.warn('asset_manager:hash-mismatch', {
              assetId: tag,
              expected: record.hash,
              actual: actualHash,
              source: source.url,
            });
            continue; // discard — try the next source
          }

          // Cache unavailable (e.g. OPFS init failed) — serve online without
          // persisting. The game keeps working; caching retries next boot.
          if (!backend.isAvailable) {
            const url = this._registerBlobUrl(tag, blob);
            this.debug('asset_manager:cache-disabled', { assetId: tag });
            return url;
          }

          try {
            await backend.put({ hash: record.hash, blob });
          } catch (putError) {
            if (!this._isQuotaError(putError)) {
              throw putError;
            }
            this.warn('asset_manager:quota-exceeded', { assetId: tag });
            const evicted = await this._evictLru();
            if (evicted) {
              // Retry the put once after LRU eviction.
              await backend.put({ hash: record.hash, blob });
            } else {
              await registry.setInstallState({ assetId: tag, status: 'not_downloaded' });
              return null;
            }
          }

          await registry.setInstallState({
            assetId: tag,
            status: 'cached',
            cachedHash: record.hash,
            localPath: record.hash,
            downloadedAt: new Date().toISOString(),
          });
          const url = this._registerBlobUrl(tag, blob);
          this.debug('asset_manager:cache-store', {
            assetId: tag,
            ms: Math.round(performance.now() - t0),
            sizeBytes: blob.size,
          });
          return url;
        } catch (error) {
          if (signal?.aborted) {
            // Interrupted download — leave 'downloading'; reconciled at boot.
            this.debug('asset_manager:cancelled', { assetId: tag });
            return null;
          }
          this.warn('asset_manager:source-failed', {
            assetId: tag,
            source: source.url,
            error: String(error),
          });
        }
      }

      // Every source failed — reset so the next request retries cleanly.
      await registry.setInstallState({ assetId: tag, status: 'not_downloaded' });
      return null;
    } finally {
      if (controller) {
        this._abortControllers.delete(tag);
      }
    }
  }

  /**
   * Evicts the least-recently-downloaded non-core cached asset to free
   * quota. In v1 every bundled pack is core — nothing is evictable, so this
   * logs and returns false (the asset stays not_downloaded).
   *
   * @returns True when an entry was evicted (caller may retry the put).
   */
  private async _evictLru(): Promise<boolean> {
    const registry = this._registry;
    const backend = this._backend;
    if (!registry || !backend) {
      return false;
    }

    const cached = await registry.listCachedWithPack();
    const evictable = cached
      .filter((entry) => entry.packId && !_EVICTION_PROTECTED_PACKS.has(entry.packId))
      .sort((a, b) => (a.downloadedAt ?? '').localeCompare(b.downloadedAt ?? ''));

    const victim = evictable[0];
    if (!victim?.cachedHash) {
      this.warn('asset_manager:quota:no-evictable-packs', {
        message: 'All cached packs are core — leaving the asset not_downloaded.',
      });
      return false;
    }

    await backend.remove(victim.cachedHash);
    await registry.setInstallState({
      assetId: victim.assetId,
      status: 'stale',
      cachedHash: victim.cachedHash,
      downloadedAt: victim.downloadedAt,
    });
    this.warn('asset_manager:quota:lru-evicted', {
      assetId: victim.assetId,
      packId: victim.packId,
      hash: victim.cachedHash,
    });
    return true;
  }

  /**
   * Registers a blob URL for a tag (refs start at 0 — the caller acquires
   * via resolve()/acquireUrl()). Returns the existing URL when already
   * registered, without touching its refcount.
   */
  private _registerBlobUrl(tag: string, blob: Blob): string {
    const existing = this._blobUrls.get(tag);
    if (existing) {
      return existing.url;
    }
    const url = _createObjectUrl(blob);
    this._blobUrls.set(tag, { url, refs: 0 });
    this._urlToTag.set(url, tag);
    return url;
  }

  /** Revokes a blob URL (guarded for non-browser test envs). */
  private _revokeUrl(_tag: string, url: string): void {
    if (url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  }

  /** Detects QuotaExceededError across environments. */
  private _isQuotaError(error: unknown): boolean {
    if (error instanceof DOMException) {
      return error.name === 'QuotaExceededError';
    }
    return (error as Error | undefined)?.name === 'QuotaExceededError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an object URL for a blob. Falls back to a deterministic mock URL
 * in environments without URL.createObjectURL (Bun unit tests) so tag→URL
 * identity is still testable.
 */
const _createObjectUrl = (blob: Blob): string => {
  if (typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(blob);
  }
  return `blob:mock-${blob.size}`;
};

/**
 * Selects the platform cache backend: Tauri native disk on desktop,
 * OPFS in the webview/browser.
 */
export const createPlatformCacheBackend = (): AssetCacheBackend => {
  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
  return isTauri ? new TauriFSCacheBackend() : new OpfsCacheBackend();
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Shared AssetManager singleton (registry + cache resolution). */
export const assetManager: AssetManagerInterface = AssetManager.create({
  className: 'AssetManager',
});
