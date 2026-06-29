// packages/frontend/engine/src/assets/jton_parser.ts

import { logger } from '$logger';
import type { TilemapData, TilemapLayer, TilemapTileset } from './map_loader.ts';

// ---------------------------------------------------------------------------
// JTON Parser — parses the token-optimized Zen Grid map format
//
// Contract C-175: High-speed parser for the JTON (JSON Tabular Object
// Notation) block-based map format. Splits by newlines, identifies
// block type via prefix, and hydrates into flat TypedArrays and
// structured TilemapData for direct ECS ingestion.
//
// Fixes (C-175 review):
//   1. Column definitions in headers: :tiles: ground 1 (x, y, tileId)
//   2. Comma-delimited data rows: 1,0,15 (BPE tokenizer compatible)
//   3. Zero-allocation: spawn/transition data written to flat arrays
//
// Format specification (see scripts/tiled/jton_exporter.js for full):
//   [:map: W H TILE_W TILE_H
//   :tileset: NAME FIRSTGID IMAGE IW IH TW TH COLS COUNT
//   :tiles: LAYER_NAME VISIBLE (x, y, tileId)   → COL,ROW,GID per line
//   :collision: (x, y)                           → COL,ROW per line
//   :spawn: X Y TYPE SPAWN_ID [...] (column_hint)
//   :transition: X Y W H TARGET_MAP [...] (column_hint)
//   ]
//
// Empty tiles (GID 0) are OMITTED. The parser fills omitted cells with 0.
// Parenthesized column hints in headers are skipped by the parser.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Zero-allocation spawn/transition output buffers
// ---------------------------------------------------------------------------

/**
 * Flat TypedArray output for spawn point data — direct bitECS ingestion.
 *
 * Spawn points are interleaved: [x, y, type_hash, spawn_hash, npc_hash, ...]
 * Each spawn occupies SPAWN_STRIDE entries.
 */
export const SPAWN_STRIDE = 8;
export const MAX_JTON_SPAWNS = 256;

/**
 * Flat TypedArray output for transition zone data.
 *
 * Transitions are interleaved: [x, y, w, h, targetMap_hash, targetSpawn_hash]
 * Each transition occupies TRANSITION_STRIDE entries.
 */
export const TRANSITION_STRIDE = 6;
export const MAX_JTON_TRANSITIONS = 64;

/**
 * A single spawn entry with original string fields preserved for
 * ObjectLayer conversion.
 */
export type JtonSpawnEntry = {
  x: number;
  y: number;
  type: string;
  spawnId: string;
  npcId?: string;
  isVendor?: boolean;
  vendorInventory?: string;
};

/**
 * A single transition entry with original target map string preserved.
 */
export type JtonTransitionEntry = {
  x: number;
  y: number;
  width: number;
  height: number;
  targetMap: string;
  targetSpawnId?: string;
};

/**
 * Result of parsing a JTON map string.
 */
