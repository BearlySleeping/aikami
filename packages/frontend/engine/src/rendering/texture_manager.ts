// packages/frontend/engine/src/rendering/texture_manager.ts
import { Texture } from 'pixi.js';
import type { LpcLayerRecipe } from '../components/appearance.ts';

// ---------------------------------------------------------------------------
// TextureManager — LRU cache for GPU textures + grayscale LPC sheets
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
 * Cache entry for a base grayscale LPC (Liberated Pixel Cup) spritesheet.
 *
 * Grayscale sheets are shared across all color variants of a character —
 * only the palette LUT texture changes. This separation avoids caching
 * redundant copies of the same grayscale data for each color swatch.
 */
type GrayscaleSheetEntry = {
  /** The cached grayscale base texture (R channel = palette indices). */
  texture: Texture;
  /** Monotonic access tick for LRU eviction ordering. */
  lastAccessedAt: number;
  /** Approximate VRAM footprint in bytes. */
  byteSize: number;
};

/** Standard LPC color ramp size — one entry per palette index (0–255). */
const LPC_PALETTE_SIZE = 256;

/** Bytes per RGBA pixel in the palette LUT texture. */
const BYTES_PER_PIXEL = 4;

/** Total byte length of a palette LUT Uint8Array (256 × 4 = 1024). */
const PALETTE_LUT_BYTE_LENGTH = LPC_PALETTE_SIZE * BYTES_PER_PIXEL;

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

/** Default limit for grayscale sheet cache entries. */
const DEFAULT_MAX_GRAYSCALE_SHEETS = 256;

// ---------------------------------------------------------------------------
// preparePaletteLUT — static palette utility
// ---------------------------------------------------------------------------

/**
 * Converts a record of index→hex-color strings into a 1024-byte Uint8Array
 * suitable for upload as a 256×1 RGBA palette lookup texture.
 *
 * Each hex string must be in `#RRGGBB` format (7 characters including
 * the leading `#`). Indices not present in the input map default to
 * fully transparent black (`#00000000`).
 *
 * The output layout is: `[R0, G0, B0, A0, R1, G1, B1, A1, ... R255, G255, B255, A255]`
 * with each channel normalized to 0–255 byte values. The PixiJS `Texture`
 * created from this array must use `SCALE_MODES.NEAREST` to avoid
 * colour interpolation bleeding during palette indexing.
 *
 * @param hexColors - Record mapping palette index strings ("0"–"255")
 *   to `#RRGGBB` hex colour strings.
 * @returns A 1024-byte Uint8Array ready for `Texture.from()`.
 */
