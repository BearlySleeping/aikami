// apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts
//
// AssetStore — Svelte 5 $state rune-based reactive index of the asset catalog,
// providing tag→URL resolution for PixiJS Assets.load().
//
// Source of truth is the published release graph: the boot path resolves
// `index/v1/release.json`, verifies the pinned seed dependency by hash, and
// only then rebuilds the manifest view downstream consumers read. A genuinely
// absent pointer falls back to the legacy mutable `seed/asset_seed.json` alias
// (logged as a downgrade); corrupt release metadata fails closed instead of
// silently serving stale bytes. Before C-435 this read a 6.9 MB `manifest.json`;
// that file is no longer shipped, and the manifest shape is rebuilt from the
// seed so downstream consumers (audio resolver, LPC catalog, asset browser)
// keep the same view.
//
// The store also RETAINS the release's verified installed pack lock, so audio
// verification consumes the lock belonging to the same selected release instead
// of re-fetching the mutable `index/v1/pack_lock.json` alias (C-523 AC-5).
//
// Catalog replacement is transactional. A refresh that fails (origin timeout,
// HTTP 500, malformed pointer, missing dependency, hash mismatch, malformed
// seed) rejects the candidate but leaves the previous COMPLETE, verified
// snapshot active — it must never erase release N while attempting N+1. Only an
// initial boot with no valid catalog ends up empty, and it fails closed.
//
// Contract: C-243, C-435, C-496, C-523
//
// OFFLINE BOOT (C-523 follow-up). The release graph above used to be fetched
// from the publish origin on every boot and never written down, while the
// binaries it names stayed cached on the device (Turso registry rows + OPFS /
// Tauri FS bytes). A network-blocked reload therefore had every byte it
// needed and could not find it: `resolveUrl` returned null for every tag
// because no catalog row existed, `loadContentPack` fell back to a relative
// manifest path the de-bundled client does not ship, and boot died on a 404.
//
// The verified graph is now persisted once (see `catalog_snapshot_store.ts`)
// and restored BEFORE any network work, so a cached device boots offline. A
// snapshot is only ever written from a fully verified release, is validated
// structurally and by digest on the way back in, and is never blended with a
// different release: the active catalog is always one coherent graph.

import { r2AssetUrl, tagToAssetPath } from '@aikami/constants';
import { publicEnv } from '@aikami/frontend/configs';
import { type CatalogSnapshot, catalogSnapshotDigest } from '@aikami/frontend/storage';
import type { InstalledPackLock } from '@aikami/schemas';
import type {
  AssetEntry,
  AssetManifest,
  AssetSeedDocument,
  AssetSeedRow,
  AssetStoreState,
} from '@aikami/types';
import { logger } from '$logger';
import { assetManager } from './asset_manager.svelte.ts';
import {
  type CatalogSnapshotStore,
  createDatabaseCatalogSnapshotStore,
} from './catalog_snapshot_store.ts';
import {
  ReleaseResolutionError,
  type ResolvedCatalog,
  resolveCatalogRelease,
} from './release_resolver.ts';