export type JtonParseResult = {
  /** Tilemap metadata (dimensions, tile size). */
  mapWidth: number;
  /** Map height in tiles. */
  mapHeight: number;
  /** Tile width in pixels. */
  tileWidth: number;
  /** Tile height in pixels. */
  tileHeight: number;
  /** Tilesets referenced by this map. */
  tilesets: TilemapTileset[];
  /** All tile layers in draw order (bottom to top). */
  layers: TilemapLayer[];

  // ── Zero-allocation flat arrays (C-175 review fix 3) ──

  /** Number of spawn points in the spawn buffer. */
  spawnCount: number;
  /** Pre-allocated Float64Array for spawn data (interleaved fields). */
  spawnBuffer: Float64Array;
  /** Number of transition zones in the transition buffer. */
  transitionCount: number;
  /** Pre-allocated Float64Array for transition data (interleaved fields). */
  transitionBuffer: Float64Array;

  // ── String-preserving entries for ObjectLayer conversion (C-198) ──

  /** Original spawn entries with string fields preserved. */
  spawnEntries: JtonSpawnEntry[];
  /** Original transition entries with target map string preserved. */
  transitionEntries: JtonTransitionEntry[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a JTON map string into structured data with flat TypedArrays.
 *
 * @param source - The JTON-formatted map string.
 * @param sourceUrl - The URL/path the source was loaded from (for errors).
 * @returns A JtonParseResult with parsed map data.
 * @throws If the format is invalid or required fields are missing.
 */
export const parseJtonMap = (source: string, sourceUrl: string): JtonParseResult => {
  if (!source || typeof source !== 'string') {
    throw new Error(`JTON Parser: empty source at "${sourceUrl}"`);
  }

  const lines = source.split('\n');

  let mapWidth = 0;
  let mapHeight = 0;
  let tileWidth = 0;
  let tileHeight = 0;
  const tilesets: TilemapTileset[] = [];
  const layers: TilemapLayer[] = [];
  const collisionCells: { col: number; row: number }[] = [];

  // ── Zero-allocation spawn/transition buffers ──
  const spawnBuffer = new Float64Array(MAX_JTON_SPAWNS * SPAWN_STRIDE);
  let spawnCount = 0;
  const spawnEntries: JtonSpawnEntry[] = [];
  const transitionBuffer = new Float64Array(MAX_JTON_TRANSITIONS * TRANSITION_STRIDE);
  let transitionCount = 0;
  const transitionEntries: JtonTransitionEntry[] = [];

  // Temporary state for accumulating a tile layer
  let currentLayerName = '';
  let currentLayerVisible = false;
  const currentLayerTiles = new Map<string, number>();

  /** Current parsing mode: 'none' | 'tiles' | 'collision'. */
  let _parseMode: 'none' | 'tiles' | 'collision' = 'none';

  /**
   * Flushes the current accumulating tile layer into the layers array.
   */
  const _flushLayer = (): void => {
    if (!currentLayerName) {
      return;
    }

    const totalCells = mapWidth * mapHeight;
    const data: number[] = new Array(totalCells).fill(0);

    for (const [key, gid] of currentLayerTiles) {
      const [colStr, rowStr] = key.split(',');
      const col = Number(colStr);
      const row = Number(rowStr);
      if (col >= 0 && col < mapWidth && row >= 0 && row < mapHeight) {
        data[row * mapWidth + col] = gid;
      }
    }

    layers.push({
      name: currentLayerName,
      width: mapWidth,
      height: mapHeight,
      data,
      visible: currentLayerVisible,
    });

    currentLayerName = '';
    currentLayerVisible = false;
    currentLayerTiles.clear();
  };

  // ── Parse line by line ──
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    // Footer
    if (trimmed === ']') {
      _flushLayer();
      continue;
    }

    // ── Block headers ──
    if (trimmed.startsWith(':map:')) {
      // Strip optional column hint "(w, h, tw, th)" if present
      const clean = _stripColumnHint(trimmed.slice(6));
      const parts = clean.split(/\s+/).filter(Boolean);
      if (parts.length < 4) {
        throw new Error(`JTON Parser: invalid :map: header at "${sourceUrl}"`);
      }
      mapWidth = Number(parts[0]);
      mapHeight = Number(parts[1]);
      tileWidth = Number(parts[2]);
      tileHeight = Number(parts[3]);
      continue;
    }

    if (trimmed.startsWith(':tileset:')) {
      const clean = _stripColumnHint(trimmed.slice(10));
      const parts = clean.split(/\s+/).filter(Boolean);
      if (parts.length < 9) {
        throw new Error(`JTON Parser: invalid :tileset: at "${sourceUrl}"`);
      }
      tilesets.push({
        name: parts[0],
        firstgid: Number(parts[1]),
        image: parts[2],
        imagewidth: Number(parts[3]),
        imageheight: Number(parts[4]),
        tilewidth: Number(parts[5]),
        tileheight: Number(parts[6]),
        columns: Number(parts[7]),
        tilecount: Number(parts[8]),
        spacing: 0,
        margin: 0,
      });
      continue;
    }

    if (trimmed.startsWith(':tiles:')) {
      _flushLayer();
      _parseMode = 'tiles';
      const clean = _stripColumnHint(trimmed.slice(8));
      const parts = clean.split(/\s+/);
      currentLayerName = parts[0] || '';
      currentLayerVisible = Number(parts[1] || 1) !== 0;
      continue;
    }

    if (trimmed.startsWith(':collision:')) {
      _parseMode = 'collision';
      continue;
    }

    if (trimmed.startsWith(':spawn:')) {
      _parseMode = 'none';
      const clean = _stripColumnHint(trimmed.slice(8));
      const parts = clean.split(/\s+/);
      if (parts.length < 4) {
        continue;
      }
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const type = parts[2] || 'spawn';
      const spawnId = parts[3] || '';

      // Write directly to flat Float64Array (zero-allocation)
      if (spawnCount < MAX_JTON_SPAWNS) {
        const offset = spawnCount * SPAWN_STRIDE;
        const npcId = parts[4] || '';
        const isVendor = Number(parts[5] || 0);
        const vendorInv = parts[6] || '';
        spawnBuffer[offset] = x;
        spawnBuffer[offset + 1] = y;
        spawnBuffer[offset + 2] = _fastHash(type);
        spawnBuffer[offset + 3] = _fastHash(spawnId);
        spawnBuffer[offset + 4] = type === 'npc' ? _fastHash(npcId) : 0; // npcId hash
        spawnBuffer[offset + 5] = type === 'npc' ? _fastHash(npcId) : 0; // dialogue hash
        spawnBuffer[offset + 6] = type === 'npc' ? isVendor : 0; // isVendor
        spawnBuffer[offset + 7] = type === 'npc' ? _fastHash(vendorInv) : 0; // vendorInventory hash
        spawnCount += 1;

        // Preserve original strings for ObjectLayer conversion (C-198)
        spawnEntries.push({
          x,
          y,
          type,
          spawnId,
          ...(type === 'npc'
            ? { npcId, isVendor: isVendor !== 0, vendorInventory: vendorInv }
            : {}),
        });
      }
      continue;
    }

    if (trimmed.startsWith(':transition:')) {
      _parseMode = 'none';
      const clean = _stripColumnHint(trimmed.slice(13));
      const parts = clean.split(/\s+/);
      if (parts.length < 5) {
        continue;
      }

      if (transitionCount < MAX_JTON_TRANSITIONS) {
        const targetMap = parts[4] || '';
        const targetSpawnId = parts[5] || '';
        const offset = transitionCount * TRANSITION_STRIDE;
        transitionBuffer[offset] = Number(parts[0]); // x
        transitionBuffer[offset + 1] = Number(parts[1]); // y
        transitionBuffer[offset + 2] = Number(parts[2]); // w
        transitionBuffer[offset + 3] = Number(parts[3]); // h
        transitionBuffer[offset + 4] = _fastHash(targetMap); // targetMap hash
        transitionBuffer[offset + 5] = _fastHash(targetSpawnId); // targetSpawnId hash
        transitionCount += 1;

        // Preserve original strings for ObjectLayer conversion (C-198)
        transitionEntries.push({
          x: Number(parts[0]),
          y: Number(parts[1]),
          width: Number(parts[2]),
          height: Number(parts[3]),
          targetMap,
          ...(targetSpawnId ? { targetSpawnId } : {}),
        });
      }
      continue;
    }

    // ── Data rows (comma-delimited) ──
    if (_parseMode === 'tiles') {
      const parts = trimmed.split(',');
      if (parts.length >= 3) {
        const col = Number(parts[0]);
        const row = Number(parts[1]);
        const gid = Number(parts[2]);
        currentLayerTiles.set(`${col},${row}`, gid);
      }
    } else if (_parseMode === 'collision') {
      const parts = trimmed.split(',');
      if (parts.length >= 2) {
        collisionCells.push({ col: Number(parts[0]), row: Number(parts[1]) });
      }
    }
  }

  // Validate required map header
  if (mapWidth <= 0 || mapHeight <= 0) {
    throw new Error(`JTON Parser: missing or invalid :map: header at "${sourceUrl}"`);
  }

  // If collision cells were parsed, create a collision layer
  if (collisionCells.length > 0 && mapWidth > 0 && mapHeight > 0) {
    const data: number[] = new Array(mapWidth * mapHeight).fill(0);
    for (const { col, row } of collisionCells) {
      if (col >= 0 && col < mapWidth && row >= 0 && row < mapHeight) {
        data[row * mapWidth + col] = 1;
      }
    }
    layers.push({
      name: 'collision',
      width: mapWidth,
      height: mapHeight,
      data,
      visible: false,
    });
  }

  logger.debug('jton_parser:parsed', {
    url: sourceUrl,
    mapWidth,
    mapHeight,
    layers: layers.length,
    tilesets: tilesets.length,
    spawns: spawnCount,
    transitions: transitionCount,
  });

  return {
    mapWidth,
    mapHeight,
    tileWidth,
    tileHeight,
    tilesets,
    layers,
    spawnCount,
    spawnBuffer,
    transitionCount,
    transitionBuffer,
    spawnEntries,
    transitionEntries,
  };
};

// ---------------------------------------------------------------------------
// JTON → TilemapData conversion
// ---------------------------------------------------------------------------

/**
 * Converts a JTON parse result into the standard {@link TilemapData}
 * format used by the existing map loading pipeline (C-135, C-171).
 *
 * Also converts the zero-allocation spawn/transition flat arrays into
 * {@link ObjectLayer} entries so {@link extractSpawnPoints} and
 * {@link extractTransitionZones} can process them like Tiled JSON maps.
 *
 * @param parsed - The parsed JTON map data.
 * @returns A TilemapData struct compatible with loadTilemap output.
 */
export const jtonToTilemapData = (parsed: JtonParseResult): TilemapData => {
  // Convert spawn buffer to ObjectLayer entries
  const objectLayers: import('./map_loader.ts').ObjectLayer[] = [];

  // Spawns → object group
  if (parsed.spawnEntries && parsed.spawnEntries.length > 0) {
    const spawnObjects: Record<string, unknown>[] = [];
    for (let i = 0; i < parsed.spawnEntries.length; i++) {
      const entry = parsed.spawnEntries[i];
      const properties: { name: string; type: string; value: unknown }[] = [
        { name: 'spawnId', type: 'string', value: entry.spawnId || `spawn_${i}` },
      ];
      if (entry.npcId) {
        properties.push({ name: 'npcId', type: 'string', value: entry.npcId });
      }
      if (entry.isVendor) {
        properties.push({ name: 'isVendor', type: 'bool', value: true });
        if (entry.vendorInventory) {
          properties.push({
            name: 'vendorInventory',
            type: 'string',
            value: entry.vendorInventory,
          });
        }
      }
      spawnObjects.push({
        id: `jton_spawn_${i}`,
        type: entry.type || 'npc',
        x: entry.x,
        y: entry.y,
        properties,
      });
    }
    objectLayers.push({ name: 'objects', objects: spawnObjects });
  }

  // Transitions → object group (merged with spawns)
  if (parsed.transitionEntries && parsed.transitionEntries.length > 0) {
    const transitionObjects: Record<string, unknown>[] = [];
    for (let i = 0; i < parsed.transitionEntries.length; i++) {
      const entry = parsed.transitionEntries[i];

      if (!entry.targetMap) {
        continue;
      }

      transitionObjects.push({
        id: `jton_transition_${i}`,
        type: 'transition',
        x: entry.x,
        y: entry.y,
        width: entry.width || 32,
        height: entry.height || 32,
        properties: [
          { name: 'targetMap', type: 'string', value: entry.targetMap },
          { name: 'targetX', type: 'float', value: entry.x },
          { name: 'targetY', type: 'float', value: entry.y },
          ...(entry.targetSpawnId
            ? [{ name: 'targetSpawnId', type: 'string', value: entry.targetSpawnId }]
            : []),
        ],
      });
    }
    // Append to or create object layer
    const existing = objectLayers[0];
    if (existing) {
      existing.objects.push(...transitionObjects);
    } else {
      objectLayers.push({ name: 'objects', objects: transitionObjects });
    }
  }

  return {
    width: parsed.mapWidth,
    height: parsed.mapHeight,
    tilewidth: parsed.tileWidth,
    tileheight: parsed.tileHeight,
    tilesets: parsed.tilesets,
    layers: parsed.layers,
    ...(objectLayers.length > 0 ? { objectLayers } : {}),
  };
};

// ---------------------------------------------------------------------------
// Internal: fast string hash (DJB2 — same as map_loader.ts)
// ---------------------------------------------------------------------------

/**
 * DJB2 hash for converting string identifiers to numeric hashes.
 *
 * Zero-allocation, pure integer math. Same algorithm as
 * {@link djb2Hash} in map_loader.ts.
 *
 * @param str - The string to hash.
 * @returns A 32-bit unsigned integer hash.
 */
const _fastHash = (str: string): number => {
  if (!str) {
    return 0;
  }
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
};

// ---------------------------------------------------------------------------
// Internal: strip column hint from header line
// ---------------------------------------------------------------------------

/**
 * Strips the parenthesized column hint from a header line.
 *
 * E.g., `"ground 1 (x, y, tileId)"` → `"ground 1"`.
 *
 * The column hint is documentation for the LLM — the parser ignores it.
 *
 * @param header - The header content (after the `:type:` prefix).
 * @returns The header with the column hint removed.
 */
const _stripColumnHint = (header: string): string => {
  const parenIndex = header.indexOf('(');
  if (parenIndex >= 0) {
    return header.slice(0, parenIndex).trim();
  }
  return header;
};
