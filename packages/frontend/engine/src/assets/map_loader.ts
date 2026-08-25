// packages/frontend/engine/src/assets/map_loader.ts

import type { PackConfig } from '@aikami/types';
import { logger } from '$logger';
import type { CollisionGrid } from '../systems/collision_system.ts';
import {
  buildTerrainGridFromBoolean,
  buildTerrainGridFromChannel,
  collectTerrainCostDefs,
  type TerrainGrid,
} from '../systems/terrain_grid.ts';
import { jtonToTilemapData, parseJtonMap } from './jton_parser.ts';

// ---------------------------------------------------------------------------
// Map Asset Loader — parses Tiled JSON tilemap format
//
// Contract C-135: Loads and caches 2D tilemap data, extracts dimensions,
// tilesets, and layers including a dedicated collision layer for the
// physics system.
// ---------------------------------------------------------------------------

/**
 * Tiled JSON tileset reference.
 *
 * Maps a range of GIDs (starting at `firstgid`) to a single spritesheet image.
 */
export type TilemapTileset = {
  /** First global tile ID in this tileset. */
  firstgid: number;
  /** Human-readable name of the tileset. */
  name: string;
  /** Path to the tileset image file. */
  image: string;
  /** Width of the source image in pixels. */
  imagewidth: number;
  /** Height of the source image in pixels. */
  imageheight: number;
  /** Width of a single tile in pixels. */
  tilewidth: number;
  /** Height of a single tile in pixels. */
  tileheight: number;
  /** Number of tile columns in the source image. */
  columns: number;
  /** Total number of tiles in this tileset. */
  tilecount: number;
  /** Spacing between tiles in the source image (default 0). */
  spacing?: number;
  /** Margin around the tile grid in the source image (default 0). */
  margin?: number;
};

/**
 * A single layer from a Tiled tilemap.
 */
export type TilemapLayer = {
  /** Layer name (e.g., "ground", "walls", "collision"). */
  name: string;
  /** Layer width in tiles. */
  width: number;
  /** Layer height in tiles. */
  height: number;
  /** Flat array of tile GIDs, row-major order. 0 = empty tile. */
  data: number[];
  /**
   * C-379: per-cell Tiled flip flags, row-major order, parallel to `data`.
   * Bit 0x80000000 = horizontal, 0x40000000 = vertical, 0x20000000 =
   * diagonal (anti-diagonal flip). The high bits are masked OFF `data` at
   * parse time — every downstream GID consumer sees a clean ID — and the
   * flip state is carried here for the renderer to apply via UV swaps.
   */
  flips?: readonly number[];
  /**
   * C-378 terrain layers: flat array of frame NAMES, row-major order.
   * `0` = empty. When present, the chunk renderer resolves frames by name
   * through the atlas (never GIDs).
   */
  frames?: readonly (string | 0)[];
  /** Whether the layer is visible in the Tiled editor. */
  visible: boolean;
  /**
   * Render band (C-378). Declared via the layer's `band` custom property
   * with a documented default of `'ground'` — never sniffed from the name.
   */
  band?: TilemapBand;
};

/**
 * A spawn point extracted from a Tiled objectgroup layer.
 *
 * Each object in an objectgroup is mapped to a SpawnPoint
 * with its type, position, and custom properties.
 */
export type SpawnPoint = {
  /** Unique identifier from the Tiled object. */
  id: string;
  /** Object type (e.g., 'npc', 'prop'). */
  type: string;
  /** X position in pixels. */
  x: number;
  /** Y position in pixels. */
  y: number;
  /** Custom properties defined in Tiled (e.g., npcId, dialogueKey). */
  properties: Record<string, unknown>;
};

/**
 * A transition zone extracted from a Tiled objectgroup layer.
 *
 * Objects with `type: 'transition'` in Tiled are parsed into
 * TransitionZones that define map-to-map travel. When the player
 * steps into the zone's bounding rectangle, the zoning system
 * triggers a map transition to the target map at the given coordinates.
 *
 * Contract: C-138 Map Transitions
 */
export type TransitionZone = {
  /** Unique identifier from the Tiled object. */
  id: string;
  /** X position in pixels (top-left of the trigger rectangle). */
  x: number;
  /** Y position in pixels (top-left of the trigger rectangle). */
  y: number;
  /** Width of the trigger rectangle in pixels. */
  width: number;
  /** Height of the trigger rectangle in pixels. */
  height: number;
  /** Target map filename or ID to transition to. */
  targetMap: string;
  /** Target X pixel coordinate on the destination map. */
  targetX: number;
  /** Target Y pixel coordinate on the destination map. */
  targetY: number;
  /**
   * String identifier of the spawn point on the destination map (C-172).
   *
   * When set, the engine resolves this to coordinates via SpawnPoint
   * entities on the destination map. Hashed to a numeric value for
   * bitECS component storage.
   */
  targetSpawnId?: string;
};

/**
 * A raw objectgroup layer extracted from Tiled JSON.
 *
 * Stored on TilemapData for later extraction via
 * {@link extractSpawnPoints}.
 */
export type ObjectLayer = {
  /** Layer name. */
  name: string;
  /** Raw Tiled objects in this group. */
  objects: Record<string, unknown>[];
};

/**
 * A spawn point entity extracted from Tiled for C-172 decoupled coordinates.
 *
 * Objects with `type === 'spawn'` in Tiled objectgroup layers are parsed
 * into SpawnPointEntity entries. Each entry has a string identifier
 * (`spawnId` from custom properties) and pixel coordinates.
 *
 * Contract: C-172 Staging World Transitions
 */
export type SpawnPointEntity = {
  /** String identifier (e.g., 'town_spawn', 'forest_entrance'). */
  spawnId: string;
  /** Numeric hash of the spawnId for bitECS component storage. */
  spawnHash: number;
  /** X position in pixels. */
  x: number;
  /** Y position in pixels. */
  y: number;
};

/**
 * Fully parsed Tiled JSON tilemap.
 */
