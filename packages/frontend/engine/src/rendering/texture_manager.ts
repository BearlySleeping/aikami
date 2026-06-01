// packages/frontend/engine/src/rendering/texture_manager.ts
import { Texture } from 'pixi.js';

// ---------------------------------------------------------------------------
// TextureManager — LRU cache for GPU textures
// ---------------------------------------------------------------------------

/** Entry stored in the LRU cache. */
type CacheEntry = {
  /** The cached PixiJS texture. */
  texture: Texture;
  /** Monotonic tick of last access (higher = more recent). */
  lastAccessedAt: number;
  /** Approximate VRAM footprint in bytes. */
  byteSize: number;
};

/**
 * Configuration for a {@link TextureManager} instance.
 */
export type TextureManagerConfig = {
  /** Maximum number of cached textures before eviction begins. */
  maxTextures: number;
  /** Maximum VRAM footprint in bytes before eviction begins. */
  maxBytes: number;
  /**
   * Optional injectable loader function. Receives a numeric asset key
   * and must return a PixiJS `Texture`.
   *
   * When omitted, a stub loader generates solid-color 32×32 textures
   * from a built-in palette for testing.
   */
  loadTexture?: (key: number) => Promise<Texture>;
};

/** Default cache limits. */
const DEFAULT_MAX_TEXTURES = 1000;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

// ---------------------------------------------------------------------------
// Default stub texture loader
// ---------------------------------------------------------------------------

/**
 * Returns `Texture.WHITE` as a stub for testing.
 *
 * Used as the default loader when no {@link TextureManagerConfig.loadTexture}
 * function is provided. In production, inject a loader that calls
 * `PixiJS.Assets.load()` with Firebase Storage URLs.
 *
 * @param _key - Numeric asset ID (ignored — always returns white).
 * @returns A promise resolving to `Texture.WHITE`.
 */
const defaultLoadTexture = async (_key: number): Promise<Texture> => {
  return Texture.WHITE;
};

// ---------------------------------------------------------------------------
// TextureManager
// ---------------------------------------------------------------------------

/**
 * Least-recently-used texture cache with memory tracking.
 *
 * Wraps `Map` for O(1) inserts and deletes, and tracks access timestamps
 * to evict the least recently used entries when either the texture count
 * or the total VRAM budget is exceeded.
 *
 * The actual network fetch is stubbed by default; inject a custom
 * `loadTexture` function to use `PixiJS.Assets.load()` backed by
 * Firebase Storage URLs or a local asset bundle.
 */
export class TextureManager {
  /** LRU cache: texture key → cache entry. */
  private readonly cache: Map<number, CacheEntry>;

  /** Maximum textures before eviction. */
  private readonly maxTextures: number;

  /** Maximum VRAM bytes before eviction. */
  private readonly maxBytes: number;

  /** Running total of cached VRAM bytes. */
  private totalBytes: number;

  /** Injected loader function. */
  private readonly loadTexture: (key: number) => Promise<Texture>;

  /** Monotonic access counter for precise LRU ordering. */
  private tick: number;

  /**
   * @param config - Optional cache limits and loader override.
   */
  constructor(config?: Partial<TextureManagerConfig>) {
    this.cache = new Map();
    this.maxTextures = config?.maxTextures ?? DEFAULT_MAX_TEXTURES;
    this.maxBytes = config?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.totalBytes = 0;
    this.loadTexture = config?.loadTexture ?? defaultLoadTexture;
    this.tick = 0;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Returns a cached texture or loads + caches a new one.
   *
   * If the texture is already cached, updates its access timestamp (LRU
   * promotion). Otherwise, calls the injected `loadTexture` function,
   * caches the result, and evicts stale entries if limits are exceeded.
   *
   * @param key - Numeric asset ID.
   * @returns A promise resolving to the PixiJS texture.
   */
  async getTexture(key: number): Promise<Texture> {
    if (key <= 0) {
      return Texture.EMPTY;
    }

    const existing = this.cache.get(key);
    if (existing) {
      existing.lastAccessedAt = ++this.tick;
      return existing.texture;
    }

    const texture = await this.loadTexture(key);
    const estimatedBytes = texture.width * texture.height * 4;

    this.cache.set(key, {
      texture,
      lastAccessedAt: ++this.tick,
      byteSize: estimatedBytes,
    });

    this.totalBytes += estimatedBytes;
    this.evictIfNeeded();

    return texture;
  }

  /**
   * Decrements the reference count for a texture and removes it from the
   * cache. The underlying GPU texture is destroyed.
   *
   * @param key - Numeric asset ID to release.
   */
  releaseTexture(key: number): void {
    const entry = this.cache.get(key);
    if (!entry) {
      return;
    }

    this.totalBytes -= entry.byteSize;
    entry.texture.destroy();
    this.cache.delete(key);
  }

  /**
   * Returns the current number of cached textures.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Returns the current estimated VRAM footprint in bytes.
   */
  get bytesUsed(): number {
    return this.totalBytes;
  }

  /**
   * Destroys all cached textures and clears the cache.
   */
  destroy(): void {
    for (const entry of this.cache.values()) {
      entry.texture.destroy();
    }
    this.cache.clear();
    this.totalBytes = 0;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Evicts the least recently accessed entries until both the count and
   * byte limits are satisfied.
   */
  private evictIfNeeded(): void {
    while (this.cache.size > this.maxTextures || this.totalBytes > this.maxBytes) {
      this.evictOne();
    }
  }

  /**
   * Finds and evicts the single least recently accessed cache entry.
   *
   * Iterates the entire cache to find the oldest entry. For production
   * caches holding thousands of textures, this should be replaced with a
   * doubly-linked list + Map for O(1) eviction.
   */
  private evictOne(): void {
    if (this.cache.size === 0) {
      return;
    }

    let oldestKey = -1;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey !== -1) {
      this.releaseTexture(oldestKey);
    }
  }
}
