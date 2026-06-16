// packages/frontend/engine/src/systems/tilemap_render_system.ts

import {
  Assets,
  Container,
  Rectangle,
  type Renderer,
  RenderTexture,
  Sprite,
  Texture,
} from 'pixi.js';
import type { TilemapData, TilemapTileset } from '../assets/map_loader.ts';

// ---------------------------------------------------------------------------
// Tilemap Rendering System — renders static tilemap layers in PixiJS v8
//
// Contract C-135: Iterates through parsed map layers bottom-to-top,
// renders each visible layer into a cached RenderTexture for optimal
// performance, and returns a Container with the background at the
// correct z-index (behind all entity sprites).
//
// Performance strategy: Instead of creating one Sprite per tile (which
// produces thousands of draw calls), each layer is rendered into a
// single RenderTexture. The resulting Container holds one Sprite per
// layer — typically 2-4 draw calls total.
// ---------------------------------------------------------------------------

/**
 * Options for rendering a tilemap into a PixiJS scene.
 */
export type TilemapRenderOptions = {
  /** The parsed tilemap data from {@link loadTilemap}. */
  tilemap: TilemapData;
  /**
   * Optional layer name filter. When provided, only layers whose
   * name matches are rendered. Layers with the name "collision"
   * are always skipped.
   *
   * When omitted, all visible non-collision layers are rendered.
   */
  layerFilter?: (layerName: string) => boolean;
  /**
   * Optional renderer instance. When provided, `RenderTexture.create()`
   * uses this renderer for the cached texture. In headless/test
   * environments, set `skipRenderTexture` to `true` instead.
   */
  renderer?: Renderer;
  /**
   * Skip the RenderTexture optimization and return a Container with
   * individual tile Sprites. Useful in test environments where no
   * WebGL context exists.
   */
  skipRenderTexture?: boolean;
};

/**
 * Result of rendering a tilemap into the scene.
 */
export type TilemapRenderResult = {
  /** The Container holding all rendered layers. Add to the world container. */
  container: Container;
  /** The number of layers rendered. */
  layerCount: number;
};

/**
 * Tileset lookup helper — finds the tileset that owns a given GID.
 */
type TilesetEntry = TilemapTileset & {
  /** Source rectangle in the tileset image for the tile's local ID. */
  getFrame: (localId: number) => Rectangle;
};

/**
 * Renders a parsed tilemap into a PixiJS Container.
 *
 * Each visible, non-collision layer is rendered as a single Sprite
 * backed by a RenderTexture for optimal draw-call count. Layers are
 * added bottom-to-top (matching the Tiled editor's draw order).
 *
 * The returned Container should be added to the world container
 * at z-index 0 (behind all entity sprites).
 *
 * @param options - Tilemap data and texture resolution.
 * @returns A container with all rendered layers.
 */
export const renderTilemap = async (
  options: TilemapRenderOptions,
): Promise<TilemapRenderResult> => {
  const { tilemap, layerFilter, skipRenderTexture } = options;

  const container = new Container();
  container.label = 'tilemap-background';

  // Pre-compute tileset frame lookups
  const tilesetEntries = _buildTilesetLookup(tilemap.tilesets);

  // Pre-load all tileset textures before rendering
  const textureLoadPromises = tilesetEntries.map((entry) => Assets.load(entry.image));
  await Promise.all(textureLoadPromises);

  let layerCount = 0;

  // Render layers bottom-to-top (preserve Tiled draw order)
  for (const layer of tilemap.layers) {
    if (!layer.visible) {
      continue;
    }

    if (layer.name === 'collision') {
      continue;
    }

    if (layerFilter && !layerFilter(layer.name)) {
      continue;
    }

    const layerContainer = skipRenderTexture
      ? _renderLayerDirect(layer, tilemap, tilesetEntries)
      : _renderLayerToTexture(layer, tilemap, tilesetEntries, options);

    if (layerContainer) {
      container.addChild(layerContainer);
      layerCount += 1;
    }
  }

  return { container, layerCount };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a GID → (tileset, frame rectangle) lookup from the tileset array.
 */
const _buildTilesetLookup = (tilesets: readonly TilemapTileset[]): TilesetEntry[] => {
  return tilesets.map((ts) => {
    const { tilewidth, tileheight, columns, spacing = 0, margin = 0 } = ts;

    const getFrame = (localId: number): Rectangle => {
      const col = localId % columns;
      const row = Math.floor(localId / columns);
      return new Rectangle(
        margin + col * (tilewidth + spacing),
        margin + row * (tileheight + spacing),
        tilewidth,
        tileheight,
      );
    };

    return { ...ts, getFrame };
  });
};

/**
 * Finds the tileset and local tile ID for a given global tile ID (GID).
 *
 * @returns The matching entry and the local ID within that tileset,
 *   or `undefined` if the GID is 0 (empty) or no tileset matches.
 */
const _resolveTile = (
  gid: number,
  entries: readonly TilesetEntry[],
): { entry: TilesetEntry; localId: number } | undefined => {
  if (gid === 0) {
    return undefined;
  }

  // Tilesets are ordered by ascending firstgid
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (gid >= entry.firstgid) {
      const localId = gid - entry.firstgid;
      if (localId < entry.tilecount) {
        return { entry, localId };
      }
      break;
    }
  }

  return undefined;
};