export type TilemapData = {
  /** Map width in tiles. */
  width: number;
  /** Map height in tiles. */
  height: number;
  /** Tile width in pixels. */
  tilewidth: number;
  /** Tile height in pixels. */
  tileheight: number;
  /** Tilesets referenced by this map. */
  tilesets: TilemapTileset[];
  /** All tile layers in draw order (bottom to top). */
  layers: TilemapLayer[];
  /** Objectgroup layers extracted from the map (if any). */
  objectLayers?: ObjectLayer[];
  /**
   * Semantic terrain channel (C-378). Row-major, one terrain id per cell;
   * `''` / omitted = the pack's base terrain. Absent → legacy baked-GID
   * render path.
   */
  terrain?: readonly string[];
  /**
   * Reserved elevation channel (C-378). Row-major int8, all zeros until
   * cliffs land. Parsed and carried, never consumed.
   */
  elevation?: readonly number[];
};

/**
 * A tile layer's render band (C-378). Ground renders below every entity,
 * decor below entities but above ground, overhead above every entity.
 * The engine does NOT infer the band from the layer name — a `band`
 * property on the layer (Tiled custom property) declares it.
 */
export type TilemapBand = 'ground' | 'decor' | 'overhead';

/** Default band when a layer declares no `band` property (Tiled default). */
export const DEFAULT_TILEMAP_BAND: TilemapBand = 'ground';

/**
 * Options for loading a tilemap.
 */
/**
 * Resolves a published asset tag (e.g. "maps:sandbox_zone_a") to a URL the
 * caller can fetch — a cached blob URL, an origin URL, or a bundled static
 * path. Returns null when the tag is unknown, so the caller can fall back.
 */
export type AssetTagResolver = (tag: string) => string | null;

/** Options both loaders gain, alongside their existing fields. */
export type RegistryBackedLoadOptions = {
  /** Injected by the client composition root; absent in tests and headless use. */
  resolveTag?: AssetTagResolver;
  /** Released after the fetched bytes are parsed, to revoke refcounted blob URLs. */
  releaseUrl?: (url: string) => void;
};

export type MapLoaderOptions = {
  /** URL to the Tiled JSON file. */
  url: string;
  /** Optional fetch implementation (for testing / non-browser environments). */
  fetch?: typeof fetch;
} & RegistryBackedLoadOptions;

/**
 * In-memory cache of parsed tilemap data, keyed by URL.
 */
const _mapCache = new Map<string, TilemapData>();

/**
 * Fetches and parses a Tiled JSON tilemap from the given URL.
 *
 * Results are cached in memory — subsequent requests for the same URL
 * return the cached data immediately without re-fetching.
 *
 * @param options - URL and optional fetch override.
 * @returns The parsed tilemap data.
 * @throws If the fetch fails, the JSON is invalid, or required fields are missing.
 */
export const loadTilemap = async (options: MapLoaderOptions): Promise<TilemapData> => {
  const { url, resolveTag, releaseUrl } = options;

  const cached = _mapCache.get(url);
  if (cached) {
    logger.debug('loadTilemap:cache-hit', { url });
    return cached;
  }

  // C-434: resolve the URL through the asset registry when a resolver is
  // provided — cache blob URL, origin URL, or bundled static path.
  const resolvedUrl = resolveTag ? resolveTag(url) ?? url : url;
  const fetcher = options.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetcher(resolvedUrl);
  } catch {
    // Fetch rejected (network error, blob URL revoked, etc.) — release the
    // resolved URL and fall back to the bundled path.
    if (resolvedUrl !== url) {
      releaseUrl?.(resolvedUrl);
      logger.debug('loadTilemap:registry-fetch-failed', { url, resolvedUrl });
      const fallbackResponse = await fetcher(url);
      if (!fallbackResponse.ok) {
        throw new Error(
          `MapLoader: failed to fetch map at "${url}" (HTTP ${fallbackResponse.status})`,
        );
      }
      const fallbackRaw = await fallbackResponse.json();
      const fallbackData = _parseTilemap(fallbackRaw, url);
      _mapCache.set(url, fallbackData);
      logger.debug('loadTilemap:parsed-from-fallback', {
        url,
        width: fallbackData.width,
        height: fallbackData.height,
        layers: fallbackData.layers.length,
        tilesets: fallbackData.tilesets.length,
      });
      return fallbackData;
    }
    throw new Error(`MapLoader: failed to fetch map at "${url}" (fetch rejected)`);
  }

  if (!response.ok) {
    // If the resolved URL differs from the original, try the original as
    // fallback (bundled path).
    if (resolvedUrl !== url) {
      releaseUrl?.(resolvedUrl);
      logger.debug('loadTilemap:registry-fallback', { url, resolvedUrl, status: response.status });
      const fallbackResponse = await fetcher(url);
      if (!fallbackResponse.ok) {
        throw new Error(
          `MapLoader: failed to fetch map at "${url}" (HTTP ${fallbackResponse.status})`,
        );
      }
      const fallbackRaw = await fallbackResponse.json();
      const fallbackData = _parseTilemap(fallbackRaw, url);
      _mapCache.set(url, fallbackData);
      logger.debug('loadTilemap:parsed-from-fallback', {
        url,
        width: fallbackData.width,
        height: fallbackData.height,
        layers: fallbackData.layers.length,
        tilesets: fallbackData.tilesets.length,
      });
      return fallbackData;
    }
    throw new Error(`MapLoader: failed to fetch map at "${url}" (HTTP ${response.status})`);
  }

  const raw = await response.json();

  // Release the blob URL after parsing — the data is now in memory and the
  // URL is no longer needed.
  if (releaseUrl && resolvedUrl !== url) {
    releaseUrl(resolvedUrl);
  }

  const data = _parseTilemap(raw, url);
  _mapCache.set(url, data);

  logger.debug('loadTilemap:parsed', {
    url,
    width: data.width,
    height: data.height,
    layers: data.layers.length,
    tilesets: data.tilesets.length,
    source: resolvedUrl !== url ? 'registry' : 'static',
  });

  return data;
};

/**
 * Clears the in-memory map cache.
 *
 * Useful for testing or hot-reloading during development.
 */
