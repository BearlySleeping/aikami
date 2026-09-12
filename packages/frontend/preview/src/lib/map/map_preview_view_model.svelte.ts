// packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts
//
// C-505 — Map preview ViewModel.
//
// Consumes the canonical scene data via the engine's unified loader instead
// of reading a `tiles` placeholder / assuming a collision layer position
// (AC-5). It renders the compiled ground/decor/overhead layers, the
// authoritative collision grid and placement markers from the shared scene
// pipeline — the same interpretation the game uses.

import type { TilemapData } from '@aikami/frontend/engine';
import {
  type SceneLoadResult,
  SceneUnsupportedFormatError,
  sceneFromTilemap,
} from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { ContentPackTerrain } from '@aikami/schemas';
import type { AssetResolver } from '@aikami/types';
import { frameRectFromAtlas, type MapPreviewAtlas } from './map_preview_atlas';
import { loadSceneSync, type TilemapTilesetLike } from './map_preview_scene';

export type { MapPreviewAtlas, MapPreviewAtlasFrame } from './map_preview_atlas';
export { frameRectFromAtlas } from './map_preview_atlas';

// ── Theme helpers ──────────────────────────────────────────────────────────

/** Reads a CSS custom property from the document, falling back to a default. */
const _cssVar = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') {
    return fallback;
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
};

/** Semantic ground fill colour. */
const _groundFill = (): string => _cssVar('--tile-fill', '#4a5568');
/** Semantic decal fill colour (decor above ground). */
const _decorFill = (): string => _cssVar('--decor-fill', '#7c5cff');
/** Semantic overhead fill colour. */
const _overheadFill = (): string => _cssVar('--overhead-fill', '#2bb673');
/** Semantic collision overlay colour. */
const _collisionFill = (): string => _cssVar('--collision-fill', 'rgba(255, 0, 0, 0.3)');

// ── Interface ──────────────────────────────────────────────────────────────

export type MapPreviewViewModelInterface = BaseViewModelInterface & {
  readonly canvasElement: HTMLCanvasElement | undefined;
  setCanvasElement(canvas: HTMLCanvasElement): void;
  /** Current in-memory manifest text; undefined means tag-based fetch. */
  readonly manifestText: string | undefined;
  /** Swap the manifest text and re-render; undefined restores tag mode. */
  setManifestText(text: string | undefined): void;
  /**
   * In-memory compiled-input tilemap (C-507 editor). Outranks `manifestText`
   * when set; undefined restores text/tag mode.
   */
  readonly tilemap: TilemapData | undefined;
  setTilemap(tilemap: TilemapData | undefined): void;
  /** Whether the collision overlay is drawn. */
  readonly showCollision: boolean;
  setShowCollision(show: boolean): void;
  /**
   * Explicit frame -> source-rect atlas (C-507). When set, terrain/real
   * texture frames resolve from this map instead of the grid heuristic.
   */
  readonly atlas: MapPreviewAtlas | undefined;
  setAtlas(atlas: MapPreviewAtlas | undefined): void;
  readonly errorMessage: string | undefined;
  readonly loaded: boolean;
};

export type MapPreviewViewModelOptions = BaseViewModelOptions & {
  resolver: AssetResolver;
  /** Catalog map tag — required for tag mode; unused when manifestText is set. */
  mapTag: string;
  /** Canonical scene id (defaults to the map tag). */
  sceneId?: string;
  /** Installed asset-lock reference. */
  assetLock?: string;
  /** Base terrain id for terrain-channel Tiled maps. */
  baseTerrain?: string;
  /**
   * Pack terrain definitions (C-507). Required for terrain-channel scenes —
   * without them `compileScene` rejects a terrain surface.
   */
  terrains?: readonly ContentPackTerrain[];
  /**
   * Explicit frame -> source-rect atlas (C-507). When set, frames resolve
   * from this map (packed corner16 atlases, margin/spacing) instead of the
   * trailing-number grid heuristic.
   */
  atlas?: MapPreviewAtlas;
  /**
   * In-memory map manifest text (native `aikami.scene`, Tiled JSON or JTON
   * JSON). When set, the manifest is validated and compiled directly — no
   * network fetch — through the same unified scene loader the game uses.
   * Setting it later via the interface re-renders.
   */
  manifestText?: string;
  /**
   * In-memory tilemap (frames-based) for the C-507 editor. When set, it is
   * compiled directly and outranks `manifestText`; used to reflect edits
   * while preserving the source tilesets for real texture sampling.
   */
  tilemap?: TilemapData;
  width?: number;
  height?: number;
  showCollision?: boolean;
  zoom?: number;
};

// ── Implementation ─────────────────────────────────────────────────────────