export type AssetStore = AssetStoreState & {
  /**
   * Load the catalog (seed + offline core). Idempotent and de-duplicated.
   *
   * CACHE-FIRST: a verified device snapshot is restored from local storage and
   * returned immediately, so boot never waits on the publish origin. With no
   * usable snapshot the catalog is resolved from the network as before — the
   * first run needs the network once.
   *
   * Concurrent callers share one attempt. A failure rejects the candidate and
   * keeps the previously verified catalog active, so a refresh can be retried
   * without losing a working release.
   */
  fetchManifest: () => Promise<void>;
  /**
   * Discard the memoized catalog and load it again.
   *
   * Concurrent rescans share ONE fresh attempt, so two writers can never race
   * into the same catalog state. This is also the explicit ADOPTION path for a
   * newer release the background check reported (`newerReleaseId`): only an
   * explicit rescan replaces a live catalog with a different release, because
   * the cached binaries and the registry rows behind it belong to the release
   * that is currently active.
   */
  rescanAssets: () => Promise<void>;
  /** Resolve a tag to a loadable URL. Returns null if the tag is unknown. */
  resolveUrl: (tag: string) => string | null;
  /** Resolve the tag's verbatim license metadata from the compact seed. */
  resolveLicenses: (tag: string) => readonly string[] | undefined;
  /** The parsed boot seed, or null before the catalog loads. */
  readonly seed: AssetSeedDocument | null;
  /** Tags bundled inside the client — never network-dependent. */
  readonly coreTags: ReadonlySet<string>;
  /**
   * Immutable release id this catalog was resolved from, or `null` before a
   * load. `legacy` means the mutable legacy alias was served (no release
   * pointer) — an explicit downgrade, not a verified release.
   */
  readonly releaseId: string | null;
  /** Whether the last successful load came from a release or the legacy alias. */
  readonly releaseSource: ResolvedCatalog['source'] | null;
  /**
   * Where the ACTIVE catalog's graph came from this session: `network` when it
   * was resolved from the publish origin during this boot, `offline-snapshot`
   * when it was restored from the device's verified catalog snapshot.
   *
   * Distinct from {@link AssetStore.releaseSource}, which describes the
   * provenance of the release itself (`release` vs the legacy alias) and
   * survives a restore unchanged — a restored catalog IS that release.
   */
  readonly catalogOrigin: CatalogOrigin | null;
  /**
   * Release id a background origin check found that is DIFFERENT from the
   * active catalog, or undefined when the origin agrees with what is active
   * (or could not be reached). Reported, never auto-applied: adopting another
   * release re-keys every cached binary, so it goes through an explicit
   * {@link AssetStore.rescanAssets}.
   */
  readonly newerReleaseId: string | undefined;
  /**
   * The installed pack lock the ACTIVE catalog's release pinned and verified,
   * or null when the active release authors none. This is the lock audio
   * verification reads — the store never re-fetches the mutable
   * `index/v1/pack_lock.json` alias for a release (C-523 AC-5).
   */
  readonly packLock: InstalledPackLock | null;
  /**
   * Where the active catalog's pack lock came from: `release` (pinned by the
   * verified graph), `legacy-alias` (a genuinely pointer-less install), or
   * `absent`. Null before any load.
   */
  readonly packLockSource: ResolvedCatalog['packLockSource'] | null;
  /** Set the current background tag (triggers crossfade in engine). */
  setBackground: (tag: string | null) => void;
  /** Set the current music tag. */
  setMusic: (tag: string | null) => void;
  /** Toggle audio mute state. */
  setAudioMuted: (muted: boolean) => void;
  /**
   * Replace the snapshot persistence seam.
   *
   * Production wires the device database (the default). It is injectable so
   * the offline-boot contract can be exercised against an arbitrary backend
   * without standing up a whole local database; `undefined` restores the
   * production store.
   */
  setSnapshotStore: (store: CatalogSnapshotStore | undefined) => void;
};

/** Which surface the ACTIVE catalog's graph was taken from this session. */
export type CatalogOrigin = 'network' | 'offline-snapshot';

/**
 * Rebuilds the manifest entry for a seed row. `path` is the exact inverse of
 * the scan that produced the tag, so `subcategory`/`name` are derived from it
 * the same way the scanner derived them.
 */
const toEntry = (row: AssetSeedRow): AssetEntry => {
  const path = tagToAssetPath({ tag: row.tag, ext: row.ext });
  const segments = path.split('/');
  const filename = segments.at(-1) ?? '';
  return {
    tag: row.tag,
    category: row.category,
    subcategory: segments.length > 2 ? segments.slice(1, -1).join('/') : '',
    name: filename.slice(0, filename.length - row.ext.length),
    path,
    ext: row.ext,
  };
};

/** Builds the manifest view every downstream consumer already reads. */
const toManifest = (seed: AssetSeedDocument): AssetManifest => {
  const assets: Record<string, AssetEntry> = {};
  const byCategory: Record<string, AssetEntry[]> = {};

  for (const row of seed.rows) {
    const entry = toEntry(row);
    assets[entry.tag] = entry;
    const bucket = byCategory[entry.category] ?? [];
    bucket.push(entry);
    byCategory[entry.category] = bucket;
  }

  for (const entries of Object.values(byCategory)) {
    entries.sort((a, b) => a.tag.localeCompare(b.tag));
  }

  return { scannedAt: seed.generatedAt, count: seed.rows.length, assets, byCategory };
};

