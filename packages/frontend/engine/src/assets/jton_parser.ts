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
// Format specification (see scripts/tiled/jton_exporter.js for full):
//   [:map: W H TILE_W TILE_H
//   :tileset: NAME FIRSTGID IMAGE IW IH TW TH COLS COUNT
//   :tiles: LAYER_NAME VISIBLE   → COL ROW GID per line
//   :collision:                  → COL ROW per line
//   :spawn: X Y TYPE SPAWN_ID [NPC_ID] [DIALOGUE] [IS_VENDOR] [INVENTORY]
//   :transition: X Y W H TARGET_MAP [TARGET_SPAWN_ID]
//   ]
//
// Empty tiles (GID 0) are OMITTED in the JTON format. The parser fills
// omitted cells with 0 during hydration.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A spawn point parsed from a JTON `:spawn:` block.
 */
export type JtonSpawnPoint = {
  /** X pixel coordinate. */
  x: number;
  /** Y pixel coordinate. */
  y: number;
  /** Entity type (player, npc, enemy, prop, item). */
  type: string;
  /** Spawn point string identifier (for C-172 resolution). */
  spawnId: string;
  /** NPC-specific: display name / ID. */
  npcId?: string;
  /** NPC-specific: initial dialogue text (underscores = spaces). */
  dialogue?: string;
  /** NPC-specific: whether this NPC is a vendor. */
  isVendor?: boolean;
  /** NPC-specific: comma-separated vendor inventory item IDs. */
  vendorInventory?: string;
};

/**
 * A transition zone parsed from a JTON `:transition:` block.
 */
export type JtonTransitionZone = {
  /** X pixel coordinate. */
  x: number;
  /** Y pixel coordinate. */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Target map filename or ID. */
  targetMap: string;
  /** Target spawn point string identifier (for C-172 resolution). */
  targetSpawnId: string;
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
  /** Spawn points from :spawn: blocks. */
  spawnPoints: JtonSpawnPoint[];
  /** Transition zones from :transition: blocks. */
  transitionZones: JtonTransitionZone[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a JTON map string into structured data.
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
  const spawnPoints: JtonSpawnPoint[] = [];
  const transitionZones: JtonTransitionZone[] = [];

  // Temporary state for accumulating a tile layer
  let currentLayerName = '';
  let currentLayerVisible = false;
  // Map of `"row,col"` → GID for the current layer
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

    // Skip empty lines
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
      const parts = trimmed.slice(6).split(/\s+/).filter(Boolean);
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
      const parts = trimmed.slice(10).split(/\s+/).filter(Boolean);
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
      const parts = trimmed.slice(8).split(/\s+/);
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
      const parts = trimmed.slice(8).split(/\s+/);
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const type = parts[2] || 'spawn';
      const spawnId = parts[3] || '';

      if (type === 'npc') {
        const dialogue = (parts[4] || '').replace(/_/g, ' ');
        const isVendor = Number(parts[5] || 0) !== 0;
        const vendorInventory = (parts[6] || '').replace(/_/g, ' ');
        spawnPoints.push({
          x,
          y,
          type: 'npc',
          spawnId,
          npcId: spawnId,
          dialogue,
          isVendor,
          vendorInventory,
        });
      } else if (type === 'enemy') {
        const npcName = (parts[4] || spawnId).replace(/_/g, ' ');
        spawnPoints.push({ x, y, type: 'enemy', spawnId, npcId: spawnId, dialogue: npcName });
      } else {
        spawnPoints.push({ x, y, type, spawnId });
      }
      continue;
    }

    if (trimmed.startsWith(':transition:')) {
      const parts = trimmed.slice(13).split(/\s+/);
      transitionZones.push({
        x: Number(parts[0]),
        y: Number(parts[1]),
        width: Number(parts[2]),
        height: Number(parts[3]),
        targetMap: parts[4] || '',
        targetSpawnId: parts[5] || '',
      });
      continue;
    }

    // ── Data rows (tile data or collision data) ──
    // Tile data: COL ROW GID
    // Collision: COL ROW
    if (_parseMode === 'tiles') {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const col = Number(parts[0]);
        const row = Number(parts[1]);
        const gid = Number(parts[2]);
        currentLayerTiles.set(`${col},${row}`, gid);
      }
    } else if (_parseMode === 'collision') {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        collisionCells.push({ col: Number(parts[0]), row: Number(parts[1]) });
      }
    }
  }

  // If collision cells were parsed, create a collision layer
  if (collisionCells.length > 0 && mapWidth > 0 && mapHeight > 0) {
    const data: number[] = new Array(mapWidth * mapHeight).fill(0);
    for (const { col, row } of collisionCells) {
      if (col >= 0 && col < mapWidth && row >= 0 && row < mapHeight) {
        data[row * mapWidth + col] = 1; // Non-zero = solid
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

  // Validate required map header
  if (mapWidth <= 0 || mapHeight <= 0) {
    throw new Error(`JTON Parser: missing or invalid :map: header at "${sourceUrl}"`);
  }

  logger.debug('jton_parser:parsed', {
    url: sourceUrl,
    mapWidth,
    mapHeight,
    layers: layers.length,
    tilesets: tilesets.length,
    spawns: spawnPoints.length,
    transitions: transitionZones.length,
  });

  return {
    mapWidth,
    mapHeight,
    tileWidth,
    tileHeight,
    tilesets,
    layers,
    spawnPoints,
    transitionZones,
  };
};

// ---------------------------------------------------------------------------
// JTON → TilemapData conversion
// ---------------------------------------------------------------------------

/**
 * Converts a JTON parse result into the standard {@link TilemapData}
 * format used by the existing map loading pipeline (C-135, C-171).
 *
 * This allows JTON maps to feed into the same render/collision/spawn
 * pipelines as Tiled JSON maps.
 *
 * @param parsed - The parsed JTON map data.
 * @returns A TilemapData struct compatible with loadTilemap output.
 */
export const jtonToTilemapData = (parsed: JtonParseResult): TilemapData => {
  return {
    width: parsed.mapWidth,
    height: parsed.mapHeight,
    tilewidth: parsed.tileWidth,
    tileheight: parsed.tileHeight,
    tilesets: parsed.tilesets,
    layers: parsed.layers,
  };
};