export const clearMapCache = (): void => {
  _mapCache.clear();
};

// ---------------------------------------------------------------------------
// JTON Map Loading (C-175)
// ---------------------------------------------------------------------------

/**
 * Options for loading a JTON map.
 */
export type JtonMapLoaderOptions = {
  /** URL to the JTON map file. */
  url: string;
  /** Optional fetch implementation (for testing / non-browser environments). */
  fetch?: typeof fetch;
} & RegistryBackedLoadOptions;

/**
 * Fetches and parses a JTON (Zen Grid) tilemap from the given URL.
 *
 * Results are cached in memory — subsequent requests for the same URL
 * return the cached data immediately without re-fetching.
 *
 * The returned {@link TilemapData} is compatible with the existing
 * render/collision/spawn pipelines (C-135, C-171, C-172, C-173).
 *
 * @param options - URL and optional fetch override.
 * @returns The parsed tilemap data.
 * @throws If the fetch fails, the JTON is invalid, or required fields are missing.
 */
export const loadJtonMap = async (options: JtonMapLoaderOptions): Promise<TilemapData> => {
  const { url, resolveTag, releaseUrl } = options;

  const cached = _mapCache.get(url);
  if (cached) {
    logger.debug('loadJtonMap:cache-hit', { url });
    return cached;
  }

  // C-434: resolve the URL through the asset registry when a resolver is
  // provided — cache blob URL, origin URL, or bundled static path.
  const resolvedUrl = resolveTag ? resolveTag(url) ?? url : url;
  const fetcher = options.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetcher(resolvedUrl);
  } catch {
    // Fetch rejected (network error, blob URL revoked, etc.) — release the
    // resolved URL and fall back to the bundled path.
    if (resolvedUrl !== url) {
      releaseUrl?.(resolvedUrl);
      logger.debug('loadJtonMap:registry-fetch-failed', { url, resolvedUrl });
      const fallbackResponse = await fetcher(url);
      if (!fallbackResponse.ok) {
        throw new Error(
          `MapLoader: failed to fetch JTON map at "${url}" (HTTP ${fallbackResponse.status})`,
        );
      }
      const fallbackSource = await fallbackResponse.text();
      const fallbackParsed = parseJtonMap(fallbackSource, url);
      const fallbackData = jtonToTilemapData(fallbackParsed);
      _mapCache.set(url, fallbackData);
      logger.debug('loadJtonMap:parsed-from-fallback', {
        url,
        width: fallbackData.width,
        height: fallbackData.height,
        layers: fallbackData.layers.length,
        tilesets: fallbackData.tilesets.length,
      });
      return fallbackData;
    }
    throw new Error(`MapLoader: failed to fetch JTON map at "${url}" (fetch rejected)`);
  }

  if (!response.ok) {
    // If the resolved URL differs from the original, try the original as
    // fallback (bundled path).
    if (resolvedUrl !== url) {
      releaseUrl?.(resolvedUrl);
      logger.debug('loadJtonMap:registry-fallback', { url, resolvedUrl, status: response.status });
      const fallbackResponse = await fetcher(url);
      if (!fallbackResponse.ok) {
        throw new Error(
          `MapLoader: failed to fetch JTON map at "${url}" (HTTP ${fallbackResponse.status})`,
        );
      }
      const fallbackSource = await fallbackResponse.text();
      const fallbackParsed = parseJtonMap(fallbackSource, url);
      const fallbackData = jtonToTilemapData(fallbackParsed);
      _mapCache.set(url, fallbackData);
      logger.debug('loadJtonMap:parsed-from-fallback', {
        url,
        width: fallbackData.width,
        height: fallbackData.height,
        layers: fallbackData.layers.length,
        tilesets: fallbackData.tilesets.length,
      });
      return fallbackData;
    }
    throw new Error(`MapLoader: failed to fetch JTON map at "${url}" (HTTP ${response.status})`);
  }

  const source = await response.text();

  // Release the blob URL after parsing — the data is now in memory and the
  // URL is no longer needed.
  if (releaseUrl && resolvedUrl !== url) {
    releaseUrl(resolvedUrl);
  }

  const parsed = parseJtonMap(source, url);

  const data = jtonToTilemapData(parsed);
  _mapCache.set(url, data);

  logger.debug('loadJtonMap:parsed', {
    url,
    width: data.width,
    height: data.height,
    layers: data.layers.length,
    tilesets: data.tilesets.length,
    source: resolvedUrl !== url ? 'registry' : 'static',
  });

  return data;
};

// ---------------------------------------------------------------------------
// Tiled flip flags (C-379 AC-9)
// ---------------------------------------------------------------------------

/** Horizontal flip bit (Tiled GID flag). */
export const TILED_FLIP_H = 0x80000000;

/** Vertical flip bit (Tiled GID flag). */
export const TILED_FLIP_V = 0x40000000;

/** Diagonal (anti-diagonal) flip bit (Tiled GID flag). */
export const TILED_FLIP_D = 0x20000000;

/**
 * Mask of the three flip bits. After masking, the remaining value is the
 * clean global tile ID. Also the mask that keeps only the flip bits (for
 * reading them back) — one authoritative mask, two uses (CodeRabbit
 * review, C-379).
 */
export const TILED_FLIP_MASK = TILED_FLIP_H | TILED_FLIP_V | TILED_FLIP_D;

/**
 * Alias of {@link TILED_FLIP_MASK} retained for the engine's public barrel
 * (index.ts exports both names; consumers may use either).
 */
export const TILED_FLIP_BITS = TILED_FLIP_MASK;

// ---------------------------------------------------------------------------
// Internal parsing
// ---------------------------------------------------------------------------

/**
 * Validates and parses raw Tiled JSON into a {@link TilemapData} struct.
 */
