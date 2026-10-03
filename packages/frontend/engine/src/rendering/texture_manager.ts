// packages/frontend/engine/src/rendering/texture_manager.ts
import { Spritesheet, Texture } from 'pixi.js';
import type { LpcLayerRecipe } from '../components/appearance.ts';
import { createDeferredLoadRegistry } from './deferred_loads.ts';
import { getSheetFrameAt, sliceSheetFrames } from './spritesheet_frames.ts';
import { type SpritesheetLease, SpritesheetRegistry } from './spritesheet_registry.ts';

// ---------------------------------------------------------------------------
// LPC Atlas Data — dynamically generated Spritesheet JSON descriptor
// ---------------------------------------------------------------------------

/**
 * JSON atlas data format for PixiJS `Spritesheet` construction.
 *
 * Each entry in `frames` maps a string key (e.g. `'idle_down'`, `'walk_0'`)
 * to a frame rectangle within the base texture. The `meta` block carries
 * the image identifier (used for cache keying) and atlas format metadata.
 *
 * Generated procedurally by {@link generateLpcAtlas} from a grid layout
 * rather than hardcoded — the LPC spritesheet grid is fully regular.
 */
export type LpcAtlasData = {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: {
    image: string;
    format: string;
    size: { w: number; h: number };
    scale: number;
  };
};

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

/**
 * Describes the grid layout of an LPC spritesheet.
 *
 * Each LPC spritesheet is a regular grid of animation frames.
 * The layout specifies frame dimensions and either `columns` or `rows`;
 * the other dimension is auto-derived from the sheet's pixel size.
 *
 * Standard LPC: 13 columns × 21 rows (832×1344 px at 64×64 per frame).
 */