class MapPreviewViewModel
  extends BaseViewModel<MapPreviewViewModelOptions>
  implements MapPreviewViewModelInterface
{
  // ── Public reactive state ──────────────────────────────────────────

  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  errorMessage = $state<string | undefined>(undefined);
  loaded = $state(false);
  /** In-memory manifest text; undefined means fetch by tag. Tracked so the render effect re-runs on change. */
  manifestText = $state<string | undefined>(undefined);
  /** In-memory edited tilemap; outranks manifest text. Tracked for the render effect. */
  tilemap = $state<TilemapData | undefined>(undefined);
  /** Collision overlay visibility (C-507 toggles it while the tool is active). */
  showCollision = $state(false);
  /** Explicit atlas frames; tracked so the render effect re-runs on change. */
  atlas = $state<MapPreviewAtlas | undefined>(undefined);

  // ── Private state ──────────────────────────────────────────────────

  private readonly _resolver: AssetResolver;
  private readonly _mapTag: string;
  private readonly _sceneId: string;
  private readonly _assetLock: string;
  private readonly _baseTerrain: string | undefined;
  private readonly _terrains: readonly ContentPackTerrain[] | undefined;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _zoom: number;

  constructor(options: MapPreviewViewModelOptions) {
    super(options);
    this._resolver = options.resolver;
    this._mapTag = options.mapTag;
    this._sceneId = options.sceneId ?? options.mapTag;
    this._assetLock = options.assetLock ?? 'pack:emberwatch';
    this._baseTerrain = options.baseTerrain;
    this._terrains = options.terrains;
    this._width = options.width ?? 640;
    this._height = options.height ?? 480;
    this.showCollision = options.showCollision ?? false;
    this._zoom = options.zoom ?? 1;
    this.manifestText = options.manifestText;
    this.tilemap = options.tilemap;
    this.atlas = options.atlas;
  }

  setCanvasElement(canvas: HTMLCanvasElement): void {
    this.canvasElement = canvas;
  }

  setManifestText(text: string | undefined): void {
    this.manifestText = text;
  }

  /** Swaps the in-memory edited tilemap and re-renders (undefined = text/tag). */
  setTilemap(tilemap: TilemapData | undefined): void {
    this.tilemap = tilemap;
  }

  /** Shows/hides the collision overlay and re-renders. */
  setShowCollision(show: boolean): void {
    this.showCollision = show;
  }

  /** Swaps the explicit atlas frames and re-renders (undefined = grid heuristic). */
  setAtlas(atlas: MapPreviewAtlas | undefined): void {
    this.atlas = atlas;
  }

  /**
   * Monotonic token identifying the newest render pass.
   *
   * `_render` is re-entered on every manifest edit and awaits twice (the
   * manifest fetch and the tileset sheet load). Without a token a slow earlier
   * pass can finish last and paint over a newer one, or clear `loaded` /
   * `errorMessage` that the newer pass just set.
   */
  private _renderGeneration = 0;

  // ── Lifecycle ─────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this.registerEffectRoot(() => {
      $effect(() => {
        if (this.canvasElement) {
          void this._render();
        }
      });
    });
    return await super.initialize();
  }

  override async dispose(): Promise<void> {
    this.canvasElement = undefined;
    this.loaded = false;
    this.errorMessage = undefined;
    return await super.dispose();
  }

  // ── Rendering ─────────────────────────────────────────────────────

  private async _render(): Promise<void> {
    const canvas = this.canvasElement;
    if (!canvas) {
      return;
    }
    // Read reactively-tracked inputs before the first await so the effect
    // re-runs when the host editor toggles the collision overlay or swaps
    // the explicit atlas.
    const showCollision = this.showCollision;
    const atlas = this.atlas;

    const generation = ++this._renderGeneration;
    const isCurrent = (): boolean => this._renderGeneration === generation;

    this.errorMessage = undefined;
    this.loaded = false;

    try {
      // In-memory edited tilemap (C-507) outranks text/tag mode.
      let loaded: { result: SceneLoadResult; tilesets: TilemapTilesetLike[] };
      const inMemory = this.tilemap;
      if (inMemory) {
        try {
          loaded = {
            result: sceneFromTilemap(inMemory, {
              sceneId: this._sceneId,
              assetLock: this._assetLock,
              terrains: this._terrains,
              adapter: { baseTerrain: this._baseTerrain },
            }),
            tilesets: inMemory.tilesets,
          };
        } catch (err) {
          this.errorMessage = _sceneErrorMessage(err);
          return;
        }
      } else {
        let text: string;
        if (this.manifestText !== undefined) {
          // Manifest mode — validate/compile in-memory text directly. Reading
          // this.manifestText synchronously here keeps it effect-tracked.
          text = this.manifestText;
        } else {
          const url = this._resolver.resolve(this._mapTag);
          if (!url) {
            this.errorMessage = `Cannot resolve map: ${this._mapTag}`;
            return;
          }

          try {
            const response = await fetch(url);
            if (!isCurrent()) {
              return;
            }
            if (!response.ok) {
              this.errorMessage = `Failed to fetch map: ${response.status}`;
              return;
            }
            text = await response.text();
            if (!isCurrent()) {
              return;
            }
          } finally {
            this._resolver.release(url);
          }
        }

        // Load through the unified scene loader — the same interpretation the
        // game uses (AC-5). Native scenes are parsed directly; legacy Tiled/JTON
        // are normalized through the compatibility adapter.
        try {
          loaded = loadSceneSync(text, {
            sceneId: this._sceneId,
            assetLock: this._assetLock,
            adapter: { baseTerrain: this._baseTerrain },
            terrains: this._terrains,
          });
        } catch (err) {
          this.errorMessage = _sceneErrorMessage(err);
          return;
        }
      }

      const compiled = loaded.result.compiled;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }

      const zoom = this._zoom;
      const tileSize = compiled.tileSize || 32;
      const scaledTile = Math.round(tileSize * zoom);
      const mapW = compiled.width;

      ctx.imageSmoothingEnabled = false;
      // Clear the whole backing store: the canvas may have been resized by the
      // host editor (C-507) beyond the width/height captured at construction.
      ctx.clearRect(
        0,
        0,
        Math.max(this._width, canvas.width),
        Math.max(this._height, canvas.height),
      );

      // ── Real locked tile/prop images (AC-5) ───────────────────────────
      // Resolve the map's tileset spritesheet through the asset resolver and
      // draw each compiled cell's frame region from it. An explicit atlas
      // outranks the grid heuristic. fillRect is used ONLY as a last-resort
      // diagnostic fallback for a frame that cannot be resolved to a texture
      // region — never the primary rendering path.
      const sheet = await _loadTilesetSheet(this._resolver, loaded.tilesets, tileSize, atlas);
      // A newer manifest may have started rendering while the sheet loaded;
      // painting now would show the older scene.
      if (!isCurrent()) {
        return;
      }

      const decorFill = _decorFill();
      const overheadFill = _overheadFill();
      const collisionFill = _collisionFill();

      // Draw compiled layers bottom-to-top (ground → decor → overhead).
      const drawBand = (band: 'ground' | 'decor' | 'overhead') => {
        for (const layer of compiled.layers) {
          if (layer.band !== band) {
            continue;
          }
          for (let i = 0; i < layer.frames.length; i++) {
            const frame = layer.frames[i];
            if (!frame) {
              continue;
            }
            const x = (i % mapW) * scaledTile;
            const y = Math.floor(i / mapW) * scaledTile;
            const src = sheet ? sheet.sourceRectFor(frame) : undefined;
            if (sheet && src) {
              ctx.drawImage(
                sheet.image,
                src.sx,
                src.sy,
                src.sw,
                src.sh,
                x,
                y,
                scaledTile,
                scaledTile,
              );
            } else {
              // Unresolvable frame — diagnostic fallback so the map is never
              // silently blank. Ground falls back to the semantic tile fill;
              // decor/overhead to their band colours.
              let fallback = _groundFill();
              if (band === 'decor') {
                fallback = decorFill;
              } else if (band === 'overhead') {
                fallback = overheadFill;
              }
              ctx.fillStyle = fallback;
              ctx.fillRect(x, y, scaledTile, scaledTile);
            }
          }
        }
      };
      drawBand('ground');
      drawBand('decor');
      drawBand('overhead');

      // Collision overlay from the authoritative collision grid.
      if (showCollision) {
        for (let i = 0; i < compiled.collision.length; i++) {
          if (compiled.collision[i]) {
            const x = (i % mapW) * scaledTile;
            const y = Math.floor(i / mapW) * scaledTile;
            ctx.fillStyle = collisionFill;
            ctx.fillRect(x, y, scaledTile, scaledTile);
          }
        }
      }

      // Placement markers (stable ids + roles) — small, above the tiles.
      for (const placement of compiled.placements) {
        const x = Math.round(placement.x * zoom);
        const y = Math.round(placement.y * zoom);
        ctx.fillStyle = placement.solid ? '#ff0000' : '#ffd000';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!isCurrent()) {
        return;
      }
      this.loaded = true;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }
}