const _parseTilemap = (raw: Record<string, unknown>, url: string): TilemapData => {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`MapLoader: invalid JSON at "${url}"`);
  }

  const width = _getNumber(raw, 'width', url);
  const height = _getNumber(raw, 'height', url);
  const tilewidth = _getNumber(raw, 'tilewidth', url);
  const tileheight = _getNumber(raw, 'tileheight', url);

  if (width <= 0 || height <= 0) {
    throw new Error(`MapLoader: invalid dimensions (${width}×${height}) at "${url}"`);
  }

  if (tilewidth <= 0 || tileheight <= 0) {
    throw new Error(`MapLoader: invalid tile size (${tilewidth}×${tileheight}) at "${url}"`);
  }

  const rawTilesets = raw.tilesets as Record<string, unknown>[] | undefined;
  if (!Array.isArray(rawTilesets)) {
    throw new Error(`MapLoader: missing or invalid "tilesets" array at "${url}"`);
  }

  const tilesets = rawTilesets.map((ts) => _parseTileset(ts, url));

  const rawLayers = raw.layers as Record<string, unknown>[] | undefined;
  if (!Array.isArray(rawLayers)) {
    throw new Error(`MapLoader: missing or invalid "layers" array at "${url}"`);
  }

  const tileLayers = rawLayers.filter((layer) => layer.type === 'tilelayer');

  if (tileLayers.length === 0) {
    throw new Error(`MapLoader: no tile layers found at "${url}"`);
  }

  const layers = tileLayers.map((layer) => _parseLayer(layer, width, height, url));

  // C-378: parse the additive `aikami` channel block (terrain + elevation).
  // Absent → legacy baked-GID path. Unknown fields are ignored so old
  // tools writing extra metadata never break parsing.
  const aikami = raw.aikami as Record<string, unknown> | undefined;
  let terrain: string[] | undefined;
  let elevation: number[] | undefined;
  if (aikami && typeof aikami === 'object') {
    if (Array.isArray(aikami.terrain)) {
      const expectedLength = width * height;
      if (aikami.terrain.length !== expectedLength) {
        throw new Error(
          `MapLoader: aikami.terrain length (${aikami.terrain.length}) ` +
            `doesn't match map dimensions (expected ${expectedLength}) at "${url}"`,
        );
      }
      terrain = aikami.terrain.map((v: unknown): string => (typeof v === 'string' ? v : ''));
    } else if (aikami.terrain !== undefined) {
      // C-378: malformed terrain channel — the map still loads on the
      // legacy baked-GID path, but the author needs to know the channel
      // was ignored (a non-array here would otherwise be silently dropped).
      const bad = aikami.terrain;
      logger.warn('loadTilemap:invalid-terrain', {
        url,
        type: typeof bad,
        value: typeof bad === 'string' ? bad.slice(0, 40) : undefined,
        hint: 'aikami.terrain must be an array of terrain-id strings — falling back to the baked-GID path (C-378).',
      });
    }
    if (Array.isArray(aikami.elevation)) {
      const expectedLength = width * height;
      if (aikami.elevation.length !== expectedLength) {
        throw new Error(
          `MapLoader: aikami.elevation length (${aikami.elevation.length}) ` +
            `doesn't match map dimensions (expected ${expectedLength}) at "${url}"`,
        );
      }
      elevation = aikami.elevation.map((v: unknown): number => {
        const n = Number(v);
        return Number.isInteger(n) ? n : 0;
      });
    }
  }

  // Extract objectgroup layers (spawn points for NPCs and props)
  const objectLayers = _parseObjectLayers(rawLayers, url);

  return {
    width,
    height,
    tilewidth,
    tileheight,
    tilesets,
    layers,
    objectLayers,
    terrain,
    elevation,
  };
};

/**
 * Parses a single tileset entry from raw JSON.
 */
const _parseTileset = (raw: Record<string, unknown>, url: string): TilemapTileset => {
  const firstgid = _getNumber(raw, 'firstgid', url);
  const name = _getString(raw, 'name', url);
  const image = _getString(raw, 'image', url);
  const imagewidth = _getNumber(raw, 'imagewidth', url);
  const imageheight = _getNumber(raw, 'imageheight', url);
  const tilewidth = _getNumber(raw, 'tilewidth', url);
  const tileheight = _getNumber(raw, 'tileheight', url);
  const columns = _getNumber(raw, 'columns', url);
  const tilecount = _getNumber(raw, 'tilecount', url);

  return {
    firstgid,
    name,
    image,
    imagewidth,
    imageheight,
    tilewidth,
    tileheight,
    columns,
    tilecount,
    spacing: typeof raw.spacing === 'number' ? raw.spacing : 0,
    margin: typeof raw.margin === 'number' ? raw.margin : 0,
  };
};

/**
 * Parses a single tile layer from raw JSON.
 */