export type LpcSpritesheetLayout = {
  /** Frame width in pixels. Default: 64. */
  frameWidth: number;
  /** Frame height in pixels. Default: 64. */
  frameHeight: number;
  /** Number of frame columns. Auto-derived from width when omitted. */
  columns?: number;
  /** Number of frame rows. Auto-derived from height when omitted. */
  rows?: number;
  /**
   * Optional key prefix for frame labels.
   *
   * When provided, frames are labelled `"{prefix}_{row}_{col}"`
   * (e.g. `"walk_0_3"`). When omitted, labels use `"frame_{row}_{col}"`.
   */
  keyPrefix?: string;
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
const defaultLoadTexture = async (_key: number): Promise<Texture> => Texture.WHITE;

// ---------------------------------------------------------------------------
// generateLpcAtlas — dynamic Spritesheet atlas JSON
// ---------------------------------------------------------------------------

/**
 * Generates a PixiJS-compatible {@link LpcAtlasData} JSON descriptor for
 * a procedurally gridded LPC spritesheet.
 *
 * Since LPC spritesheets follow a strict regular grid (e.g. 9 columns ×
 * 4 rows of 64×64 px frames for a walk sheet), the atlas is generated
 * algorithmically rather than hand-authored. Each frame is labelled by
 * `{keyPrefix}_{row}_{col}` (e.g. `"walk_0_0"` through `"walk_3_8"`).
 *
 * The `image` field in `meta` is set to the provided `cacheKey` so
 * downstream consumers (Spritesheet cache, debug overlays) can identify
 * the source asset without re-deriving the URL.
 *
 * @param options - Atlas generation options.
 * @param options.layout - Grid layout descriptor.
 * @param options.imageKey - String key for the `meta.image` field
 *   (used as the spritesheet cache key — typically the asset URL).
 * @returns A populated {@link LpcAtlasData} ready for
 *   `new Spritesheet(baseTexture, atlasData)`.
 */
const generateLpcAtlas = (options: {
  layout: LpcSpritesheetLayout;
  imageKey: string;
}): LpcAtlasData => {
  const { layout, imageKey } = options;
  const { frameWidth, frameHeight } = layout;

  const columns = layout.columns ?? Math.floor(layout.rows ? layout.rows : 1);
  // Derive rows from frameHeight and known sheet height, or use layout.rows
  // Callers must provide at least `columns` or `rows` — validated upstream.
  const rows = layout.rows ?? 1;
  const totalWidth = columns * frameWidth;
  const totalHeight = rows * frameHeight;
  const keyPrefix = layout.keyPrefix ?? 'frame';

  const frames: LpcAtlasData['frames'] = {};

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const key = `${keyPrefix}_${row}_${col}`;
      frames[key] = {
        frame: {
          x: col * frameWidth,
          y: row * frameHeight,
          w: frameWidth,
          h: frameHeight,
        },
      };
    }
  }

  return {
    frames,
    meta: {
      image: imageKey,
      format: 'RGBA8888',
      size: { w: totalWidth, h: totalHeight },
      scale: 1,
    },
  };
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

  /**
   * Lease-counted parsed-sheet cache. A sheet stays resident while any live
   * appearance layer holds a lease on it, so animation frames can never read
   * a destroyed `sheet.textures` map.
   */
  private readonly _spritesheets: SpritesheetRegistry;

  /** Single-flight loaders: concurrent misses for one key share one load. */
  private readonly _textureLoads = createDeferredLoadRegistry<number, Texture>();

  /** Same single-flight guard for the grayscale LPC sheet cache. */
  private readonly _grayscaleLoads = createDeferredLoadRegistry<number, Texture>();

  /** Set by {@link destroy}; blocks late loads from repopulating caches. */
  private _destroyed = false;

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
    this._spritesheets = new SpritesheetRegistry();
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
   * promotion). Otherwise the load runs single-flight: concurrent callers for
   * the same key share one decode and one accounting entry, instead of each
   * loading the asset and inflating the VRAM estimate N times.
   *
   * A load that completes after {@link destroy} still resolves with its
   * texture — the texture really was produced, and it is owned by the PixiJS
   * asset system, not by this cache — but it is never cached.
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

    const loaded = await this._textureLoads.run({
      key,
      load: () => this._loadTexture(key),
      commit: (texture) => this._commitTexture(this._cache, key, texture),
    });

    const committed = this._cache.get(key);
    if (committed) {
      committed.lastAccessedAt = ++this._tick;
      return committed.texture;
    }
    return loaded;
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

    const loaded = await this._grayscaleLoads.run({
      key,
      load: () => this._loadTexture(key),
      commit: (texture) => this._commitGrayscaleSheet(key, texture),
    });

    const committed = this._grayscaleCache.get(key);
    if (committed) {
      committed.lastAccessedAt = ++this._tick;
      return committed.texture;
    }
    return loaded;
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
   * When `frameIndex` and `layout` are provided, each loaded sheet is
   * sliced to the specified animation frame before being returned.
   * This eliminates per-frame draw-call splits — the shader receives
   * pre-sliced 64×64 sub-textures aligned to exact grid boundaries.
   *
   * @param options - Batch loading options.
   * @param options.recipes - Array of up to 8 LPC layer recipes.
   * @param options.frameIndex - Optional animation frame index to slice to.
   * @param options.layout - Spritesheet grid dimensions for slicing.
   * @returns A promise resolving to an array of textures indexed by slot.
   */
  async getLayeredTextureBatch(options: {
    recipes: readonly LpcLayerRecipe[];
    frameIndex?: number;
    layout?: LpcSpritesheetLayout;
  }): Promise<Texture[]> {
    const textures: Texture[] = [];

    for (const recipe of options.recipes) {
      if (recipe?.assetId) {
        const key = Number.parseInt(recipe.assetId, 10);
        if (Number.isNaN(key) || key <= 0) {
          textures.push(Texture.EMPTY);
        } else {
          const sheet = await this.getGrayscaleSheet(key);

          if (options.frameIndex !== undefined && options.frameIndex >= 0 && options.layout) {
            const frame = this.getFrameAt({
              texture: sheet,
              layout: options.layout,
              frameIndex: options.frameIndex,
            });
            textures.push(frame ?? Texture.EMPTY);
          } else {
            textures.push(sheet);
          }
        }
      } else {
        textures.push(Texture.EMPTY);
      }
    }

    return textures;
  }

  /**
   * Acquires a LEASE on the cached PixiJS `Spritesheet` for the given base
   * texture and grid layout.
   *
   * On first request it generates a procedural {@link LpcAtlasData} JSON
   * descriptor via {@link generateLpcAtlas}, constructs a `Spritesheet`, and
   * awaits `sheet.parse()` — which sets correct WebGPU-compatible UV mappings
   * on every sub-texture. Concurrent requests for the same key share one
   * parse; each still gets its own lease.
   *
   * The lease is load-bearing, not bookkeeping: while it is held the sheet is
   * pinned and cannot be evicted, because `sheet.textures` is read on every
   * animation frame and `Spritesheet.destroy()` nulls it. Callers MUST call
   * `release()` when the sheet is torn down or replaced.
   *
   * @param options - Spritesheet request options.
   * @param options.baseTexture - The loaded base spritesheet texture.
   * @param options.layout - Grid layout descriptor.
   * @param options.cacheKey - Unique key for the spritesheet cache
   *   (typically the asset URL or a composite `url:layout` string).
   * @returns The sheet plus the release that ends the pin.
   */
  async acquireSpritesheet(options: {
    baseTexture: Texture;
    layout: LpcSpritesheetLayout;
    cacheKey: string;
  }): Promise<SpritesheetLease> {
    const { baseTexture, layout, cacheKey } = options;

    const columns = layout.columns ?? Math.floor(baseTexture.width / layout.frameWidth);
    const rows = layout.rows ?? Math.floor(baseTexture.height / layout.frameHeight);

    const sheetKey = `${cacheKey}::${columns}x${rows}`;

    return this._spritesheets.acquire({
      cacheKey: sheetKey,
      create: async () => {
        const atlasData = generateLpcAtlas({
          layout: { ...layout, columns, rows },
          imageKey: cacheKey,
        });

        const spritesheet = new Spritesheet(baseTexture, atlasData);
        await spritesheet.parse();
        return spritesheet;
      },
    });
  }

  /**
   * Unpinned convenience accessor for callers that only read a frame once.
   *
   * Resolves the cached sheet (parsing it on first use) WITHOUT holding a
   * lease, so the sheet may be evicted — nulling `textures` — while the
   * caller still holds the object. Correct only for immediate, one-shot
   * lookups. Any consumer that keeps the sheet across frames must use
   * {@link TextureManager.acquireSpritesheet} and release it on teardown.
   */
  async getOrCreateSpritesheet(options: {
    baseTexture: Texture;
    layout: LpcSpritesheetLayout;
    cacheKey: string;
  }): Promise<Spritesheet> {
    const lease = await this.acquireSpritesheet(options);
    lease.release();
    return lease.spritesheet;
  }

  /**
   * Retrieves a single frame sub-texture from a cached or newly-created
   * `Spritesheet`.
   *
   * Uses {@link TextureManager.acquireSpritesheet} under the hood for caching,
   * then returns `sheet.textures[frameKey]`. The returned texture has
   * correct WebGPU UVs set by `Spritesheet.parse()`.
   *
   * @param options - Frame lookup options.
   * @param options.baseTexture - The loaded base spritesheet texture.
   * @param options.layout - Grid layout descriptor.
   * @param options.cacheKey - Unique key for the spritesheet cache.
   * @param options.frameKey - The frame label (e.g. `'walk_0_3'`).
   * @returns A promise resolving to the frame sub-texture, or `null`
   *   if the frame key is not found.
   */
  async getSpritesheetFrame(options: {
    baseTexture: Texture;
    layout: LpcSpritesheetLayout;
    cacheKey: string;
    frameKey: string;
  }): Promise<Texture | null> {
    const { baseTexture, layout, cacheKey, frameKey } = options;

    // A one-shot lookup: the frame texture is read here and never held, so the
    // lease ends immediately. Long-lived holders must not use this method.
    const lease = await this.acquireSpritesheet({
      baseTexture,
      layout,
      cacheKey,
    });

    try {
      return lease.spritesheet.textures[frameKey] ?? null;
    } finally {
      lease.release();
    }
  }

  /**
   * Returns the number of cached Spritesheet instances.
   */
  get spritesheetCount(): number {
    return this._spritesheets.count;
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
   * The grayscale base is an asset-owned texture, so only the wrapper this
   * cache created is destroyed.
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
   * Destroys all cached textures (main, grayscale, frame slices) and
   * clears all caches.
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

    // Leased sheets are retired here and destroyed when their last lease
    // drops; the registry never nulls `sheet.textures` under a live holder.
    this._spritesheets.destroy();

    // Detach every in-flight load so a load that completes after teardown
    // resolves for its original caller but cannot repopulate the caches.
    this._destroyed = true;
    this._textureLoads.invalidate();
    this._grayscaleLoads.invalidate();
  }

  // -----------------------------------------------------------------------
  // Spritesheet slicing — frame grid extraction
  // -----------------------------------------------------------------------

  /**
   * Slices a loaded LPC spritesheet texture into an array of frame
   * sub-textures.
   *
   * Each sub-texture shares the same GPU resource as the base sheet —
   * only the UV `frame` rectangle differs. This avoids allocating
   * redundant VRAM for individual animation frames.
   *
   * The layout determines the grid: `columns` or `rows` (or both)
   * must be provided. When one dimension is omitted, it is derived
   * from the sheet's pixel dimensions divided by `frameWidth` /
   * `frameHeight`.
   *
   * Partial rows/columns (when sheet dimensions are not exact
   * multiples of frame size) are clamped — frames that would extend
   * beyond the sheet boundary are not emitted.
   *
   * @param options - Slicing options.
   * @param options.texture - The loaded spritesheet texture.
   * @param options.layout - Grid layout descriptor.
   * @returns An array of frame sub-textures in row-major order.
   * @throws If frame dimensions are zero or layout is invalid.
   */
  sliceSpritesheet(options: { texture: Texture; layout: LpcSpritesheetLayout }): Texture[] {
    return sliceSheetFrames(options);
  }

  getFrameAt(options: {
    texture: Texture;
    layout: LpcSpritesheetLayout;
    frameIndex: number;
  }): Texture | null {
    return getSheetFrameAt(options);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Publishes a freshly loaded texture into `cache` and re-runs eviction.
   *
   * Runs at most once per key (single-flight) and never after
   * {@link destroy}, which is what keeps a late load from resurrecting a
   * cache that no longer exists.
   */
  private _commitTexture(cache: Map<number, CacheEntry>, key: number, texture: Texture): void {
    if (this._destroyed || cache.has(key)) {
      return;
    }

    const estimatedBytes = texture.width * texture.height * BYTES_PER_PIXEL;
    cache.set(key, {
      texture,
      lastAccessedAt: ++this._tick,
      byteSize: estimatedBytes,
    });

    this._totalBytes += estimatedBytes;
    this._evictIfNeeded();
  }

  /** Publishes a freshly loaded grayscale base sheet. */
  private _commitGrayscaleSheet(key: number, texture: Texture): void {
    if (this._destroyed || this._grayscaleCache.has(key)) {
      return;
    }

    this._grayscaleCache.set(key, {
      texture,
      lastAccessedAt: ++this._tick,
      byteSize: texture.width * texture.height * BYTES_PER_PIXEL,
    });
    this._evictGrayscaleIfNeeded();
  }

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

export { generateLpcAtlas, PALETTE_LUT_BYTE_LENGTH, preparePaletteLUT };