class AssetStoreImpl implements AssetStore {
  manifest: AssetManifest | null = $state(null);
  isLoading: boolean = $state(false);
  error: string | null = $state(null);
  currentBackground: string | null = $state(null);
  currentMusic: string | null = $state(null);
  audioMuted: boolean = $state(false);

  /** Parsed seed — the hash/ext source for remote URL construction. */
  private _seed: AssetSeedDocument | null = null;

  /** Seed rows by tag, for O(1) URL construction. */
  private _rowsByTag = new Map<string, AssetSeedRow>();

  /** Tags that ship inside the client and resolve from the bundled path. */
  private _coreTags: ReadonlySet<string> = new Set();

  /** Immutable release id from the last successful load, if any. */
  private _releaseId: string | null = null;

  /** Which surface the last successful load read from. */
  private _releaseSource: ResolvedCatalog['source'] | null = null;

  /** The verified installed pack lock of the active release, if it pinned one. */
  private _packLock: InstalledPackLock | null = null;

  /** Where the active catalog's pack lock came from. */
  private _packLockSource: ResolvedCatalog['packLockSource'] | null = null;

  /** Where the active catalog's graph came from this session. */
  private _catalogOrigin: CatalogOrigin | null = null;

  /** A different release the origin advertises; reported, never auto-applied. */
  private _newerReleaseId: string | undefined;

  /**
   * Integrity digest of the ACTIVE catalog.
   *
   * Kept as the in-flight promise so a detached origin check can await the
   * digest of the catalog that is active when it runs, without a second
   * hash pass over a large seed.
   */
  private _digestPromise: Promise<string> | undefined;

  /** Persistence seam for the verified device snapshot. */
  private _snapshotStore: CatalogSnapshotStore = createDatabaseCatalogSnapshotStore();

  /** In-flight load attempt, so concurrent callers share one fetch. */
  private _loadPromise: Promise<void> | null = null;

  /** In-flight explicit rescan, so concurrent rescans share ONE fresh attempt. */
  private _rescanPromise: Promise<void> | null = null;

  /**
   * Tags whose background warm() attempt failed (unresolvable). Skipped on
   * subsequent resolveUrl calls to avoid repeated fetch attempts from render
   * or reactive paths; cleared when a new catalog revision loads.
   */
  private _warmFailedTags = new Set<string>();

  get seed(): AssetSeedDocument | null {
    return this._seed;
  }

  get coreTags(): ReadonlySet<string> {
    return this._coreTags;
  }

  get releaseId(): string | null {
    return this._releaseId;
  }

  get releaseSource(): ResolvedCatalog['source'] | null {
    return this._releaseSource;
  }

  get packLock(): InstalledPackLock | null {
    return this._packLock;
  }

  get packLockSource(): ResolvedCatalog['packLockSource'] | null {
    return this._packLockSource;
  }

  get catalogOrigin(): CatalogOrigin | null {
    return this._catalogOrigin;
  }

  get newerReleaseId(): string | undefined {
    return this._newerReleaseId;
  }

  setSnapshotStore(store: CatalogSnapshotStore | undefined): void {
    this._snapshotStore = store ?? createDatabaseCatalogSnapshotStore();
  }

  // -----------------------------------------------------------------------
  // fetchManifest
  // -----------------------------------------------------------------------

  async fetchManifest(): Promise<void> {
    // Already loaded: the catalog is a build artifact, so a repeated call is a
    // no-op rather than a re-read. A FAILED attempt leaves no catalog, so the
    // next call retries.
    if (this._hasCatalog()) {
      return;
    }
    await this._runLoad();
  }

  // -----------------------------------------------------------------------
  // rescanAssets
  // -----------------------------------------------------------------------

  async rescanAssets(): Promise<void> {
    // A rescan is an explicit, user-driven re-read: it always goes to the
    // origin, so it is also the path that adopts a newer release onto a
    // device running a restored one. The filesystem scan runs in tooling.
    // Concurrent rescans share ONE fresh attempt: two writers must never race
    // into the same catalog state.
    this._rescanPromise ??= this._performRescan();
    await this._rescanPromise;
  }

