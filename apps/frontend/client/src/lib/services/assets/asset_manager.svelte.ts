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

import { OFFLINE_CORE_PACK_ID } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { AssetRegistryRepository } from '@aikami/frontend/storage';
import { sha256Hex } from './asset_hasher.ts';
import './blob_url_loader.ts';
import { withStepTimeout } from '$lib/utils/step_timeout';
import type { AssetCacheBackend } from './cache_backend.ts';
import { OpfsCacheBackend } from './opfs_cache_backend.ts';
import { TauriFSCacheBackend } from './tauri_fs_cache_backend.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Packs that are never LRU-evicted under quota pressure (C-435).
 *
 * Exactly one: the offline core. `seedFromCompactSeed` packs every tag in the
 * offline-core declaration as {@link OFFLINE_CORE_PACK_ID} and everything else
 * by category, so the guard is a single pack id rather than a category list.
 * Listing categories here would protect all 12,699 LPC assets and defeat LRU
 * entirely — the opposite of what the contract asks for.
 */
const _EVICTION_PROTECTED_PACKS = new Set<string>([OFFLINE_CORE_PACK_ID]);

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
    /** Tags to eagerly materialise; everything else resolves lazily. */
    coreTags?: ReadonlySet<string>;
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
  /**
   * Ceiling for a single DB/backend call during initialize(). Well under the
   * caller's own 20s step budget so the inner, more specific name wins.
   */
  private static readonly _stepTimeoutMs = 8_000;

  /**
   * How many rehydration fetches run concurrently during initialize().
   *
   * Each cached asset needs its own backend.get() round trip, and on Tauri
   * desktop that's an IPC call to Rust. A large offline-core catalog
   * (10k+ entries) run one-at-a-time blows the caller's 20s step budget even
   * though each individual call is fast — the IPC round-trip overhead is
   * cumulative, not per-item-slow. Running them in bounded-concurrency
   * batches instead of fully sequential keeps wall time roughly
   * proportional to catalog-size / this value.
   *
   * Measured on a 12,726-row catalog (real Tauri desktop hardware, 2026-08-27):
   * 24 in flight completed in 16.6s — under the 20s budget, but close enough
   * that IPC timing variance seen elsewhere (26ms-120ms for a single
   * listHashes() call across runs) could tip it over. Raised for margin;
   * revisit if this proves too aggressive for the IPC channel.
   */
  private static readonly _rehydrateConcurrency = 64;

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
    /**
     * Tags that must resolve synchronously from the first frame (the
     * offline-core set, ~16 tags — see {@link OFFLINE_CORE_PACK_ID}).
     *
     * Only these get their blob URL eagerly materialised during
     * rehydration below. Every other cached tag — the bulk of a real
     * catalog (10k+ downloaded entries) — is left as a verified hash only
     * and lazily materialised on first actual access via
     * {@link AssetManager._doResolve} step 1b. Eagerly fetching all of them
     * at every boot was one IPC round trip per cached blob with no
     * aggregate cap: harmless at Web-OPFS scale, but a real Tauri desktop
     * catalog (12k+ entries) blew the boot pipeline's 20s budget because
     * the IPC channel has a fixed per-call floor that concurrency cannot
     * shrink (raising in-flight calls from 24 to 64 made no measurable
     * difference — confirmed 2026-08-27, 16.6s either way).
     *
     * Omit to eagerly materialise everything (legacy behaviour) — used by
     * tests that don't wire a real core-tags set.
     */
    coreTags?: ReadonlySet<string>;
  }): Promise<void> {
    // Idempotent across boots — drop any state from a previous session.
    await this.teardown();

    this._registry = options.registry;
    this._backend = options.backend;
    this.isInitialized = true;
    const isCoreTag = (tag: string): boolean => options.coreTags?.has(tag) ?? true;

    // Rehydrate verified cached binaries so offline reloads resolve instantly
    // (synchronous acquireUrl/peekBlobUrl) without touching the network.
    // Queries are BATCHED (one listInstallStates + one findByIds, one
    // listHashes + one findIdsByHashes) — no per-entry DB fan-out.
    // Each await below is wrapped so a stall names itself: these run against
    // the local DB and the platform cache backend, both of which can block
    // indefinitely in a webview (in-memory SQLite snapshotting to IndexedDB,
    // Tauri FS calls over IPC) without ever rejecting.
    const registry = this._registry;
    const backend = this._backend;
    let registered = 0;
    const states = await withStepTimeout({
      name: 'registry.listInstallStates',
      timeoutMs: AssetManager._stepTimeoutMs,
      run: () => registry.listInstallStates(),
    });
    const stateById = new Map(states.map((state) => [state.assetId, state]));
    const cachedStates = states.filter(
      (state) => state.status === 'cached' && state.cachedHash !== undefined,
    );
    const recordsById = new Map(
      (
        await withStepTimeout({
          name: 'registry.findByIds(cached)',
          timeoutMs: AssetManager._stepTimeoutMs,
          run: () => registry.findByIds(cachedStates.map((state) => state.assetId)),
        })
      ).map((record) => [record.id, record] as const),
    );

    // Known-downloaded set: the registry hash must still match the recorded
    // cachedHash before the binary is served (stale rows are left for
    // reconcile()). Blob URLs are materialised eagerly for this set — the
    // engine resolves through a synchronous resolver, so offline first-access
    // needs the URL ready before the first resolveUrl() call.
    await AssetManager._forEachConcurrent(
      cachedStates,
      AssetManager._rehydrateConcurrency,
      async (state) => {
        const record = recordsById.get(state.assetId);
        if (!record || record.hash !== state.cachedHash) {
          return;
        }
        this._verifiedHashes.set(state.assetId, state.cachedHash);
        if (!isCoreTag(state.assetId)) {
          // Non-core: verified hash is enough. Blob URL materialises lazily
          // on first actual access (_doResolve step 1b) instead of costing
          // an IPC round trip here for a tag that may never be used.
          return;
        }
        const blob = await withStepTimeout({
          name: 'backend.get(cachedState)',
          timeoutMs: AssetManager._stepTimeoutMs,
          run: () => backend.get(state.cachedHash as string),
        });
        if (blob) {
          this._registerBlobUrl(state.assetId, blob);
          registered += 1;
        }
      },
    );

    // Content-addressed rehydration: even when install_state bookkeeping was
    // lost (e.g. an in-memory DB fallback across reloads), hash-named files
    // in the cache are authoritative. Reverse-map them to registry tags,
    // register blob URLs, and repair the bookkeeping — all batched.
    const cachedHashes = await withStepTimeout({
      name: 'backend.listHashes',
      timeoutMs: AssetManager._stepTimeoutMs,
      run: () => backend.listHashes(),
    }).catch(() => [] as string[]);
    if (cachedHashes.length > 0) {
      const ids = await withStepTimeout({
        name: 'registry.findIdsByHashes',
        timeoutMs: AssetManager._stepTimeoutMs,
        run: () => registry.findIdsByHashes(cachedHashes),
      });
      const records = await withStepTimeout({
        name: 'registry.findByIds(byHash)',
        timeoutMs: AssetManager._stepTimeoutMs,
        run: () => registry.findByIds(ids),
      });
      await AssetManager._forEachConcurrent(
        records,
        AssetManager._rehydrateConcurrency,
        async (record) => {
          if (this._verifiedHashes.get(record.id) === record.hash) {
            // Already resolved via install_state bookkeeping in the loop
            // above — skip the redundant full-file IPC read for this blob.
            return;
          }
          this._verifiedHashes.set(record.id, record.hash);

          const repairInstallState = async (): Promise<void> => {
            const state = stateById.get(record.id);
            if (state?.status === 'cached') {
              return;
            }
            await withStepTimeout({
              name: 'registry.setInstallState(byHash)',
              timeoutMs: AssetManager._stepTimeoutMs,
              run: () =>
                registry.setInstallState({
                  assetId: record.id,
                  status: 'cached',
                  cachedHash: record.hash,
                  localPath: record.hash,
                  downloadedAt: state?.downloadedAt ?? new Date().toISOString(),
                }),
            });
          };

          if (!isCoreTag(record.id)) {
            // Non-core: repair install-state bookkeeping (a cheap DB write)
            // but skip the IPC blob read — lazily materialised on first
            // actual access instead.
            await repairInstallState();
            return;
          }

          const blob = await withStepTimeout({
            name: 'backend.get(byHash)',
            timeoutMs: AssetManager._stepTimeoutMs,
            run: () => backend.get(record.hash),
          });
          if (blob) {
            if (!this._blobUrls.has(record.id)) {
              this._registerBlobUrl(record.id, blob);
              registered += 1;
            }
            await repairInstallState();
          }
        },
      );
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

  /**
   * Runs `fn` over `items` with at most `concurrency` calls in flight at
   * once, rather than one after another. Used to bound wall time for
   * per-item IPC round trips during rehydration without unbounding it
   * entirely (a single `Promise.all` over 10k+ items would flood Tauri's
   * IPC channel at once).
   */
  private static async _forEachConcurrent<T>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++] as T;
        await fn(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
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
