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
/** Semantic tile stroke colour. */
const _tileStroke = (): string => _cssVar('--tile-stroke', '#2d3748');
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

      const response = await fetch(url);
      if (!response.ok) {
        this.errorMessage = `Failed to fetch map: ${response.status}`;
        return;
      }
      const text = await response.text();

      // Load through the unified scene loader — the same interpretation the
      // game uses (AC-5). Native scenes are parsed directly; legacy Tiled/JTON
      // are normalized through the compatibility adapter.
      let result: SceneLoadResult;
      try {
        result = loadSceneSync(text, {
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

      const compiled = result.compiled;
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

      const groundFill = _groundFill();
      const decorFill = _decorFill();
      const overheadFill = _overheadFill();
      const tileStroke = _tileStroke();
      const collisionFill = _collisionFill();

      // Draw compiled layers bottom-to-top (ground → decor → overhead).
      const drawBand = (band: 'ground' | 'decor' | 'overhead', fill: string) => {
        for (const layer of compiled.layers) {
          if (layer.band !== band) {
            continue;
          }
          for (let i = 0; i < layer.frames.length; i++) {
            if (!layer.frames[i]) {
              continue;
            }
            const x = (i % mapW) * scaledTile;
            const y = Math.floor(i / mapW) * scaledTile;
            ctx.fillStyle = fill;
            ctx.fillRect(x, y, scaledTile, scaledTile);
            ctx.strokeStyle = tileStroke;
            ctx.strokeRect(x, y, scaledTile, scaledTile);
          }
        }
      };
      drawBand('ground', groundFill);
      drawBand('decor', decorFill);
      drawBand('overhead', overheadFill);

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

      // Placement markers (stable ids + roles).
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
 * adapter. Mirrors `loadScene` without the network fetch.
 */
const loadSceneSync = (
  text: string,
  options: {
    sceneId: string;
    assetLock: string;
    adapter: { baseTerrain?: string };
  },
): SceneLoadResult => {
  const trimmed = text.trimStart();
  const parsed = JSON.parse(trimmed);
  if (parsed?.kind === 'aikami.scene') {
    return sceneFromNative(parsed, {
      sceneId: options.sceneId,
      assetLock: options.assetLock,
      adapter: options.adapter,
    });
  }
  return sceneFromTilemap(parsed as TilemapData, {
    sceneId: options.sceneId,
    assetLock: options.assetLock,
    adapter: options.adapter,
  });
};

// ── Factory ────────────────────────────────────────────────────────────────

export const getMapPreviewViewModel = (
  options: MapPreviewViewModelOptions,
): MapPreviewViewModelInterface => new MapPreviewViewModel(options);