  /** Runs the single shared rescan attempt behind {@link rescanAssets}. */
  private async _performRescan(): Promise<void> {
    try {
      // Let an attempt already in flight settle first: it is about to publish
      // a snapshot, and orphaning it would leave two writers racing.
      await this._loadPromise;
      this._loadPromise = null;
      await this._runLoad({ cacheFirst: false });
    } finally {
      this._rescanPromise = null;
    }
  }

  /**
   * Runs — or joins — one catalog-load attempt.
   *
   * Every concurrent caller shares the attempt already in flight, so only one
   * writer can ever publish a snapshot into the store. The memoized promise is
   * retained only while it represents an active catalog: a failed attempt is
   * cleared so the next call can retry.
   */
  private async _runLoad(options?: { cacheFirst?: boolean }): Promise<void> {
    const inFlight = this._loadPromise;
    if (inFlight) {
      await inFlight;
      return;
    }
    const attempt = this._loadCatalog({ cacheFirst: options?.cacheFirst ?? true });
    this._loadPromise = attempt;
    try {
      await attempt;
    } finally {
      if (this._loadPromise === attempt && !this._hasCatalog()) {
        this._loadPromise = null;
      }
    }
  }

  /** Whether a complete, verified catalog is currently active. */
  private _hasCatalog(): boolean {
    return this._seed !== null;
  }

  // -----------------------------------------------------------------------
  // resolveUrl
  // -----------------------------------------------------------------------

  resolveUrl(tag: string): string | null {
    const row = this._rowsByTag.get(tag);
    if (!row) {
      // Defence in depth for a catalog that never loaded (no snapshot, origin
      // unreachable): a blob URL exists ONLY for a tag whose cached bytes were
      // hash-verified against the local registry, so serving it cannot bypass
      // admission or integrity. A tag that IS absent from a loaded catalog is
      // deliberately not resolved here — the active release dropped it.
      return this._hasCatalog() ? null : assetManager.acquireUrl(tag);
    }

    // C-373: serve verified cached binaries via the AssetManager (blob: URL)
    // when available — zero network traffic, with an acquired reference so the
    // renderer retains a valid URL. Uncached assets are prefetched in the
    // background (warm) and fall back to the origin URL for now.
    const cachedUrl = assetManager.acquireUrl(tag);
    if (cachedUrl) {
      return cachedUrl;
    }
    if (!this._warmFailedTags.has(tag)) {
      void assetManager
        .warm(tag)
        .then((url) => {
          if (url === null) {
            this._warmFailedTags.add(tag);
          }
        })
        .catch(() => {
          this._warmFailedTags.add(tag);
        });
    }

    return this._originUrl(row);
  }

  resolveLicenses(tag: string): readonly string[] | undefined {
    return this._rowsByTag.get(tag)?.licenses;
  }

  // -----------------------------------------------------------------------
  // Playback state
  // -----------------------------------------------------------------------

  setBackground(tag: string | null): void {
    this.currentBackground = tag;
  }

  setMusic(tag: string | null): void {
    this.currentMusic = tag;
  }

