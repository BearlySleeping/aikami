// packages/frontend/engine/src/assets/tilemap_object_layers.ts
//
// Tiled object-layer parsing and spawn-point extraction.
//
// Extracted from `map_loader.ts`, which had grown into a grab bag of fetching,
// caching, tile parsing, object parsing and grid building. These helpers are
// pure functions over raw Tiled JSON / `TilemapData` with no loader state, so
// they belong in their own module.
//
// `map_loader.ts` re-exports `extractSpawnPoints` and consumes the shared field
// readers, so the public surface is unchanged.

import { logger } from '$logger';
import type { ObjectLayer, SpawnPoint, TilemapData } from './map_loader.ts';

/**
 * Extracts a required numeric field from a raw object.
 */
export const readNumberField = (obj: Record<string, unknown>, key: string, url: string): number => {
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
export const readStringField = (obj: Record<string, unknown>, key: string, url: string): string => {
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
export const parseObjectLayers = (
  rawLayers: Record<string, unknown>[],
  url: string,
): ObjectLayer[] | undefined => {
  const objectGroups = rawLayers.filter((layer) => layer.type === 'objectgroup');

  if (objectGroups.length === 0) {
    return undefined;
  }

  return objectGroups.map((layer) => {
    const name = readStringField(layer, 'name', url);
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
      const spawnPoint = parseSpawnPoint(object, objectLayer.name);
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
export const parseSpawnPoint = (
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

  const properties = extractProperties(object);

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
export const extractProperties = (object: Record<string, unknown>): Record<string, unknown> => {
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
