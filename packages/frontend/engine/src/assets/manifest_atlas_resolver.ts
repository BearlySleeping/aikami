// packages/frontend/engine/src/assets/manifest_atlas_resolver.ts
//
// ManifestAtlasResolver — safe texture lookup with graceful fallbacks.
//
// Bridges the gap between numerical tile/entity IDs in Tiled map JSON files
// and PixiJS texture atlas frames defined in the content pack manifest.
// Every texture lookup is validated against the loaded spritesheet atlas;
// unresolved IDs receive the pack's fallback texture instead of rendering
// white squares (PixiJS missing-texture placeholder) or neon debug fills.
//
// Contract: C-171 (tilemap rendering), C-315 (content pack atlas integration)

import { Assets, Rectangle, Texture } from 'pixi.js';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single tile definition in the manifest's tile mapping. */
export type ManifestTileDef = {
  /** Human-readable tile name (e.g. "grass_base"). */
  readonly name: string;
  /** Spritesheet frame key or standalone image filename. */
  readonly frame: string;
  /** Whether entities can walk on this tile. */
  readonly isWalkable: boolean;
  /** Whether this tile is a solid wall (impassable + blocks vision). */
  readonly isWall?: boolean;
  /** Optional movement speed multiplier (e.g. 0.8 for cobblestone roads). */
  readonly movementCost?: number;
};

/** A single entity definition in the manifest's entity mapping. */
export type ManifestEntityDef = {
  /** Human-readable name (e.g. "Hero Spawn"). */
  readonly name: string;
  /** Spritesheet frame key or standalone image filename. */
  readonly frame: string;
  /** Anchor point for the sprite (default: 0.5, 1.0 for bottom-center). */
  readonly anchor?: { readonly x: number; readonly y: number };
  /** Simplified collision bounds (world-space units). */
  readonly collision?: {
    readonly type: 'rect' | 'circle';
    readonly width?: number;
    readonly height?: number;
    readonly radius?: number;
  };
};

/** Atlas metadata for a content pack's spritesheet. */
export type ManifestAtlas = {
  /** URL to the spritesheet texture image (PNG/WebP). */
  readonly textureUrl: string;
  /** URL to the spritesheet JSON data (frame definitions). */
  readonly spritesheetUrl: string;
};

/**
 * The tile/atlas subset of a content pack manifest.
 *
 * The full manifest (ContentPackManifest) carries narrative data,
 * NPCs, quests, encounters, etc. This type captures only the fields
 * needed for texture resolution — the resolver doesn't depend on
 * the full manifest schema.
 */
export type ManifestAtlasData = {
  /** Pixel size of a single tile (must match map's tilewidth/tileheight). */
  readonly tileSize: number;
  /** Spritesheet atlas metadata. */
  readonly atlas: ManifestAtlas;
  /** Fallback texture filename rendered when a tile ID is unmatched. */
  readonly fallbackTile: string;
  /** Tile ID → tile definition mapping (string keys for JSON compat). */
  readonly tiles: Record<string, ManifestTileDef>;
  /** Entity key → entity definition mapping. */
  readonly entities?: Record<string, ManifestEntityDef>;
};

// ---------------------------------------------------------------------------
// ManifestAtlasResolver
// ---------------------------------------------------------------------------

/**
 * Resolves tile and entity texture lookups against a content pack's
 * spritesheet atlas, with graceful fallbacks.
 *
 * Every `getTileTexture()` / `getEntityTexture()` call is validated:
 * 1. Look up the tile/entity definition in the manifest.
 * 2. Resolve the frame key against the loaded PixiJS TextureCache.
 * 3. If the texture is invalid or missing, return the pack's fallback.
 *
 * This eliminates the white-square missing-texture placeholder that
 * appears when PixiJS fails to resolve a sprite key internally.
 *
 * Instantiate via `ManifestAtlasResolver.create(atlasData)`.
 */
export class ManifestAtlasResolver {
  /** The parsed atlas data from the manifest. */
  private readonly _atlasData: ManifestAtlasData;