  setAudioMuted(muted: boolean): void {
    this.audioMuted = muted;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Direct (uncached) URL for a seed row: the content-addressed R2 object.
   * Returns null when no publish origin is configured — every asset is
   * de-bundled, so a fabricated `/game-data/...` URL would just 404.
   */
  private _originUrl(row: AssetSeedRow): string | null {
    const baseUrl = publicEnv.PUBLIC_ASSETS_BASE_URL;
    if (!baseUrl) {
      return null;
    }
    return r2AssetUrl({ baseUrl, hash: row.hash, ext: row.ext });
  }

  /** Builds the persistable snapshot form of ONE verified resolution. */
  private static _toSnapshot(resolved: ResolvedCatalog): CatalogSnapshot {
    return {
      releaseId: resolved.releaseId,
      releaseSource: resolved.source,
      seed: resolved.seed,
      coreTags: [...resolved.coreTags],
      packLock: resolved.packLock,
      packLockSource: resolved.packLockSource,
    };
  }

  /**
   * Fetches, validates and installs the catalog.
   *
   * Cache-first when a verified device snapshot exists: it is restored and the
   * load returns without touching the network, so a cached device boots with
   * no publish origin in reach. Only a device with no usable snapshot resolves
   * from the origin — that first run legitimately needs the network once.
   *
   * The complete candidate is resolved into locals first and only then swapped
   * into the active state, so the store never exposes a partially-replaced
   * catalog. On failure the previous verified catalog is preserved: rejecting
   * release N+1 must not destroy a working release N.
   */
  private async _loadCatalog(options: { cacheFirst: boolean }): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      if (options.cacheFirst && (await this._restoreSnapshot())) {
        // The active graph is the device's own; ask the origin about a newer
        // release without ever blocking the boot on it.
        this._scheduleOriginCheck();
        return;
      }

      await this._loadFromOrigin();
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Restores the device's persisted, verified catalog snapshot.
   *
   * A missing, malformed or digest-rejected record is a cache miss — never an
   * error, and never partially applied. Restoring rebuilds the SAME derived
   * views a network load would (`rowsByTag`, `coreTags`, `manifest`, lock), so
   * every downstream consumer sees an identical catalog either way.
   *
   * @returns Whether a verified snapshot became the active catalog.
   */
  private async _restoreSnapshot(): Promise<boolean> {
    let snapshot: CatalogSnapshot | undefined;
    try {
      snapshot = await this._snapshotStore.read();
    } catch (error) {
      // An unreadable device store is a cache miss, not a boot failure: fall
      // through to the origin so an online device still starts.
      logger.warn('assetStore: catalog snapshot unreadable', error);
      return false;
    }

    if (!snapshot) {
      return false;
    }

    this._installCatalog(snapshot, 'offline-snapshot');

    logger.warn('assetStore: catalog restored from device snapshot', {
      count: snapshot.seed.rows.length,
      coreTags: snapshot.coreTags.length,
      releaseId: snapshot.releaseId,
      releaseSource: snapshot.releaseSource,
      packLockSource: snapshot.packLockSource,
    });
    return true;
  }

  /** Resolves the release graph from the publish origin and installs it. */
  private async _loadFromOrigin(): Promise<void> {
    const baseUrl = publicEnv.PUBLIC_ASSETS_BASE_URL;
    if (!baseUrl) {
      // Not a release failure: with no origin configured every content-addressed
      // URL would 404, so the catalog is genuinely unservable. Fail closed.
      this._clearCatalog();
      this.error = 'PUBLIC_ASSETS_BASE_URL is not configured — cannot load asset catalog.';
      logger.error('assetStore: PUBLIC_ASSETS_BASE_URL is not configured');
      return;
    }

    try {
      // The release resolver fetches the immutable release graph, validates it
      // and verifies the pinned seed by hash. It only reaches for the mutable
      // legacy alias when no release pointer exists at all; corrupt release
      // metadata throws instead of silently degrading.
      const resolved = await resolveCatalogRelease({ originUrl: baseUrl });

      const snapshot = AssetStoreImpl._toSnapshot(resolved);
      this._installCatalog(snapshot, 'network');

      // Persist only a FULLY verified release, and only AFTER it is active.
      // A failed refresh above never reaches this line, so the last good
      // snapshot survives a partial fail. The write is awaited so a caller
      // that returns from the load KNOWS the device has the release.
      await this._persistSnapshot(snapshot);
      this._newerReleaseId = undefined;
    } catch (err) {
      const reason =
        err instanceof ReleaseResolutionError
          ? `Failed to resolve catalog release (${err.code}): ${err.message}`
          : `Failed to load asset catalog: ${String(err)}`;
      logger.error('assetStore: fetchManifest failed', err);

      // A failed REFRESH keeps the previous complete, verified catalog active.
      // A failed INITIAL load has no previous catalog, so the store stays
      // empty and the error is exposed — never a fabricated or partial one.
      if (!this._hasCatalog()) {
        // An explicit rescan on a device that has a snapshot but no active
        // catalog (e.g. an earlier failed boot) still has something verified
        // to fall back to.
        if (await this._restoreSnapshot()) {
          this.error = reason;
          return;
        }
        this._clearCatalog();
        this.error = `${reason} No verified catalog is cached on this device — connect once to download the starter content. Later runs boot offline from the cache.`;
        return;
      }
      this.error = reason;
    }
  }

  /**
   * Swaps a complete, verified catalog into the active state.
   *
   * Everything is staged before the first assignment, so no failure can leave a
   * half-replaced catalog visible to a consumer.
   */
  private _installCatalog(snapshot: CatalogSnapshot, origin: CatalogOrigin): void {
    const { seed } = snapshot;
    const rowsByTag = new Map(seed.rows.map((row) => [row.tag, row]));
    const coreTags = new Set(snapshot.coreTags);
    const manifest = toManifest(seed);

    this._seed = seed;
    this._rowsByTag = rowsByTag;
    this._coreTags = coreTags;
    this._releaseId = snapshot.releaseId;
    this._releaseSource = snapshot.releaseSource;
    this._packLock = snapshot.packLock ?? null;
    this._packLockSource = snapshot.packLockSource;
    this._catalogOrigin = origin;
    this.manifest = manifest;
    // A new catalog revision may add tags that previously failed to warm —
    // allow them to be retried.
    this._warmFailedTags.clear();

    const pending = catalogSnapshotDigest(snapshot);
    this._digestPromise = pending;

    logger.debug('assetStore: catalog loaded', {
      count: seed.rows.length,
      coreTags: coreTags.size,
      generatedAt: seed.generatedAt,
      releaseId: snapshot.releaseId,
      source: snapshot.releaseSource,
      origin,
      packLockSource: snapshot.packLockSource,
    });
  }

  /**
   * Persists a verified snapshot. Failures are logged, never propagated: a
   * device that cannot write its catalog still plays, it just boots online.
   *
   * It IS awaited by the caller — the record is local, cheap and already
   * covered by the local-database handle the cache-first read opened.
   */
  private async _persistSnapshot(snapshot: CatalogSnapshot): Promise<void> {
    try {
      await this._snapshotStore.write(snapshot);
    } catch (error) {
      logger.warn('assetStore: catalog snapshot not persisted', error);
    }
  }

  /**
   * Asks the origin whether a NEWER release exists — off the boot path.
   *
   * This deliberately never installs anything. The cached binaries and the
   * registry rows behind the active catalog belong to the release it was
   * verified against, so replacing a live catalog mid-session would pair old
   * bytes with a new hash index. A difference is REPORTED
   * ({@link AssetStore.newerReleaseId}) and adopted only through an explicit
   * {@link AssetStore.rescanAssets}, which re-seeds the registry and
   * re-verifies the cache against the new release.
   */
  private _scheduleOriginCheck(): void {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }
    void this._checkOriginForNewerRelease();
  }