const preparePaletteLUT = (hexColors: Record<string, string>): Uint8Array => {
  const data = new Uint8Array(PALETTE_LUT_BYTE_LENGTH);

  for (const [indexStr, hex] of Object.entries(hexColors)) {
    const index = Number.parseInt(indexStr, 10);
    if (Number.isNaN(index) || index < 0 || index >= LPC_PALETTE_SIZE) {
      continue;
    }

    // Parse #RRGGBB → [R, G, B], alpha always 255 (fully opaque)
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);

    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      continue;
    }

    const offset = index * BYTES_PER_PIXEL;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255; // Full opacity
  }

  return data;
};

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
  private readonly _cache: Map<number, CacheEntry>;

  /**
   * LRU cache for base grayscale LPC spritesheets.
   *
   * Keyed by grayscale asset ID (a separate numeric namespace from
   * the main texture cache). These sheets are shared across all colour
   * variants — only the palette LUT texture changes per character.
   */
  private readonly _grayscaleCache: Map<number, GrayscaleSheetEntry>;

  /** Maximum textures before eviction. */
  private readonly _maxTextures: number;

  /** Maximum VRAM bytes before eviction. */
  private readonly _maxBytes: number;

  /** Maximum grayscale sheet entries before eviction. */
  private readonly _maxGrayscaleSheets: number;

  /** Running total of cached VRAM bytes (main cache only). */
  private _totalBytes: number;

  /** Injected loader function. */
  private readonly _loadTexture: (key: number) => Promise<Texture>;

  /** Monotonic access counter for precise LRU ordering. */
  private _tick: number;

  /**
   * @param config - Optional cache limits and loader override.
   */
  constructor(config?: Partial<TextureManagerConfig>) {
    this._cache = new Map();
    this._grayscaleCache = new Map();
    this._maxTextures = config?.maxTextures ?? DEFAULT_MAX_TEXTURES;
    this._maxBytes = config?.maxBytes ?? DEFAULT_MAX_BYTES;
    this._maxGrayscaleSheets = DEFAULT_MAX_GRAYSCALE_SHEETS;
    this._totalBytes = 0;
    this._loadTexture = config?.loadTexture ?? defaultLoadTexture;
    this._tick = 0;
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

    const existing = this._cache.get(key);
    if (existing) {
      existing.lastAccessedAt = ++this._tick;
      return existing.texture;
    }

    const texture = await this._loadTexture(key);
    const estimatedBytes = texture.width * texture.height * BYTES_PER_PIXEL;

    this._cache.set(key, {
      texture,
      lastAccessedAt: ++this._tick,
      byteSize: estimatedBytes,
    });

    this._totalBytes += estimatedBytes;
    this._evictIfNeeded();

    return texture;
  }

  /**
   * Returns a cached grayscale LPC spritesheet or loads + caches a new one.
   *
   * Grayscale sheets are cached independently from colour-tinted textures.
   * The same grayscale base is shared across all palette variants — only
   * the 256×1 palette LUT texture changes per character to customize
   * colours without re-uploading the base sheet.
   *
   * @param key - Numeric grayscale asset ID.
   * @returns A promise resolving to the PixiJS texture.
   */
  async getGrayscaleSheet(key: number): Promise<Texture> {
    if (key <= 0) {
      return Texture.EMPTY;
    }

    const existing = this._grayscaleCache.get(key);
    if (existing) {
      existing.lastAccessedAt = ++this._tick;
      return existing.texture;
    }

    const texture = await this._loadTexture(key);
    const estimatedBytes = texture.width * texture.height * BYTES_PER_PIXEL;

    this._grayscaleCache.set(key, {
      texture,
      lastAccessedAt: ++this._tick,
      byteSize: estimatedBytes,
    });

    this._evictGrayscaleIfNeeded();

    return texture;
  }

  /**
   * Creates a PixiJS `Texture` from a palette LUT Uint8Array.
   *
   * The returned texture is a 256×1 RGBA image suitable for use as a
   * `uPalette` uniform sampler2D in the Zero-Branch fragment shader.
   * The scale mode is forced to `NEAREST` to prevent interpolation
   * artifacts when sampling palette indices.
   *
   * @param lutData - 1024-byte Uint8Array from {@link preparePaletteLUT}.
   * @returns A PixiJS `Texture` configured with `NEAREST` scaling.
   */
  createPaletteTexture(lutData: Uint8Array): Texture {
    const texture = Texture.from({
      resource: lutData,
      width: LPC_PALETTE_SIZE,
      height: 1,
    });
    texture.source.scaleMode = 'nearest';
    return texture;
  }

  /**
   * Loads grayscale textures for a batch of LPC layer recipes and
   * matches each asset slot to a uniform map reference.
   *
   * Each recipe's `assetId` maps to a grayscale base sheet. The returned
   * array preserves recipe ordering so index `i` corresponds to UBO
   * slot `uTexture{i}` in the multi-layer shader.
   *
   * Recipes with invalid or missing `assetId` get `Texture.EMPTY` at
   * their slot position, keeping the index alignment intact.
   *
   * @param recipes - Array of up to 8 LPC layer recipes.
   * @returns A promise resolving to an array of textures indexed by slot.
   */
  async getLayeredTextureBatch(recipes: readonly LpcLayerRecipe[]): Promise<Texture[]> {
    const textures: Texture[] = [];

    for (const recipe of recipes) {
      if (recipe?.assetId) {
        const key = Number.parseInt(recipe.assetId, 10);
        if (Number.isNaN(key) || key <= 0) {
          textures.push(Texture.EMPTY);
        } else {
          const tex = await this.getGrayscaleSheet(key);
          textures.push(tex);
        }
      } else {
        textures.push(Texture.EMPTY);
      }
    }

    return textures;
  }

  /**
   * Decrements the reference count for a texture and removes it from the
   * cache. The underlying GPU texture is destroyed.
   *
   * @param key - Numeric asset ID to release.
   */
  releaseTexture(key: number): void {
    const entry = this._cache.get(key);
    if (!entry) {
      return;
    }

    this._totalBytes -= entry.byteSize;
    entry.texture.destroy();
    this._cache.delete(key);
  }

  /**
   * Releases a grayscale sheet from the dedicated grayscale cache.
   *
   * @param key - Numeric grayscale asset ID to release.
   */
  releaseGrayscaleSheet(key: number): void {
    const entry = this._grayscaleCache.get(key);
    if (!entry) {
      return;
    }

    entry.texture.destroy();
    this._grayscaleCache.delete(key);
  }

  /**
   * Returns the current number of cached textures (main cache only).
   */
  get size(): number {
    return this._cache.size;
  }

  /**
   * Returns the current number of cached grayscale sheets.
   */
  get grayscaleSheetCount(): number {
    return this._grayscaleCache.size;
  }

  /**
   * Returns the current estimated VRAM footprint in bytes.
   */
  get bytesUsed(): number {
    return this._totalBytes;
  }

  /**
   * Destroys all cached textures (both main and grayscale) and clears both caches.
   */
  destroy(): void {
    for (const entry of this._cache.values()) {
      entry.texture.destroy();
    }
    this._cache.clear();
    this._totalBytes = 0;

    for (const entry of this._grayscaleCache.values()) {
      entry.texture.destroy();
    }
    this._grayscaleCache.clear();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Evicts the least recently accessed entries from the main cache until
   * both the count and byte limits are satisfied.
   */
  private _evictIfNeeded(): void {
    while (this._cache.size > this._maxTextures || this._totalBytes > this._maxBytes) {
      this._evictOne(this._cache, 'texture');
    }
  }

  /**
   * Evicts the least recently accessed entries from the grayscale cache
   * until the count limit is satisfied.
   */
  private _evictGrayscaleIfNeeded(): void {
    while (this._grayscaleCache.size > this._maxGrayscaleSheets) {
      this._evictOne(this._grayscaleCache, 'grayscale');
    }
  }

  /**
   * Finds and evicts the single least recently accessed entry from a cache.
   *
   * Iterates the entire cache to find the oldest entry. For production
   * caches holding thousands of textures, this should be replaced with a
   * doubly-linked list + Map for O(1) eviction.
   *
   * @param targetCache - The cache map to evict from.
   * @param kind - Discriminator for picking the right release method.
   */
  private _evictOne(
    targetCache: Map<number, GrayscaleSheetEntry> | Map<number, CacheEntry>,
    kind: 'texture' | 'grayscale',
  ): void {
    if (targetCache.size === 0) {
      return;
    }

    let oldestKey = -1;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [key, entry] of targetCache) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey === -1) {
      return;
    }

    if (kind === 'grayscale') {
      this.releaseGrayscaleSheet(oldestKey);
    } else {
      this.releaseTexture(oldestKey);
    }
  }
}

export { PALETTE_LUT_BYTE_LENGTH, preparePaletteLUT };
