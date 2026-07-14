// scripts/src/lib/ops/jton_exporter.js
//
// JTON (JSON Tabular Object Notation) / Zen Grid exporter for Tiled maps.
//
// Contract C-175: Outputs token-optimized map data in the JTON Zen Grid
// format. Strips all Tiled UI/editor metadata (opacity, tints, isTileLayer,
// editor visuals). Reduces file size and LLM token count by ~60% compared
// to standard Tiled JSON.
//
// Cognitive Anchoring (C-175 review): Column definitions are embedded in
// block headers (e.g., `:tiles: ground 1 (x, y, tileId)`) so the LLM has
// an explicit structural reference for self-attention. Data rows use
// comma delimiters for BPE tokenizer compatibility.
//
// Usage: Load in Tiled via Edit → Preferences → Plugins.
//        Export as "JTON Map (*.jton)".
//
// Format specification:
//   [:map: W H TILE_W TILE_H
//   :tileset: NAME FIRSTGID IMAGE IW IH TW TH COLS COUNT
//   :tiles: LAYER_NAME VISIBLE (x, y, tileId)
//   COL,ROW,GID
//   :collision: (x, y)
//   COL,ROW
//   :spawn: X Y TYPE SPAWN_ID (x, y, type, spawnId, [npcId], [dialogue], [isVendor], [vendorInventory])
//   :transition: X Y W H TARGET_MAP (x, y, w, h, targetMap, [targetSpawnId])
//   ]
//
// Rules:
//   - Blocks are separated by newlines.
//   - Block type determined by prefix (":map:", ":tileset:", etc.).
//   - Data rows are comma-delimited values.
//   - Empty tiles (GID 0) are OMITTED from :tiles: blocks.
//   - Collision tiles list only their coordinates (GID > 0 implies solid).
//   - Parenthesized column hints in headers are documentation for the LLM;
//     the parser skips them.

// ---------------------------------------------------------------------------
// Tiled JS API registration
// ---------------------------------------------------------------------------

const jtonMapFormat = {
  name: 'JTON Map (Zen Grid)',
  extension: 'jton',

  /**
   * Writes the current Tiled map in JTON/Zen Grid format.
   *
   * @param {import('tiled').TileMap} map - The Tiled map object.
   * @param {string} fileName - The target file name.
   * @returns {string} The JTON-formatted map string.
   */
  write(map, _fileName) {
    const lines = [];

    // ── Map header ──
    lines.push(`:map: ${map.width} ${map.height} ${map.tileWidth} ${map.tileHeight}`);

    // ── Tilesets ──
    for (const ts of map.tilesets) {
      if (!ts.isCollection) {
        const image = ts.imageFileName || `${ts.name}.png`;
        lines.push(
          `:tileset: ${ts.name} ${ts.firstGid} ${image} ${ts.imageWidth} ${ts.imageHeight} ${ts.tileWidth} ${ts.tileHeight} ${ts.columnCount || 0} ${ts.tileCount}`,
        );
      }
    }

    // ── Tile layers ──
    for (const layer of map.layers) {
      if (!layer.isTileLayer) {
        continue;
      }

      // Collision layer: only write solid cells (GID > 0)
      if (layer.name === 'collision') {
        lines.push(':collision: (x, y)');
        for (let row = 0; row < layer.height; row++) {
          for (let col = 0; col < layer.width; col++) {
            const cell = layer.cellAt(col, row);
            if (cell && !cell.empty) {
              lines.push(`${col},${row}`);
            }
          }
        }
        continue;
      }

      // Regular tile layer: write non-empty tiles
      const visible = layer.visible ? 1 : 0;
      lines.push(`:tiles: ${layer.name} ${visible} (x, y, tileId)`);
      for (let row = 0; row < layer.height; row++) {
        for (let col = 0; col < layer.width; col++) {
          const cell = layer.cellAt(col, row);
          if (cell && !cell.empty) {
            lines.push(`${col},${row},${cell.tileId}`);
          }
        }
      }
    }

    // ── Object layers (spawns + transitions) ──
    for (const layer of map.layers) {
      if (!layer.isObjectLayer) {
        continue;
      }

      for (const obj of layer.objects) {
        if (!obj?.type) {
          continue;
        }

        if (obj.type === 'spawn') {
          const props = _getProperties(obj);
          const spawnId = props.spawnId || '';
          const npcId = props.npcId || '';
          const dialogue = (props.dialogueKey || props.dialog || '').replace(/\s+/g, '_');
          const isVendor = props.isVendor ? 1 : 0;
          const vendorInventory = (props.vendorInventory || '').replace(/\s+/g, '_');

          if (obj.type === 'spawn' && !spawnId && !npcId) {
            continue;
          }

          if (npcId) {
            lines.push(
              `:spawn: ${Math.round(obj.x)} ${Math.round(obj.y)} npc ${npcId} ${dialogue} ${isVendor} ${vendorInventory}` +
                ' (x, y, type, spawnId, dialogue, isVendor, vendorInventory)',
            );
          } else {
            lines.push(
              `:spawn: ${Math.round(obj.x)} ${Math.round(obj.y)} ${obj.type || 'spawn'} ${spawnId}` +
                ' (x, y, type, spawnId)',
            );
          }
        } else if (obj.type === 'transition') {
          const props = _getProperties(obj);
          const targetMap = props.targetMap || '';
          const targetSpawn = props.targetSpawnId || '';
          lines.push(
            `:transition: ${Math.round(obj.x)} ${Math.round(obj.y)} ${Math.round(obj.width)} ${Math.round(obj.height)} ${targetMap} ${targetSpawn}` +
              ' (x, y, w, h, targetMap, targetSpawnId)',
          );
        }
      }
    }

    // ── Footer ──
    lines.push(']');

    return lines.join('\n');
  },
};

// ---------------------------------------------------------------------------
// Helper: extract custom properties from a Tiled object
// ---------------------------------------------------------------------------

/**
 * Reads custom properties from a Tiled MapObject.
 *
 * Tiled's JS API provides properties as a map-like object accessible
 * via `obj.property('key')` or a `properties()` method depending on
 * the Tiled version. This helper handles both patterns.
 *
 * @param {import('tiled').MapObject} obj - The Tiled object.
 * @returns {Record<string, string|number|boolean>} Extracted properties.
 */
const _getProperties = (obj) => {
  const props = {};

  try {
    const source =
      obj.resolvedProperties ||
      (typeof obj.properties === 'function' ? obj.properties() : obj.properties);

    if (source && typeof source === 'object') {
      for (const key of Object.keys(source)) {
        const value = source[key];
        if (value !== undefined && value !== null && value !== '') {
          props[key] = value;
        }
      }
    }
  } catch (_e) {
    // Properties API may vary between Tiled versions — silent fallback
  }

  return props;
};

// ---------------------------------------------------------------------------
// Register the format
// ---------------------------------------------------------------------------

tiled.registerMapFormat(jtonMapFormat.name, jtonMapFormat);
