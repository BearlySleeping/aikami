// packages/frontend/repositories/src/lib/opfs_asset_cache.ts
//
// C-203 AC-3: Asset cold storage via OPFS (Origin Private File System).
// Caches fetched Firebase Storage / external URLs into the browser's
// OPFS so subsequent loads fetch instantly without network access.
//
// Architecture:
// 1. On asset fetch, check OPFS cache first.
// 2. Cache hit → return cached Blob immediately.
// 3. Cache miss → fetch from network, store in OPFS, return.
// 4. Request persistent storage permission on first access.
//
// For Tauri desktop, OPFS is backed by the platform's native file
// system automatically. The OPFS API is available in both Chromium
// webviews (Tauri) and modern browsers.

import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base directory name for Aikami assets in OPFS. */
const CACHE_ROOT = 'aikami-assets';

/** Subdirectory for image artifacts (character portraits, item icons, etc.). */
const IMAGE_DIR = 'images';

/** Subdirectory for audio artifacts (voice lines, BGM, SFX). */
const AUDIO_DIR = 'audio';

/** Subdirectory for misc binary assets. */
const BINARY_DIR = 'binary';

/** Maximum cache size in bytes (500 MB default). */
const DEFAULT_MAX_CACHE_SIZE = 500 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Asset category determines the OPFS subdirectory. */
export type AssetCategory = 'image' | 'audio' | 'binary';

/** Entry in the OPFS asset cache. */
export type CacheEntry = {
  /** Original source URL (used as cache key). */
  url: string;
  /** OPFS file path relative to the cache root. */
  cachePath: string;
  /** File size in bytes. */
  size: number;
  /** Cached-at timestamp (ISO 8601). */
  cachedAt: string;
  /** MIME type of the cached asset. */
  mimeType: string;
};

// ---------------------------------------------------------------------------
// OpfsAssetCache
// ---------------------------------------------------------------------------

/**
 * OPFS-backed asset cache for offline retrieval of images, audio, and
 * binary assets.
 *
 * Implements C-203 AC-3: saves fetched assets into OPFS so subsequent
 * loads bypass the network entirely.
 *
 * Instantiate via {@link createOpfsAssetCache}. Call
 * {@link requestPersistence} during app boot to request persistent
 * storage from the browser.
 */
export class OpfsAssetCache {
  /** Reference to the OPFS root directory handle. */
  private _root: FileSystemDirectoryHandle | null = null;

  /** In-memory registry of cached entries (url → metadata). */
  private readonly _entries = new Map<string, CacheEntry>();

  /** Maximum cache size in bytes. */
  private readonly _maxSize: number;

  /** Whether persistence has been requested. */
  private _persistenceRequested = false;

  constructor(options: { maxSize?: number } = {}) {
    this._maxSize = options.maxSize ?? DEFAULT_MAX_CACHE_SIZE;
  }

  // -------------------------------------------------------------------
  // Public: persistence
  // -------------------------------------------------------------------

  /**
   * Requests persistent storage from the browser.
   *
   * Persistent storage means OPFS data won't be evicted under disk
   * pressure. Should be called during app boot.
   *
   * @returns Whether persistent storage was granted.
   */
  async requestPersistence(): Promise<boolean> {
    if (this._persistenceRequested) {
      return true;
    }

    logger.debug('OpfsAssetCache.requestPersistence');

    try {
      if ('storage' in navigator && 'persist' in navigator.storage) {
        const granted = await navigator.storage.persist();

        if (granted) {
          logger.debug('OpfsAssetCache.requestPersistence:granted');
        } else {
          logger.warn('OpfsAssetCache.requestPersistence:denied', {
            message:
              'Browser denied persistent storage. Assets may be evicted under disk pressure.',
          });
        }

        this._persistenceRequested = true;
        return granted;
      }

      // OPFS always uses persistent-like semantics when available
      this._persistenceRequested = true;
      return true;
    } catch (error) {
      logger.warn('OpfsAssetCache.requestPersistence:error', { error });
      this._persistenceRequested = true;
      return false;
    }
  }

  // -------------------------------------------------------------------
  // Public: initialisation
  // -------------------------------------------------------------------