const _parseLayer = (
  raw: Record<string, unknown>,
  expectedWidth: number,
  expectedHeight: number,
  url: string,
): TilemapLayer => {
  const name = _getString(raw, 'name', url);
  const width = _getNumber(raw, 'width', url);
  const height = _getNumber(raw, 'height', url);
  const visible = raw.visible !== false;

  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `MapLoader: layer "${name}" dimensions (${width}×${height}) ` +
        `don't match map (${expectedWidth}×${expectedHeight}) at "${url}"`,
    );
  }

  const rawData = raw.data;
  if (!Array.isArray(rawData)) {
    throw new Error(`MapLoader: layer "${name}" has no "data" array at "${url}"`);
  }

  const expectedLength = width * height;
  if (rawData.length !== expectedLength) {
    throw new Error(
      `MapLoader: layer "${name}" data length (${rawData.length}) ` +
        `doesn't match dimensions (expected ${expectedLength}) at "${url}"`,
    );
  }

  const data = rawData.map((v: unknown): number => {
    const num = Number(v);
    if (!Number.isInteger(num) || num < 0) {
      throw new Error(
        `MapLoader: layer "${name}" contains invalid tile ID "${String(v)}" at "${url}"`,
      );
    }
    return num;
  });

  // C-379 AC-9: mask Tiled flip flags at parse time, once. The high bits
  // (H/V/D) are stripped from every GID so downstream consumers — collision
  // building, terrain cost, manifest resolution, chunk UV lookup — always
  // see a clean ID and a flipped tile never becomes a phantom solid cell.
  // The flip state is carried on the layer for the renderer to apply via
  // UV swaps (C-379 watch point: strip alone fixes collision but renders
  // the wrong orientation).
  //
  // Allocate the flips array LAZILY — only when a nonzero flipBits value
  // is actually encountered — so layers without flipped tiles stay
  // `flips: undefined` and consumers keep receiving 0 via their existing
  // fallback (CodeRabbit review, C-379).
  let flips: number[] | undefined;
  for (let i = 0; i < expectedLength; i++) {
    const gid = data[i] as number;
    const flipBits = (gid & TILED_FLIP_MASK) >>> 0;
    if (flipBits !== 0) {
      flips ??= new Array<number>(expectedLength).fill(0);
      flips[i] = flipBits;
      data[i] = (gid & ~TILED_FLIP_MASK) >>> 0;
    }
  }

  // C-378: layer `band` custom property (Tiled properties array). The
  // engine never sniffs the band from the layer name — an explicit
  // property with a documented default of 'ground'.
  let band: TilemapBand | undefined;
  const props = raw.properties;
  if (Array.isArray(props)) {
    for (const entry of props) {
      if (
        entry &&
        typeof entry === 'object' &&
        (entry as { name?: unknown }).name === 'band' &&
        typeof (entry as { value?: unknown }).value === 'string'
      ) {
        const value = (entry as { value: string }).value;
        if (value === 'ground' || value === 'decor' || value === 'overhead') {
          band = value;
        } else {
          logger.warn('loadTilemap:invalid-band', { layer: name, band: value, url });
        }
      }
    }
  }

  return { name, width, height, data, flips, visible, band };
};

/**
 * Extracts a required numeric field from a raw object.
 */
const _getNumber = (obj: Record<string, unknown>, key: string, url: string): number => {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `MapLoader: missing or invalid "${key}" field (got "${String(value)}") at "${url}"`,
    );
  }
  return value;
};

/**
 * Extracts a required string field from a raw object.
 */
const _getString = (obj: Record<string, unknown>, key: string, url: string): string => {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `MapLoader: missing or invalid "${key}" field (got "${String(value)}") at "${url}"`,
    );
  }
  return value;
};

/**
 * Parses objectgroup layers from raw Tiled JSON into {@link ObjectLayer} entries.
 *
 * Returns `undefined` when no objectgroup layers are present —
 * this keeps TilemapData compact for maps without spawn data.
 */
const _parseObjectLayers = (
  rawLayers: Record<string, unknown>[],
  url: string,
): ObjectLayer[] | undefined => {
  const objectGroups = rawLayers.filter((layer) => layer.type === 'objectgroup');

  if (objectGroups.length === 0) {
    return undefined;
  }

  return objectGroups.map((layer) => {
    const name = _getString(layer, 'name', url);
    const objects = layer.objects as Record<string, unknown>[] | undefined;

    if (!Array.isArray(objects)) {
      throw new Error(`MapLoader: objectgroup layer "${name}" has no "objects" array at "${url}"`);
    }

    return { name, objects };
  });
};

/**
 * Extracts spawn points from all objectgroup layers in a parsed tilemap.
 *
 * Each Tiled object is mapped to a {@link SpawnPoint} with its type,
 * pixel position, and custom properties.
 *
 * @param tilemap - The parsed tilemap data.
 * @returns Flat array of spawn points, or empty array if no object layers exist.
 */
export const extractSpawnPoints = (tilemap: TilemapData): SpawnPoint[] => {
  if (!tilemap.objectLayers || tilemap.objectLayers.length === 0) {
    return [];
  }

  const spawnPoints: SpawnPoint[] = [];

  for (const objectLayer of tilemap.objectLayers) {
    for (const object of objectLayer.objects) {
      const spawnPoint = _parseSpawnPoint(object, objectLayer.name);
      if (spawnPoint) {
        spawnPoints.push(spawnPoint);
      }
    }
  }

  return spawnPoints;
};

/**
 * Parses a single Tiled object into a {@link SpawnPoint}.
 *
 * Tiled objects can define custom properties in two formats:
 * - An array of `{ name, type, value }` entries (Tiled 1.x)
 * - A flat `{ key: value }` object (some Tiled exporters)
 *
 * Objects without a `type` field are skipped (they carry no spawn logic).
 */
const _parseSpawnPoint = (
  object: Record<string, unknown>,
  layerName: string,
): SpawnPoint | undefined => {
  const id = object.id;
  if (id === undefined) {
    logger.debug('_parseSpawnPoint:skipped-no-id', { layerName });
    return undefined;
  }

  const type = object.type;
  if (typeof type !== 'string' || type.length === 0) {
    logger.debug('_parseSpawnPoint:skipped-no-type', { layerName, id });
    return undefined;
  }

  const x = typeof object.x === 'number' ? object.x : 0;
  const y = typeof object.y === 'number' ? object.y : 0;

  const properties = _extractProperties(object);

  return {
    id: String(id),
    type,
    x,
    y,
    properties,
  };
};

/**
 * Extracts custom properties from a Tiled object.
 *
 * Handles both array-style `[{ name, type, value }]` and
 * flat-object `{ key: value }` property formats.
 */
const _extractProperties = (object: Record<string, unknown>): Record<string, unknown> => {
  const raw = object.properties;

  // Array format: [{ name: "key", type: "string", value: "val" }]
  if (Array.isArray(raw)) {
    const result: Record<string, unknown> = {};
    for (const entry of raw) {
      if (entry && typeof entry === 'object' && 'name' in entry && 'value' in entry) {
        const { name, value } = entry as { name: string; value: unknown };
        if (typeof name === 'string' && name.length > 0) {
          result[name] = value;
        }
      }
    }
    return result;
  }

  // Flat object format: { key: value }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }

  return {};
};

// ---------------------------------------------------------------------------
// String hashing — DJB2 for spawn/portal ID resolution (C-172)
// ---------------------------------------------------------------------------