  /** Whether {@link preloadAtlas} has been called and completed. */
  private _isPreloaded = false;

  /** The loaded base tileset texture — sliced into sub-textures per tile. */
  private _baseTexture: Texture | undefined;

  /** Memoized sub-texture cache keyed by local tile ID (1-based). */
  private readonly _tileTextureCache = new Map<number, Texture>();

  /** Memoized fallback texture — loaded once, reused indefinitely. */
  private _fallbackTexture: Texture | undefined;

  /** Memoized texture cache keyed by frame name (for entity sprites). */
  private readonly _textureCache = new Map<string, Texture>();

  constructor(atlasData: ManifestAtlasData) {
    this._atlasData = atlasData;
  }

  // ---- Public API ----

  /**
   * Preloads the spritesheet atlas into Pixi's Asset cache.
   *
   * When a `spritesheetUrl` is defined in the manifest atlas, loads
   * the JSON spritesheet definition which auto-loads the image and
   * registers every named frame in Pixi's TextureCache. After this
   * resolves, `Texture.from("grass.png")` returns the correct frame.
   *
   * When only `textureUrl` is defined (raw grid PNG, no spritesheet),
   * loads the raw image and falls back to grid-based slicing on lookup.
   *
   * Must be called (and awaited) before any `getTileTexture()` or
   * `getEntityTexture()` calls.
   *
   * Idempotent — subsequent calls are no-ops after the first success.
   *
   * @throws If the spritesheet or image fails to load (network error, 404).
   */
  async preloadAtlas(): Promise<void> {
    if (this._isPreloaded) {
      return;
    }

    const { textureUrl, spritesheetUrl } = this._atlasData.atlas;

    // Prefer spritesheet JSON — it auto-loads the image and registers
    // named frames (e.g., "grass.png", "brick.png") in the TextureCache.
    const loadUrl = spritesheetUrl || textureUrl;

    logger.debug('[ManifestAtlasResolver] preloadAtlas:start', { loadUrl });

    try {
      const loaded = await Assets.load(loadUrl);

      // Store the base texture for grid-based fallback slicing.
      // If a spritesheet was loaded, the texture is available via
      // Texture.from(textureUrl) since it's now in the Asset cache.
      if (spritesheetUrl) {
        // Spritesheet mode: the image was loaded as a dependency.
        // Texture.from() picks up the cached source.
        this._baseTexture = Texture.from(textureUrl);
      } else {
        // Raw grid mode: Assets.load() returned the texture directly.
        this._baseTexture = loaded instanceof Texture ? loaded : Texture.from(textureUrl);
      }

      this._isPreloaded = true;
      logger.debug('[ManifestAtlasResolver] preloadAtlas:complete', {
        loadUrl,
        mode: spritesheetUrl ? 'spritesheet' : 'grid',
        width: this._baseTexture.width,
        height: this._baseTexture.height,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[ManifestAtlasResolver] preloadAtlas:failed', { loadUrl, error: message });
      throw error;
    }
  }

  /** Whether the atlas has been preloaded and is ready for texture lookups. */
  get isPreloaded(): boolean {
    return this._isPreloaded;
  }

  /**
   * Resolves a numerical tile ID (1-based, manifest-local) to a PixiJS Texture.
   *
   * **Spritesheet mode** (atlas.spritesheetUrl defined): Looks up the tile
   * definition's `frame` key (e.g. "grass.png") in Pixi's TextureCache via
   * {@link _resolveFrame}. Named frames are registered when the spritesheet
   * JSON is loaded by {@link preloadAtlas}.
   *
   * **Grid mode** (raw PNG only): Computes the column/row position on the
   * base tileset image and crops a sub-texture using {@link Rectangle} framing.
   *
   * Tile 0 (empty) returns `undefined` — the caller should skip rendering.
   *
   * @param tileId - 1-based tile index (matches manifest tile keys).
   * @returns The resolved Texture, or `undefined` for empty tiles.
   */
  getTileTexture(tileId: number): Texture | undefined {
    if (tileId === 0) {
      return undefined;
    }

    // Check memoized cache
    const cached = this._tileTextureCache.get(tileId);
    if (cached) {
      return cached;
    }

    // Check for a manifest tile definition with a named frame
    const tileDef = this._atlasData.tiles[String(tileId)];
    const spritesheetUrl = this._atlasData.atlas.spritesheetUrl;

    if (spritesheetUrl && tileDef?.frame) {
      // Spritesheet mode: resolve by frame name from the loaded spritesheet
      const texture = this._resolveFrame(tileDef.frame);
      this._tileTextureCache.set(tileId, texture);
      return texture;
    }

    // Grid mode: slice sub-texture from the raw base image
    if (!this._baseTexture) {
      logger.warn('[ManifestAtlasResolver] Base texture not loaded. Call preloadAtlas() first.');
      return this._getFallbackTexture();
    }

    const tileSize = this._atlasData.tileSize;
    const baseWidth = this._baseTexture.width;
    const baseHeight = this._baseTexture.height;

    if (baseWidth === 0 || baseHeight === 0) {
      logger.warn('[ManifestAtlasResolver] Base texture has zero dimensions.');
      return this._getFallbackTexture();
    }

    // Convert 1-based tile ID to 0-based index for grid math
    const index = tileId - 1;
    const columns = Math.floor(baseWidth / tileSize) || 1;
    const rows = Math.floor(baseHeight / tileSize) || 1;
    const totalTiles = columns * rows;

    if (index >= totalTiles) {
      logger.warn(
        `[ManifestAtlasResolver] Tile ID ${tileId} out of range ` +
          `(grid ${columns}×${rows} = ${totalTiles} tiles). Using fallback.`,
      );
      return this._getFallbackTexture();
    }

    const col = index % columns;
    const row = Math.floor(index / columns);

    const subTexture = new Texture({
      source: this._baseTexture.source,
      frame: new Rectangle(col * tileSize, row * tileSize, tileSize, tileSize),
    });

    this._tileTextureCache.set(tileId, subTexture);
    return subTexture;
  }

  /**
   * Translates a raw Tiled GID to a manifest-local tile ID using the tileset's
   * `firstgid` offset, then resolves to a Texture.
   *
   * Tiled JSON uses Global Tile IDs (GIDs) that include the tileset's `firstgid`
   * as an offset. The manifest keys are 1-indexed local tile IDs. This method
   * handles the conversion:
   *
   *   `manifestKey = (rawGid - firstGid) + 1`
   *
   * Example: tileset firstgid=101, raw GID=101 → local tile 1 → manifest key "1"
   *
   * @param rawGid - The raw GID from the Tiled JSON layer data.
   * @param firstGid - The tileset's `firstgid` value (default: 1).
   * @returns The resolved Texture, or `undefined` for empty tiles (GID 0).
   */
  getTileTextureFromGid(rawGid: number, firstGid = 1): Texture | undefined {
    if (rawGid === 0) {
      return undefined;
    }

    // Convert Global Tile ID to 1-based local ID matching manifest keys
    const localTileId = rawGid - firstGid + 1;

    if (localTileId < 1) {
      logger.warn(
        `[ManifestAtlasResolver] GID ${rawGid} below firstgid ${firstGid}. Using fallback.`,
      );
      return this._getFallbackTexture();
    }

    return this.getTileTexture(localTileId);
  }

  /**
   * Resolves an entity key (e.g. "player_spawn") to a PixiJS Texture.
   *
   * Entity keys come from the manifest's `entities` map. If the key
   * is not found or the texture fails to load, the fallback is returned.
   *
   * @param entityKey - The entity key from the manifest.
   * @returns The resolved Texture, or the fallback texture if unmatched.
   */
  getEntityTexture(entityKey: string): Texture {
    const entityDef = this._atlasData.entities?.[entityKey];
    if (!entityDef) {
      logger.warn(`[ManifestAtlasResolver] Unmapped Entity Key: "${entityKey}". Using fallback.`);
      return this._getFallbackTexture();
    }

    return this._resolveFrame(entityDef.frame);
  }

  /**
   * Returns the tile definition for a given GID, if one is mapped.
   *
   * @param tileId - The tile GID from the map data.
   * @returns The tile definition, or `undefined` if unmapped.
   */
  getTileDef(tileId: number): ManifestTileDef | undefined {
    return this._atlasData.tiles[String(tileId)];
  }

  /**
   * Returns the entity definition for a given key, if one is mapped.
   *
   * @param entityKey - The entity key from the manifest.
   * @returns The entity definition, or `undefined` if unmapped.
   */
  getEntityDef(entityKey: string): ManifestEntityDef | undefined {
    return this._atlasData.entities?.[entityKey];
  }

  /**
   * Returns the pixel tile size declared in the atlas data.
   */
  get tileSize(): number {
    return this._atlasData.tileSize;
  }

  /**
   * Returns the atlas metadata (texture + spritesheet URLs).
   */
  get atlas(): ManifestAtlas {
    return this._atlasData.atlas;
  }

  /**
   * Clears the internal texture cache.
   *
   * Call when the spritesheet is reloaded (hot-reload) or when
   * switching content packs to free GPU memory. Resets the preload
   * flag so the next lookup triggers a fresh atlas load.
   */
  clearCache(): void {
    this._tileTextureCache.clear();
    this._textureCache.clear();
    this._fallbackTexture = undefined;
    this._baseTexture = undefined;
    this._isPreloaded = false;
  }

  // ---- Internal helpers ----

  /**
   * Resolves a frame key to a PixiJS Texture, falling back on failure.
   *
   * First checks the PixiJS Assets cache (populated by {@link preloadAtlas}).
   * If the frame key is not cached, returns `Texture.EMPTY` to prevent
   * PixiJS from rendering a white 1×1 placeholder.
   *
   * Caches resolved textures for subsequent lookups of the same frame.
   *
   * @param frameKey - The frame filename or spritesheet key.
   * @returns The resolved or fallback Texture.
   */
  private _resolveFrame(frameKey: string): Texture {
    // Check memoized cache first
    const cached = this._textureCache.get(frameKey);
    if (cached) {
      return cached;
    }

    // Check if the texture was loaded into the Assets cache.
    // After preloadAtlas() completes, the tileset image is registered,
    // and individual frame textures may be available as sub-textures.
    if (!this._isPreloaded) {
      logger.warn(
        `[ManifestAtlasResolver] Resolver not preloaded — frame "${frameKey}" may be empty.`,
      );
    }

    const texture = Texture.from(frameKey);

    // Texture.from() in v8 always returns a Texture (lazy). If the atlas
    // was preloaded the texture source should be valid. If the frame key
    // doesn't resolve to any cached source, the returned texture is a
    // 1×1 white pixel (Texture.WHITE). Detect this and return EMPTY instead.
    if (texture.width <= 1 && texture.height <= 1 && texture === Texture.WHITE) {
      logger.warn(
        `[ManifestAtlasResolver] Frame "${frameKey}" not found in Assets cache. Using EMPTY.`,
      );
      this._textureCache.set(frameKey, Texture.EMPTY);
      return Texture.EMPTY;
    }

    this._textureCache.set(frameKey, texture);
    return texture;
  }

  /**
   * Returns the pack's fallback texture, loading it lazily.
   *
   * The fallback texture is memoized — loaded once and reused for all
   * subsequent failed lookups. Returns `Texture.EMPTY` as the ultimate
   * safety net when even the fallback fails to load.
   */
  private _getFallbackTexture(): Texture {
    if (this._fallbackTexture) {
      return this._fallbackTexture;
    }

    const fallback = Texture.from(this._atlasData.fallbackTile);

    // If the fallback image isn't loaded, Texture.from returns Texture.WHITE.
    // Detect this and use Texture.EMPTY instead.
    if (fallback.width <= 1 && fallback.height <= 1 && fallback === Texture.WHITE) {
      this._fallbackTexture = Texture.EMPTY;
      return Texture.EMPTY;
    }

    this._fallbackTexture = fallback;
    return fallback;
  }
}