  /**
   * Opens the OPFS root directory and ensures subdirectories exist.
   *
   * Must be called before any cache operations. Safe to call multiple
   * times — subsequent calls are no-ops.
   */
  async init(): Promise<void> {
    if (this._root) {
      return;
    }

    logger.debug('OpfsAssetCache.init');

    const root = await navigator.storage.getDirectory();
    const cacheRoot = await this._ensureDir(root, CACHE_ROOT);
    await this._ensureDir(cacheRoot, IMAGE_DIR);
    await this._ensureDir(cacheRoot, AUDIO_DIR);
    await this._ensureDir(cacheRoot, BINARY_DIR);

    this._root = cacheRoot;
    logger.debug('OpfsAssetCache.init:ready');
  }

  // -------------------------------------------------------------------
  // Public: cache operations
  // -------------------------------------------------------------------

  /**
   * Retrieves an asset from the OPFS cache.
   *
   * @param url - The source URL (cache key).
   * @param category - Asset category for subdirectory routing.
   * @returns The cached Blob, or undefined on cache miss.
   */
  async get(options: { url: string; category: AssetCategory }): Promise<Blob | undefined> {
    this._assertReady();

    const cachePath = this._cachePath(options.url, options.category);

    try {
      const fileHandle = await this._getFileHandle(cachePath);
      const file = await fileHandle.getFile();
      logger.debug('OpfsAssetCache.get:cache-hit', { url: options.url, size: file.size });
      return file;
    } catch {
      logger.debug('OpfsAssetCache.get:cache-miss', { url: options.url });
      return undefined;
    }
  }