/**
 * DJB2 hash function for converting string identifiers to numeric hashes.
 *
 * Used to store spawn point and portal target IDs in bitECS numeric
 * component arrays. DJB2 is chosen for simplicity, speed, and low
 * collision rate for short ASCII strings (map names, spawn IDs).
 *
 * @param str - The string to hash.
 * @returns A 32-bit unsigned integer hash.
 */
export const djb2Hash = (str: string): number => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
};

// ---------------------------------------------------------------------------
// Spawn point entity extraction (C-172)
// ---------------------------------------------------------------------------

/**
 * Extracts spawn point entities from all objectgroup layers in a tilemap.
 *
 * Objects with `type === 'spawn'` are parsed into {@link SpawnPointEntity}
 * entries. Each entry requires a `spawnId` custom property (string) and
 * carries pixel coordinates. The `spawnHash` is computed via {@link djb2Hash}.
 *
 * @param tilemap - The parsed tilemap data.
 * @returns Flat array of spawn point entities, or empty array if none exist.
 */
export const extractSpawnPointEntities = (tilemap: TilemapData): SpawnPointEntity[] => {
  if (!tilemap.objectLayers || tilemap.objectLayers.length === 0) {
    return [];
  }

  const entities: SpawnPointEntity[] = [];

  for (const objectLayer of tilemap.objectLayers) {
    for (const object of objectLayer.objects) {
      if (object.type !== 'spawn') {
        continue;
      }

      const properties = _extractProperties(object);
      const spawnId = properties.spawnId;
      if (typeof spawnId !== 'string' || spawnId.length === 0) {
        logger.debug('extractSpawnPointEntities:skipped-no-spawnId', {
          layer: objectLayer.name,
          id: object.id,
        });
        continue;
      }

      entities.push({
        spawnId,
        spawnHash: djb2Hash(spawnId),
        x: typeof object.x === 'number' ? object.x : 0,
        y: typeof object.y === 'number' ? object.y : 0,
      });
    }
  }

  return entities;
};

/**
 * Extracts the collision layer from a parsed tilemap.
 *
 * The collision layer is identified by name (default: "collision").
 * Non-zero tile IDs in this layer are treated as solid obstacles.
 *
 * C-376: the water-GID merge was removed — manifest walkability is now the
 * source of truth for terrain solidity (see {@link buildCollisionGrid});
 * this legacy function only reads the explicit collision layer. It remains
 * for maps without a content pack (e.g. dev sandbox maps) and as the parity
 * reference for {@link buildCollisionGrid}.
 *
 * @param tilemap - The parsed tilemap data.
 * @param options - Optional layer name override.
 * @param options.layerName - Collision layer name (default: "collision").
 * @returns A flat boolean array (true = solid) in row-major order,
 *   or `undefined` if no collision layer is found.
 */
export const extractCollisionGrid = (
  tilemap: TilemapData,
  options?: { layerName?: string },
): boolean[] | undefined => {
  const layerName = options?.layerName ?? 'collision';

  const totalCells = tilemap.width * tilemap.height;

  // Start with an empty grid (all false = walkable)
  const grid = new Array<boolean>(totalCells).fill(false) as boolean[];
  let hasAnyBlocked = false;

  // Explicit collision layer
  const collisionLayer = tilemap.layers.find((l) => l.name === layerName);
  if (collisionLayer) {
    for (let i = 0; i < totalCells; i++) {
      if (collisionLayer.data[i] !== 0) {
        grid[i] = true;
        hasAnyBlocked = true;
      }
    }
  }

  // Return undefined only if no collision layer contributed any blocked cells.
  // Differentiate from a collision layer of all zeros (empty but present).
  if (!hasAnyBlocked && !collisionLayer) {
    return undefined;
  }

  return grid;
};

/**
 * Builds the collision grid from the content-pack manifest — the manifest
 * is the single source of truth for terrain solidity (C-376 AC-1).
 *
 * **Terrain channel path (C-378 AC-2 / AC-4):** when the map carries an
 * `aikami.terrain` channel AND the pack declares `terrains`, solidity is
 * derived from each cell's terrain `isWalkable` + the explicit `collision`
 * layer — resolved GIDs are EXCLUDED from the collision path entirely.
 * This is the load-bearing invariant of C-378: a cell's walkability comes
 * from its terrain, never from the tile drawn on it, so a grass cell
 * rendering a water-edge overlay frame stays walkable. The explicit
 * `collision` layer stays additive (it can only add solidity).
 *
 * **Legacy GID path:** maps without a terrain channel (or packs without
 * `terrains`) derive solidity from `packConfig.tiles[gid].isWalkable`,
 * gated by `solidityLayers` (C-376). GID 0 (empty) is always walkable;
 * unknown GID → `warn` + solid (fail-closed).
 *
 * @param tilemap - The parsed tilemap data.
 * @param packConfig - The resolved pack config (tiles + props + terrains).
 *   When undefined (manifest resolution failed), falls back to the explicit
 *   collision layer only — all non-collision GIDs are walkable (the
 *   graceful-degradation path, C-376 AC-2 watch point).
 * @param options - Optional behavior overrides.
 * @param options.layerName - Collision layer name (default: "collision").
 * @param options.solidityLayers - When provided, ONLY these tile layers
 *   contribute manifest solidity; every other non-collision tile layer is
 *   treated as visual-only (CodeRabbit review, C-376). Omitted → all
 *   non-collision tile layers contribute (C-376 contract default). In the
 *   terrain-channel path this option is ignored — terrain solidity comes
 *   from terrain ids, not baked layers.
 * @returns A flat boolean array (true = solid) in row-major order,
 *   or `undefined` if no cell is blocked.
 */
