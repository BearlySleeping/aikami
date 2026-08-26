// apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts
//
// AssetStore — Svelte 5 $state rune-based reactive index of the asset catalog,
// providing tag→URL resolution for PixiJS Assets.load().
//
// Source of truth is the compact boot seed (`static/game-data/asset_seed.json`)
// plus the offline-core declaration (`offline_core.json`). Before C-435 this
// read a 6.9 MB `manifest.json`; that file is no longer shipped, and the
// manifest shape is now rebuilt from the seed so downstream consumers
// (audio resolver, LPC catalog, asset browser) keep the same view.
//
// Contract: C-243, C-435

import { r2AssetUrl, tagToAssetPath } from '@aikami/constants';
import { publicEnv } from '@aikami/frontend/configs';
import type {
  AssetEntry,
  AssetManifest,
  AssetSeedDocument,
  AssetSeedRow,
  AssetStoreState,
  CompactSeedDocument,
  OfflineCoreDeclaration,
} from '@aikami/types';
import { parseAssetSeed } from '@aikami/types';
import { logger } from '$logger';
import { assetManager } from './asset_manager.svelte.ts';

/**
 * R2 key for the compact boot seed — every asset in the catalog, hashes only.
 * Fetched from the configured origin (PUBLIC_ASSETS_BASE_URL) instead of a
 * bundled path so the client ships zero game-data (C-435 follow-up).
 */
const SEED_KEY = 'seed/asset_seed.json';

/**
 * R2 key for the offline-core declaration — the tags the client prefetches
 * and pins on first run (C-448). Before C-448 this declared tags *bundled
 * inside the client*; it now declares the first-run prefetch set: fetched
 * once over the network, verified by hash, and pinned in the OPFS / Tauri
 * FS cache so every later run is fully offline.
 */
const OFFLINE_CORE_KEY = 'seed/offline_core.json';

export type AssetStore = AssetStoreState & {
  /** Load the catalog (seed + offline core). Idempotent and de-duplicated. */
  fetchManifest: () => Promise<void>;
  /** Discard the cached catalog and load it again. */
  rescanAssets: () => Promise<void>;
  /** Resolve a tag to a loadable URL. Returns null if the tag is unknown. */
  resolveUrl: (tag: string) => string | null;
  /** The parsed boot seed, or null before the catalog loads. */
  readonly seed: AssetSeedDocument | null;
  /** Tags bundled inside the client — never network-dependent. */
  readonly coreTags: ReadonlySet<string>;
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

  /** In-flight load, so concurrent callers share one fetch. */
  private _loadPromise: Promise<void> | null = null;

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

  // -----------------------------------------------------------------------
  // fetchManifest
  // -----------------------------------------------------------------------

  async fetchManifest(): Promise<void> {
    this._loadPromise ??= this._loadCatalog();
    await this._loadPromise;
  }

  // -----------------------------------------------------------------------
  // rescanAssets
  // -----------------------------------------------------------------------

  async rescanAssets(): Promise<void> {
    // The catalog is a build artifact — "rescan" just drops the memoized load
    // so the next call re-reads it. The filesystem scan runs in tooling.
    this._loadPromise = null;
    await this.fetchManifest();
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

  /** Fetches and indexes the seed + offline-core declaration from R2. */
  private async _loadCatalog(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    const baseUrl = publicEnv.PUBLIC_ASSETS_BASE_URL;
    if (!baseUrl) {
      this.error = 'PUBLIC_ASSETS_BASE_URL is not configured — cannot load asset catalog.';
      this.isLoading = false;
      this._loadPromise = null;
      logger.error('assetStore: PUBLIC_ASSETS_BASE_URL is not configured');
      return;
    }

    try {
      const [seedResponse, coreResponse] = await Promise.all([
        fetch(`${baseUrl}/${SEED_KEY}`),
        fetch(`${baseUrl}/${OFFLINE_CORE_KEY}`),
      ]);

      if (!seedResponse.ok) {
        throw new Error(`asset_seed.json: ${seedResponse.status} ${seedResponse.statusText}`);
      }

      const seed = parseAssetSeed((await seedResponse.json()) as CompactSeedDocument);

      // The offline core is optional — without it every asset simply resolves
      // remotely, which is still correct, just not offline-capable.
      let coreTags: readonly string[] = [];
      if (coreResponse.ok) {
        coreTags = ((await coreResponse.json()) as OfflineCoreDeclaration).tags;
      } else {
        logger.warn('assetStore: offline_core.json unavailable', {
          status: coreResponse.status,
        });
      }

      this._seed = seed;
      this._rowsByTag = new Map(seed.rows.map((row) => [row.tag, row]));
      this._coreTags = new Set(coreTags);
      this.manifest = toManifest(seed);
      // A new catalog revision may add tags that previously failed to warm —
      // allow them to be retried.
      this._warmFailedTags.clear();

      logger.debug('assetStore: catalog loaded', {
        count: seed.rows.length,
        coreTags: this._coreTags.size,
        generatedAt: seed.generatedAt,
      });
    } catch (err) {
      // Allow a retry on the next call rather than caching the failure.
      this._loadPromise = null;
      this.error = `Failed to load asset catalog: ${String(err)}`;
      logger.error('assetStore: fetchManifest failed', err);
    } finally {
      this.isLoading = false;
    }
  }
}

export const assetStore: AssetStore = new AssetStoreImpl();