  private async _checkOriginForNewerRelease(): Promise<void> {
    const baseUrl = publicEnv.PUBLIC_ASSETS_BASE_URL;
    if (!baseUrl || !this._digestPromise) {
      return;
    }
    try {
      const activeDigest = await this._digestPromise;
      const resolved = await resolveCatalogRelease({ originUrl: baseUrl });
      const digest = await catalogSnapshotDigest(AssetStoreImpl._toSnapshot(resolved));
      if (digest === activeDigest) {
        this._newerReleaseId = undefined;
        logger.debug('assetStore: origin agrees with the active catalog', {
          releaseId: resolved.releaseId,
        });
        return;
      }
      this._newerReleaseId = resolved.releaseId;
      logger.warn('assetStore: newer release available (not adopted)', {
        activeReleaseId: this._releaseId,
        newerReleaseId: resolved.releaseId,
      });
    } catch (error) {
      // An unreachable or broken origin is the normal offline case: the active
      // catalog stays exactly as it is.
      logger.debug('assetStore: origin check failed, keeping the active catalog', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Clears every catalog-derived view so a failed load cannot serve stale data. */
  private _clearCatalog(): void {
    this._seed = null;
    this._rowsByTag.clear();
    this._coreTags = new Set();
    this._releaseId = null;
    this._releaseSource = null;
    this._packLock = null;
    this._packLockSource = null;
    this._catalogOrigin = null;
    this._newerReleaseId = undefined;
    this._digestPromise = undefined;
    this.manifest = null;
    this._warmFailedTags.clear();
  }
}

export const assetStore: AssetStore = new AssetStoreImpl();
