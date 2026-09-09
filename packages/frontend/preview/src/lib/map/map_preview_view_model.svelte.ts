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
  buildGidFrameResolver,
  type SceneLoadResult,
  SceneUnsupportedFormatError,
  sceneFromNative,
  sceneFromTilemap,
} from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { AssetResolver } from '@aikami/types';

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
  readonly errorMessage: string | undefined;
  readonly loaded: boolean;
};

export type MapPreviewViewModelOptions = BaseViewModelOptions & {
  resolver: AssetResolver;
  mapTag: string;
  /** Canonical scene id (defaults to the map tag). */
  sceneId?: string;
  /** Installed asset-lock reference. */
  assetLock?: string;
  /** Base terrain id for terrain-channel Tiled maps. */
  baseTerrain?: string;
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

  // ── Private state ──────────────────────────────────────────────────

  private readonly _resolver: AssetResolver;
  private readonly _mapTag: string;
  private readonly _sceneId: string;
  private readonly _assetLock: string;
  private readonly _baseTerrain: string | undefined;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _showCollision: boolean;
  private readonly _zoom: number;

  constructor(options: MapPreviewViewModelOptions) {
    super(options);
    this._resolver = options.resolver;
    this._mapTag = options.mapTag;
    this._sceneId = options.sceneId ?? options.mapTag;
    this._assetLock = options.assetLock ?? 'pack:emberwatch';
    this._baseTerrain = options.baseTerrain;
    this._width = options.width ?? 640;
    this._height = options.height ?? 480;
    this._showCollision = options.showCollision ?? false;
    this._zoom = options.zoom ?? 1;
  }

  setCanvasElement(canvas: HTMLCanvasElement): void {
    this.canvasElement = canvas;
  }

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

    this.errorMessage = undefined;
    this.loaded = false;

    try {
      const url = this._resolver.resolve(this._mapTag);
      if (!url) {
        this.errorMessage = `Cannot resolve map: ${this._mapTag}`;
        return;
      }

      let text: string;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          this.errorMessage = `Failed to fetch map: ${response.status}`;
          return;
        }
        text = await response.text();
      } finally {
        this._resolver.release(url);
      }

      // Load through the unified scene loader — the same interpretation the
      // game uses (AC-5). Native scenes are parsed directly; legacy Tiled/JTON
      // are normalized through the compatibility adapter.
      let loaded: { result: SceneLoadResult; tilesets: TilemapTilesetLike[] };
      try {
        loaded = loadSceneSync(text, {
          sceneId: this._sceneId,
          assetLock: this._assetLock,
          adapter: { baseTerrain: this._baseTerrain },
        });
      } catch (err) {
        if (err instanceof SceneUnsupportedFormatError) {
          this.errorMessage = err.message;
        } else if (err instanceof Error) {
          this.errorMessage = `Scene load failed: ${err.message}`;
        } else {
          this.errorMessage = String(err);
        }
        return;
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
      ctx.clearRect(0, 0, this._width, this._height);

      // ── Real locked tile/prop images (AC-5) ───────────────────────────
      // Resolve the map's tileset spritesheet through the asset resolver and
      // draw each compiled cell's frame region from it. fillRect is used ONLY
      // as a last-resort diagnostic fallback for a frame that cannot be
      // resolved to a texture region — never the primary rendering path.
      const sheet = await _loadTilesetSheet(this._resolver, loaded.tilesets, tileSize);

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
                src.size,
                src.size,
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
      if (this._showCollision) {
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

      this.loaded = true;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }
}

/**
 * Synchronous scene load for the preview (it already has the raw text).
 * Native scenes parse/compile directly; Tiled/JTON normalize through the
 * adapter. Mirrors `loadScene` without the network fetch. Also returns the
 * raw tilesets so the preview can resolve the spritesheet for real images.
 */
const loadSceneSync = (
  text: string,
  options: {
    sceneId: string;
    assetLock: string;
    adapter: { baseTerrain?: string };
  },
): { result: SceneLoadResult; tilesets: TilemapTilesetLike[] } => {
  const trimmed = text.trimStart();
  const parsed = JSON.parse(trimmed);
  const tilesets = Array.isArray(parsed?.tilesets)
    ? (parsed.tilesets as TilemapData['tilesets'])
    : [];
  if (parsed?.kind === 'aikami.scene') {
    return {
      result: sceneFromNative(parsed, {
        sceneId: options.sceneId,
        assetLock: options.assetLock,
        adapter: options.adapter,
      }),
      tilesets,
    };
  }
  return {
    result: sceneFromTilemap(parsed as TilemapData, {
      sceneId: options.sceneId,
      assetLock: options.assetLock,
      adapter: {
        ...options.adapter,
        frameResolver: buildGidFrameResolver(tilesets),
      },
    }),
    tilesets,
  };
};

/** Minimal tileset fields the preview needs to sample a spritesheet. */
type TilemapTilesetLike = TilemapData['tilesets'][number];

/** A loaded spritesheet plus a frame → source-rect resolver. */
type TilesetSheet = {
  image: HTMLImageElement;
  columns: number;
  tileSize: number;
  /** Resolves a frame name to a square source rect, or undefined. */
  sourceRectFor: (frame: string) => { sx: number; sy: number; size: number } | undefined;
};

/**
 * Loads the map's tileset spritesheet through the asset resolver and builds
 * a frame → source-rect resolver for grid tilesets. Returns undefined when no
 * tileset image can be resolved (native scenes resolve frames via the pack
 * lock, which the preview does not hold — those fall back to diagnostics).
 */
const _loadTilesetSheet = async (
  resolver: AssetResolver,
  tilesets: TilemapTilesetLike[],
  tileSize: number,
): Promise<TilesetSheet | undefined> => {
  const tileset = tilesets.find((t) => t.image);
  const imagePath = tileset?.image;
  if (!imagePath) {
    return undefined;
  }
  const registryUrl = resolver.resolve(imagePath);
  const url = registryUrl ?? imagePath;
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load tileset image: ${imagePath}`));
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
  const size = tileset.tilewidth ?? tileSize;
  const columns = tileset.columns ?? Math.floor(img.width / size);
  return {
    image: img,
    columns,
    tileSize: size,
    sourceRectFor: (frame) => {
      const index = _frameToIndex(frame);
      if (index === undefined) {
        return undefined;
      }
      const col = index % columns;
      const row = Math.floor(index / columns);
      return { sx: col * size, sy: row * size, size };
    },
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