  /**
   * Fetches an asset — checks cache first, falls back to network fetch.
   * Cached hits are returned instantly; misses are fetched and stored.
   *
   * @param options - URL and category.
   * @returns The asset as a Blob.
   */
  async fetch(options: { url: string; category: AssetCategory }): Promise<Blob> {
    this._assertReady();

    // Cache hit
    const cached = await this.get(options);
    if (cached) {
      return cached;
    }

    // Network fetch
    logger.debug('OpfsAssetCache.fetch:network', { url: options.url });

    const response = await fetch(options.url);
    if (!response.ok) {
      throw new Error(`OpfsAssetCache.fetch failed: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    // Store in OPFS
    await this.put({ url: options.url, blob, category: options.category });

    return blob;
  }

  /**
   * Stores an asset in the OPFS cache.
   *
   * @param options - URL, Blob data, and category.
   */
  async put(options: { url: string; blob: Blob; category: AssetCategory }): Promise<void> {
    this._assertReady();

    const cachePath = this._cachePath(options.url, options.category);

    try {
      await this._evictIfNeeded(options.blob.size);

      const fileHandle = await this._createFileHandle(cachePath);
      const writable = await fileHandle.createWritable();
      await writable.write(options.blob);
      await writable.close();

      const entry: CacheEntry = {
        cachePath,
        cachedAt: new Date().toISOString(),
        mimeType: options.blob.type || 'application/octet-stream',
        size: options.blob.size,
        url: options.url,
      };

      this._entries.set(options.url, entry);
      logger.debug('OpfsAssetCache.put:stored', { url: options.url, size: options.blob.size });
    } catch (error) {
      logger.error('OpfsAssetCache.put:failed', { url: options.url, error });
      throw error;
    }
  }

  /**
   * Removes an asset from the OPFS cache.
   *
   * @param options - URL and category.
   */
  async evict(options: { url: string; category: AssetCategory }): Promise<void> {
    this._assertReady();

    const cachePath = this._cachePath(options.url, options.category);

    try {
      await this._root!.removeEntry(cachePath);
    } catch {
      // File already removed — no-op
    }

    this._entries.delete(options.url);
    logger.debug('OpfsAssetCache.evict', { url: options.url });
  }

  /**
   * Clears all cached assets from OPFS.
   */
  async clear(): Promise<void> {
    this._assertReady();

    const dirs = [IMAGE_DIR, AUDIO_DIR, BINARY_DIR];
    for (const dir of dirs) {
      try {
        await this._root!.removeEntry(dir, { recursive: true });
        await this._ensureDir(this._root!, dir);
      } catch {
        // Directory may already be empty
      }
    }

    this._entries.clear();
    logger.debug('OpfsAssetCache.clear');
  }

  /** Returns the current cache size in bytes. */
  get totalSize(): number {
    let total = 0;
    for (const entry of this._entries.values()) {
      total += entry.size;
    }
    return total;
  }

  /** Returns the number of cached entries. */
  get entryCount(): number {
    return this._entries.size;
  }

  // -------------------------------------------------------------------
  // Private: OPFS helpers
  // -------------------------------------------------------------------

  /** Resolves the OPFS file path for a URL + category. */
  private _cachePath(url: string, category: AssetCategory): string {
    const hash = this._hashUrl(url);
    const ext = this._extensionFromMime(url);
    return `${this._categoryDir(category)}/${hash}${ext}`;
  }

  /** Maps category to subdirectory name. */
  private _categoryDir(category: AssetCategory): string {
    switch (category) {
      case 'image':
        return IMAGE_DIR;
      case 'audio':
        return AUDIO_DIR;
      case 'binary':
        return BINARY_DIR;
    }
  }

  /** Ensures a directory exists under the given parent. */
  private async _ensureDir(
    parent: FileSystemDirectoryHandle,
    name: string,
  ): Promise<FileSystemDirectoryHandle> {
    try {
      return await parent.getDirectoryHandle(name, { create: true });
    } catch {
      return await parent.getDirectoryHandle(name, { create: true });
    }
  }

  /** Gets a file handle for reading from the given path. */
  private async _getFileHandle(path: string): Promise<FileSystemFileHandle> {
    const parts = path.split('/');
    let current = this._root!;
    for (const part of parts.slice(0, -1)) {
      current = await current.getDirectoryHandle(part);
    }
    return current.getFileHandle(parts[parts.length - 1]);
  }

  /** Creates a file handle for writing at the given path. */
  private async _createFileHandle(path: string): Promise<FileSystemFileHandle> {
    const parts = path.split('/');
    let current = this._root!;
    for (const part of parts.slice(0, -1)) {
      current = await current.getDirectoryHandle(part);
    }
    return current.getFileHandle(parts[parts.length - 1], { create: true });
  }

  /**
   * Evicts oldest entries if adding new data would exceed the max cache
   * size. Uses a simple FIFO eviction policy.
   */
  private async _evictIfNeeded(newSize: number): Promise<void> {
    let current = this.totalSize;

    while (current + newSize > this._maxSize && this._entries.size > 0) {
      const oldest = [...this._entries.entries()].sort(
        (a, b) => new Date(a[1].cachedAt).getTime() - new Date(b[1].cachedAt).getTime(),
      )[0];

      if (!oldest) {
        break;
      }

      const [url, entry] = oldest;
      try {
        await this._root!.removeEntry(entry.cachePath);
      } catch {
        // File already gone
      }

      this._entries.delete(url);
      current -= entry.size;
      logger.debug('OpfsAssetCache._evictIfNeeded:evicted', { url, size: entry.size });
    }
  }

  /**
   * Generates a short deterministic hash from a URL for use as a file
   * name prefix. Uses djb2 (same hash as the spatial grid).
   */
  private _hashUrl(url: string): string {
    let hash = 5381;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) + hash + url.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /** Extracts a file extension guess from the URL or falls back to .bin. */
  private _extensionFromMime(url: string): string {
    const extMatch = url.match(/\.([a-z]{2,8})(?:\?|$)/i);
    if (extMatch) {
      return `.${extMatch[1].toLowerCase()}`;
    }

    return '.bin';
  }

  /** Asserts the cache has been initialised. */
  private _assertReady(): void {
    if (!this._root) {
      throw new Error('OpfsAssetCache: not initialised — call init() first');
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and initialises an {@link OpfsAssetCache}.
 *
 * @param options - Optional max size override.
 * @returns A ready-to-use OpfsAssetCache instance.
 */
export const createOpfsAssetCache = async (options?: {
  maxSize?: number;
}): Promise<OpfsAssetCache> => {
  const cache = new OpfsAssetCache(options);
  await cache.init();
  await cache.requestPersistence();
  return cache;
};