/**
 * Maps a scene-load failure to the honest message the preview surfaces
 * verbatim (unsupported future formats keep their own wording).
 */
const _sceneErrorMessage = (err: unknown): string => {
  if (err instanceof SceneUnsupportedFormatError) {
    return err.message;
  }
  if (err instanceof Error) {
    return `Scene load failed: ${err.message}`;
  }
  return String(err);
};

/** A source rectangle in the loaded sheet image. */
type SheetSourceRect = { sx: number; sy: number; sw: number; sh: number };

/** A loaded spritesheet plus a frame → source-rect resolver. */
type TilesetSheet = {
  image: HTMLImageElement;
  /** Resolves a frame name to a source rect, or undefined. */
  sourceRectFor: (frame: string) => SheetSourceRect | undefined;
};

/**
 * Resolves a frame against the legacy grid-tileset heuristic (numeric
 * suffix → column/row). Honours margin/spacing when the tileset declares
 * them. Returns undefined when the name carries no index.
 */
const _gridSourceRect = (
  frame: string,
  img: HTMLImageElement,
  tileset: TilemapTilesetLike | undefined,
  tileSize: number,
): SheetSourceRect | undefined => {
  const index = _frameToIndex(frame);
  if (index === undefined) {
    return undefined;
  }
  const size = tileset?.tilewidth ?? tileSize;
  const tileHeight = tileset?.tileheight ?? size;
  const margin = tileset?.margin ?? 0;
  const spacing = tileset?.spacing ?? 0;
  const declared = tileset?.columns ?? 0;
  const columns =
    declared > 0
      ? declared
      : Math.max(1, Math.floor((img.width - margin * 2 + spacing) / (size + spacing)));
  const col = index % columns;
  const row = Math.floor(index / columns);
  return {
    sx: margin + col * (size + spacing),
    sy: margin + row * (tileHeight + spacing),
    sw: size,
    sh: tileHeight,
  };
};

