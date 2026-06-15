// packages/frontend/engine/src/assets/map_loader.ts

import { logger } from '$logger';

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
  /** Whether the layer is visible in the Tiled editor. */
  visible: boolean;
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
};

/**
 * Options for loading a tilemap.
 */
export type MapLoaderOptions = {
  /** URL to the Tiled JSON file. */
  url: string;
  /** Optional fetch implementation (for testing / non-browser environments). */
  fetch?: typeof fetch;
};

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
  const { url } = options;

  const cached = _mapCache.get(url);
  if (cached) {
    logger.debug('loadTilemap:cache-hit', { url });
    return cached;
  }

  const fetcher = options.fetch ?? globalThis.fetch;
  const response = await fetcher(url);

  if (!response.ok) {
    throw new Error(`MapLoader: failed to fetch map at "${url}" (HTTP ${response.status})`);
  }

  const raw = await response.json();

  const data = _parseTilemap(raw, url);
  _mapCache.set(url, data);

  logger.debug('loadTilemap:parsed', {
    url,
    width: data.width,
    height: data.height,
    layers: data.layers.length,
    tilesets: data.tilesets.length,
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

  // Extract objectgroup layers (spawn points for NPCs and props)
  const objectLayers = _parseObjectLayers(rawLayers, url);

  return { width, height, tilewidth, tileheight, tilesets, layers, objectLayers };
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

  return { name, width, height, data, visible };
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

/**
 * Extracts the collision layer from a parsed tilemap.
 *
 * The collision layer is identified by name (default: "collision").
 * Non-zero tile IDs in this layer are treated as solid obstacles.
 *
 * @param tilemap - The parsed tilemap data.
 * @param options - Optional layer name override.
 * @returns A flat boolean array (true = solid) in row-major order,
 *   or `undefined` if no collision layer is found.
 */
export const extractCollisionGrid = (
  tilemap: TilemapData,
  options?: { layerName?: string },
): boolean[] | undefined => {
  const layerName = options?.layerName ?? 'collision';
  const layer = tilemap.layers.find((l) => l.name === layerName);

  if (!layer) {
    return undefined;
  }

  return layer.data.map((gid) => gid !== 0);
};
