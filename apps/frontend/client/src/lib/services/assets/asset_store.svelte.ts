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
// Contract: C-243, C-435, C-496

import { r2AssetUrl, tagToAssetPath } from '@aikami/constants';
import { publicEnv } from '@aikami/frontend/configs';
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
  ReleaseResolutionError,
  type ResolvedCatalog,
  resolveCatalogRelease,
} from './release_resolver.ts';

export type AssetStore = AssetStoreState & {
  /**
   * Load the catalog (seed + offline core). Idempotent and de-duplicated.
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
   * into the same catalog state.
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
};

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
    // The catalog is a build artifact — "rescan" just drops the memoized load
    // so the next call re-reads it. The filesystem scan runs in tooling.
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
      await this._runLoad();
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
  private async _runLoad(): Promise<void> {
    const inFlight = this._loadPromise;
    if (inFlight) {
      await inFlight;
      return;
    }
    const attempt = this._loadCatalog();
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
      return null;
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

  /**
   * Fetches, validates and installs the catalog.
   *
   * The complete candidate is resolved into locals first and only then swapped
   * into the active state, so the store never exposes a partially-replaced
   * catalog. On failure the previous verified snapshot is preserved: rejecting
   * release N+1 must not destroy a working release N.
   */
  private async _loadCatalog(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    const baseUrl = publicEnv.PUBLIC_ASSETS_BASE_URL;
    if (!baseUrl) {
      // Not a release failure: with no origin configured every content-addressed
      // URL would 404, so the catalog is genuinely unservable. Fail closed.
      this._clearCatalog();
      this.error = 'PUBLIC_ASSETS_BASE_URL is not configured — cannot load asset catalog.';
      this.isLoading = false;
      logger.error('assetStore: PUBLIC_ASSETS_BASE_URL is not configured');
      return;
    }

    try {
      // The release resolver fetches the immutable release graph, validates it
      // and verifies the pinned seed by hash. It only reaches for the mutable
      // legacy alias when no release pointer exists at all; corrupt release
      // metadata throws instead of silently degrading.
      const resolved = await resolveCatalogRelease({ originUrl: baseUrl });

      // Stage the whole candidate BEFORE touching the active state. Nothing
      // below this line can fail, so the swap is atomic at the state level.
      const seed = resolved.seed;
      const rowsByTag = new Map(seed.rows.map((row) => [row.tag, row]));
      const coreTags = new Set(resolved.coreTags);
      const manifest = toManifest(seed);

      this._seed = seed;
      this._rowsByTag = rowsByTag;
      this._coreTags = coreTags;
      this._releaseId = resolved.releaseId;
      this._releaseSource = resolved.source;
      this._packLock = resolved.packLock ?? null;
      this._packLockSource = resolved.packLockSource;
      this.manifest = manifest;
      // A new catalog revision may add tags that previously failed to warm —
      // allow them to be retried.
      this._warmFailedTags.clear();

      logger.debug('assetStore: catalog loaded', {
        count: seed.rows.length,
        coreTags: coreTags.size,
        generatedAt: seed.generatedAt,
        releaseId: resolved.releaseId,
        source: resolved.source,
        packLockSource: resolved.packLockSource,
      });
    } catch (err) {
      this.error =
        err instanceof ReleaseResolutionError
          ? `Failed to resolve catalog release (${err.code}): ${err.message}`
          : `Failed to load asset catalog: ${String(err)}`;
      logger.error('assetStore: fetchManifest failed', err);

      // A failed REFRESH keeps the previous complete, verified snapshot active.
      // A failed INITIAL load has no previous snapshot, so the store stays
      // empty and the error is exposed — never a fabricated or partial catalog.
      if (!this._hasCatalog()) {
        this._clearCatalog();
      }
    } finally {
      this.isLoading = false;
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
    this.manifest = null;
    this._warmFailedTags.clear();
  }
}

export const assetStore: AssetStore = new AssetStoreImpl();