/** Loads an image through the asset resolver, releasing the resolved URL. */
const _loadImage = async (
  resolver: AssetResolver,
  path: string,
): Promise<HTMLImageElement | undefined> => {
  const registryUrl = resolver.resolve(path);
  const url = registryUrl ?? path;
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
      img.src = url;
    }).catch(() => undefined);
  } finally {
    if (registryUrl) {
      resolver.release(registryUrl);
    }
  }
  if (!img.width || !img.height) {
    return undefined;
  }
  return img;
};

/**
 * Loads the map's spritesheet and builds a frame → source-rect resolver.
 *
 * When `atlas` is supplied its explicit frame map is authoritative (packed
 * corner16 atlases, margin/spacing); frames absent from the map fall back to
 * the grid heuristic when a tileset carries the image metadata. Without an
 * atlas the grid heuristic is used alone. Returns undefined when no image
 * can be resolved (native scenes resolve frames via the pack lock, which the
 * preview does not hold — those fall back to diagnostics).
 */
const _loadTilesetSheet = async (
  resolver: AssetResolver,
  tilesets: TilemapTilesetLike[],
  tileSize: number,
  atlas: MapPreviewAtlas | undefined,
): Promise<TilesetSheet | undefined> => {
  const tileset = tilesets.find((t) => t.image);

  if (atlas) {
    const atlasImage = await _loadImage(resolver, atlas.imageUrl);
    if (atlasImage) {
      return {
        image: atlasImage,
        sourceRectFor: (frame) => {
          const rect = frameRectFromAtlas(atlas.frames, frame);
          if (rect) {
            return { sx: rect.x, sy: rect.y, sw: rect.width, sh: rect.height };
          }
          return tileset ? _gridSourceRect(frame, atlasImage, tileset, tileSize) : undefined;
        },
      };
    }
  }

  const imagePath = tileset?.image;
  if (!imagePath) {
    return undefined;
  }
  const img = await _loadImage(resolver, imagePath);
  if (!img) {
    return undefined;
  }
  return {
    image: img,
    sourceRectFor: (frame) => _gridSourceRect(frame, img, tileset, tileSize),
  };
};

/**
 * Maps a compiled frame name to a tile index within the spritesheet.
 * Handles the C-378 corner-16 convention (`grass_5.png` → index 5) and plain
 * numeric frames (`12.png` → 12). Returns undefined when the name carries no
 * index (falls back to a diagnostic cell, never a blank map).
 */
const _frameToIndex = (frame: string): number | undefined => {
  const stem = frame.replace(/\.[a-z0-9]+$/i, '');
  const m = /_?(\d+)$/.exec(stem);
  if (!m) {
    return undefined;
  }
  const index = Number(m[1]);
  return Number.isInteger(index) ? index : undefined;
};

// ── Factory ────────────────────────────────────────────────────────────────

export const getMapPreviewViewModel = (
  options: MapPreviewViewModelOptions,
): MapPreviewViewModelInterface => new MapPreviewViewModel(options);