export const buildCollisionGrid = (
  tilemap: TilemapData,
  packConfig: PackConfig | undefined,
  options?: { layerName?: string; solidityLayers?: string[] },
): boolean[] | undefined => {
  const layerName = options?.layerName ?? 'collision';
  const solidityLayers = options?.solidityLayers;

  // Graceful degradation: when no pack config is available (manifest
  // resolution failed), mirror the legacy explicit-collision-layer
  // extraction — non-collision GIDs stay walkable, the collision layer
  // still blocks. This matches the pre-C-376 map behavior for packless
  // maps and the AC-2 degraded path.
  if (!packConfig) {
    return extractCollisionGrid(tilemap, { layerName });
  }

  const totalCells = tilemap.width * tilemap.height;

  // Start with an empty grid (all false = walkable)
  const grid = new Array<boolean>(totalCells).fill(false) as boolean[];
  let hasAnyBlocked = false;

  // 0. Terrain-channel path (C-378 AC-2): when the map declares a terrain
  //    channel and the pack declares terrains, walkability is derived from
  //    the terrain ids alone — NEVER from resolved GIDs. This is the
  //    invariant that makes the whole terrain design safe.
  if (tilemap.terrain && packConfig.terrains && packConfig.terrains.length > 0) {
    const terrains = packConfig.terrains;
    const terrainWalkability = new Map<string, boolean>();
    for (const t of terrains) {
      terrainWalkability.set(t.name, t.isWalkable);
    }
    const baseTerrain = [...terrains].sort((a, b) => a.precedence - b.precedence)[0];
    const unknownTerrains = new Set<string>();
    for (let i = 0; i < totalCells; i++) {
      const id = tilemap.terrain[i] ?? '';
      const resolved = id === '' ? baseTerrain.name : id;
      const walkable = terrainWalkability.get(resolved);
      if (walkable === undefined) {
        unknownTerrains.add(resolved);
        // Unknown terrain → base terrain walkability (failure recovery).
        if (!baseTerrain.isWalkable) {
          grid[i] = true;
          hasAnyBlocked = true;
        }
        continue;
      }
      if (!walkable) {
        grid[i] = true;
        hasAnyBlocked = true;
      }
    }
    if (unknownTerrains.size > 0) {
      logger.warn('buildCollisionGrid:unknown-terrain', {
        terrains: [...unknownTerrains].sort(),
        hint: 'Declare these ids in manifest.terrains — treated as the base terrain (C-378).',
      });
    }

    // 2. Explicit collision layer — additive only. Never re-opens a
    //    terrain-solid cell.
    const collisionLayer = tilemap.layers.find((l) => l.name === layerName);
    if (collisionLayer) {
      for (let i = 0; i < totalCells; i++) {
        if (collisionLayer.data[i] !== 0) {
          grid[i] = true;
          hasAnyBlocked = true;
        }
      }
    }

    // Return undefined only if no layer contributed any blocked cells.
    if (!hasAnyBlocked && !collisionLayer) {
      return undefined;
    }

    return grid;
  }

  const tiles = packConfig.tiles;

  // 1. Manifest-driven solidity from tile layers (ground/decor).
  //    GID 0 = empty = walkable; unknown GID = warn + solid (fail-closed).
  //    When solidityLayers is provided, only those layers contribute — all
  //    other non-collision layers are visual-only and never block.
  //    Unknown GIDs are collected per layer and warned ONCE after the loop
  //    (not once per cell) — CodeRabbit review, C-376 round 2.
  for (const layer of tilemap.layers) {
    // Skip the collision layer itself and objectgroup layers (no data).
    if (layer.name === layerName || !Array.isArray(layer.data)) {
      continue;
    }
    if (solidityLayers && !solidityLayers.includes(layer.name)) {
      continue;
    }
    const unknownGids = new Set<number>();
    for (let i = 0; i < totalCells; i++) {
      const gid = layer.data[i] ?? 0;
      if (gid === 0) {
        continue; // empty cell — walkable by definition
      }
      // C-379 AC-9: resolve through the single GID convention
      // (localId = rawGid - firstgid). Manifest tiles are keyed 1-based
      // local IDs, so the lookup key is localId + 1. Previously the raw GID
      // was used directly — correct only while every firstgid === 1.
      const resolved = resolveGid(gid, tilemap.tilesets);
      const manifestKey = resolved ? String(resolved.localId + 1) : String(gid);
      const tileDef = tiles[manifestKey];
      if (!tileDef) {
        unknownGids.add(gid);
        grid[i] = true;
        hasAnyBlocked = true;
        continue;
      }
      if (!tileDef.isWalkable) {
        grid[i] = true;
        hasAnyBlocked = true;
      }
    }
    if (unknownGids.size > 0) {
      logger.warn('buildCollisionGrid:unknown-gid', {
        gids: [...unknownGids].sort((a, b) => a - b),
        layer: layer.name,
        hint: 'Declare these GIDs in manifest.tiles — treating as solid (fail-closed).',
      });
    }
  }

  // 2. Explicit collision layer — additive only. Never re-opens a
  //    manifest-solid cell.
  const collisionLayer = tilemap.layers.find((l) => l.name === layerName);
  if (collisionLayer) {
    for (let i = 0; i < totalCells; i++) {
      if (collisionLayer.data[i] !== 0) {
        grid[i] = true;
        hasAnyBlocked = true;
      }
    }
  }

  // Return undefined only if no layer contributed any blocked cells.
  if (!hasAnyBlocked && !collisionLayer) {
    return undefined;
  }

  return grid;
};

/**
 * Resolves a (flip-masked) raw GID to a tileset + 0-based local ID.
 *
 * C-379 AC-9: THE single GID convention. `localId = rawGid - firstgid`.
 * Every downstream consumer (collision building, manifest tile lookup,
 * chunk UV sampling) resolves through this function — none of them should
 * see `firstgid` again. `rawGid` must already have flip bits masked
 * ({\@link _parseLayer} does this); passing a flipped GID here would
 * resolve to a wrong tileset.
 *
 * @param rawGid - The (clean) global tile ID.
 * @param tilesets - The map's tilesets (any order; highest firstgid wins).
 * @returns The matching tileset and 0-based local ID, or undefined when
 *   the GID is 0/empty or matches no tileset.
 */