/**
 * Renders a single layer into a cached RenderTexture-backed Sprite.
 *
 * This is the production path: all tiles in a layer are composited
 * into one GPU texture, reducing draw calls from N to 1 per layer.
 */
const _renderLayerToTexture = (
  layer: { width: number; height: number; data: readonly number[]; name: string },
  tilemap: TilemapData,
  entries: readonly TilesetEntry[],
  options: TilemapRenderOptions,
): Container | undefined => {
  // Create a temporary container with all tile sprites
  const tempContainer = new Container();
  tempContainer.label = `layer-${layer.name}-tmp`;

  let hasTiles = false;

  for (let row = 0; row < layer.height; row++) {
    for (let col = 0; col < layer.width; col++) {
      const index = row * layer.width + col;
      const gid = layer.data[index];
      if (gid === 0) {
        continue;
      }

      const resolved = _resolveTile(gid, entries);
      if (!resolved) {
        continue;
      }

      const { entry, localId } = resolved;
      const texture = Texture.from(entry.image);
      const frame = entry.getFrame(localId);

      const sprite = new Sprite({
        texture,
        x: col * tilemap.tilewidth,
        y: row * tilemap.tileheight,
        width: tilemap.tilewidth,
        height: tilemap.tileheight,
      });

      // Set the source frame for correct UV mapping
      sprite.texture = new Texture({
        source: texture.source,
        frame,
      });

      tempContainer.addChild(sprite);
      hasTiles = true;
    }
  }

  if (!hasTiles) {
    return undefined;
  }

  // Bake the temporary container into a RenderTexture
  const layerWidth = layer.width * tilemap.tilewidth;
  const layerHeight = layer.height * tilemap.tileheight;

  // Try RenderTexture approach; fall back to direct if no renderer available
  if (options.skipRenderTexture || !options.renderer) {
    return tempContainer;
  }

  try {
    const renderTexture = RenderTexture.create({
      width: layerWidth,
      height: layerHeight,
    });

    options.renderer.render({
      container: tempContainer,
      target: renderTexture,
    });

    const bakedSprite = new Sprite(renderTexture);
    bakedSprite.label = `layer-${layer.name}`;

    return new Container({ children: [bakedSprite] });
  } catch {
    // RenderTexture requires a live WebGL context — fall back to direct
    // rendering which still works but produces more draw calls.
    return tempContainer;
  }
};

/**
 * Renders a layer directly as individual tile Sprites.
 *
 * Used in test/headless environments where RenderTexture is unavailable.
 */
const _renderLayerDirect = (
  layer: { width: number; height: number; data: readonly number[]; name: string },
  tilemap: TilemapData,
  entries: readonly TilesetEntry[],
): Container | undefined => {
  const container = new Container();
  container.label = `layer-${layer.name}`;

  let hasTiles = false;

  for (let row = 0; row < layer.height; row++) {
    for (let col = 0; col < layer.width; col++) {
      const index = row * layer.width + col;
      const gid = layer.data[index];
      if (gid === 0) {
        continue;
      }

      const resolved = _resolveTile(gid, entries);
      if (!resolved) {
        continue;
      }

      const { entry, localId } = resolved;
      const texture = Texture.from(entry.image);
      const frame = entry.getFrame(localId);

      const sprite = new Sprite({
        texture: new Texture({ source: texture.source, frame }),
        x: col * tilemap.tilewidth,
        y: row * tilemap.tileheight,
        width: tilemap.tilewidth,
        height: tilemap.tileheight,
      });

      container.addChild(sprite);
      hasTiles = true;
    }
  }

  return hasTiles ? container : undefined;
};