export const resolveGid = <T extends { firstgid: number; tilecount: number }>(
  rawGid: number,
  tilesets: readonly T[],
): { tileset: T; localId: number } | undefined => {
  if (rawGid === 0) {
    return undefined;
  }
  // JSDoc contract: tilesets may be provided in ANY order. Select the
  // tileset with the HIGHEST firstgid that does not exceed rawGid, then
  // require the localId to fall within that tileset's tilecount — no
  // reliance on reverse iteration order or an early break (CodeRabbit
  // review, C-379).
  let best: T | undefined;
  for (const tileset of tilesets) {
    if (rawGid < tileset.firstgid) {
      continue;
    }
    if (best === undefined || tileset.firstgid > best.firstgid) {
      best = tileset;
    }
  }
  if (!best) {
    return undefined;
  }
  const localId = rawGid - best.firstgid;
  if (localId >= best.tilecount) {
    return undefined;
  }
  return { tileset: best, localId };
};

/**
 * Builds the authoritative TerrainGrid for a map (C-379 AC-4).
 *
 * Terrain-channel path: when the map carries an `aikami.terrain` channel
 * AND the pack declares `terrains`, cost + blocksSight derive from the pack
 * terrain defs (movementCost × 16, blocksSight flag), with the explicit
 * collision layer staying additive.
 *
 * Legacy fallback: maps without a terrain channel (or a terrain-less pack)
 * derive cost 0/16 from the boolean collision grid, with blocksSight
 * mirroring solidity.
 *
 * @param options.tilemap - The parsed tilemap.
 * @param options.packConfig - The resolved pack config (may be undefined).
 * @param options.collisionGrid - The legacy boolean grid (used as fallback
 *   and as the additive collision layer for channel maps).
 * @returns A TerrainGrid ready to cross the worker boundary.
 */
export const buildTerrainGridForMap = (options: {
  tilemap: TilemapData;
  packConfig: PackConfig | undefined;
  collisionGrid: CollisionGrid | undefined;
}): TerrainGrid => {
  const { tilemap, packConfig, collisionGrid } = options;

  // Non-square tiles are unsupported (the grid encodes a single tileSize);
  // surface the mismatch so an authoring error is visible instead of
  // silently sampling with the wrong aspect (CodeRabbit review, C-379).
  if (tilemap.tilewidth !== tilemap.tileheight) {
    logger.warn('buildTerrainGridForMap:non-square-tiles', {
      tilewidth: tilemap.tilewidth,
      tileheight: tilemap.tileheight,
      hint: 'Non-square tiles are not supported — tileSize uses tilewidth.',
    });
  }

  if (tilemap.terrain && packConfig?.terrains && packConfig.terrains.length > 0) {
    const terrainDefs = collectTerrainCostDefs(packConfig);
    const baseTerrain = [...packConfig.terrains].sort((a, b) => a.precedence - b.precedence)[0];
    return buildTerrainGridFromChannel({
      width: tilemap.width,
      height: tilemap.height,
      tileSize: tilemap.tilewidth,
      terrain: tilemap.terrain,
      terrainDefs,
      baseTerrainName: baseTerrain?.name ?? '',
      legacySolid: collisionGrid?.grid,
    });
  }

  if (collisionGrid) {
    return buildTerrainGridFromBoolean(collisionGrid);
  }

  // No collision data at all — fully walkable grid (packless sandbox maps).
  const cellCount = tilemap.width * tilemap.height;
  return {
    width: tilemap.width,
    height: tilemap.height,
    tileSize: tilemap.tilewidth,
    cost: new Uint8Array(cellCount).fill(16),
    blocksSight: new Uint8Array(cellCount),
  };
};

/**
 * Extracts transition zones from all objectgroup layers in a parsed tilemap.
 *
 * Objects with `type === 'transition'` are parsed into {@link TransitionZone}
 * entries. Each zone requires custom properties `targetMap` (string),
 * `targetX` (number), and `targetY` (number). The object's bounding
 * rectangle defines the trigger area.
 *
 * @param tilemap - The parsed tilemap data.
 * @returns Flat array of transition zones, or empty array if none exist.
 */
export const extractTransitionZones = (tilemap: TilemapData): TransitionZone[] => {
  if (!tilemap.objectLayers || tilemap.objectLayers.length === 0) {
    return [];
  }

  const zones: TransitionZone[] = [];

  for (const objectLayer of tilemap.objectLayers) {
    for (const object of objectLayer.objects) {
      const zone = _parseTransitionZone(object);
      if (zone) {
        zones.push(zone);
      }
    }
  }

  return zones;
};

/**
 * Parses a single Tiled object into a {@link TransitionZone}.
 *
 * Only objects with `type === 'transition'` are parsed. The required
 * custom properties are `targetMap`, `targetX`, and `targetY`.
 * Objects without these properties are silently skipped.
 */
const _parseTransitionZone = (object: Record<string, unknown>): TransitionZone | undefined => {
  if (object.type !== 'transition') {
    return undefined;
  }

  const id = object.id;
  if (id === undefined) {
    return undefined;
  }

  const properties = _extractProperties(object);

  const targetMap = properties.targetMap;
  if (typeof targetMap !== 'string' || targetMap.length === 0) {
    return undefined;
  }

  const targetX = properties.targetX;
  if (typeof targetX !== 'number') {
    return undefined;
  }

  const targetY = properties.targetY;
  if (typeof targetY !== 'number') {
    return undefined;
  }

  const targetSpawnId =
    typeof properties.targetSpawnId === 'string' ? properties.targetSpawnId : undefined;

  if (!targetSpawnId) {
    logger.warn(
      '[map_loader] Transition without targetSpawnId — spawn will fall back to hardcoded ' +
        `targetX/targetY (${targetX},${targetY}). Add a "targetSpawnId" property referencing ` +
        `a "spawn" marker on map "${targetMap}" to keep portals synced.`,
      { id: String(id) },
    );
  }

  return {
    id: String(id),
    x: typeof object.x === 'number' ? object.x : 0,
    y: typeof object.y === 'number' ? object.y : 0,
    width: typeof object.width === 'number' ? object.width : 0,
    height: typeof object.height === 'number' ? object.height : 0,
    targetMap,
    targetX,
    targetY,
    targetSpawnId,
  };
};
