// packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts
//
// ViewModel for the map preview component — handles loading, asset resolution,
// Canvas rendering, and reactive state. The Svelte view becomes a pure wrapper.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { AssetResolver } from '@aikami/types';

// ── Theme helpers ──────────────────────────────────────────────────────────

/** Reads a CSS custom property from the document, falling back to a default. */
const _cssVar = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
};

/** Semantic tile fill colour (slate-600 equivalent). */
const _tileFill = (): string => _cssVar('--tile-fill', '#4a5568');
/** Semantic tile stroke colour (slate-700 equivalent). */
const _tileStroke = (): string => _cssVar('--tile-stroke', '#2d3748');
/** Semantic collision overlay colour. */
const _collisionFill = (): string => _cssVar('--collision-fill', 'rgba(255, 0, 0, 0.3)');
/** Semantic Z-band colours (cycling). */
const _zBandColors = (): string[] => {
  const raw = _cssVar('--zband-colors', '#ff0000,#00ff00,#0000ff,#ffff00,#ff00ff');
  return raw.split(',').map((c) => c.trim());
};

// ── Interface ──────────────────────────────────────────────────────────────

export type MapPreviewViewModelInterface = BaseViewModelInterface & {
  readonly canvasElement: HTMLCanvasElement | undefined;
  setCanvasElement(canvas: HTMLCanvasElement): void;
  readonly error: string | undefined;
  readonly loaded: boolean;
};

export type MapPreviewViewModelOptions = BaseViewModelOptions & {
  resolver: AssetResolver;
  mapTag: string;
  width?: number;
  height?: number;
  showCollision?: boolean;
  showZBands?: boolean;
  zoom?: number;
};

// ── Implementation ─────────────────────────────────────────────────────────

class MapPreviewViewModel
  extends BaseViewModel<MapPreviewViewModelOptions>
  implements MapPreviewViewModelInterface
{
  // ── Public reactive state ──────────────────────────────────────────

  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  error = $state<string | undefined>(undefined);
  loaded = $state(false);

  // ── Private state ──────────────────────────────────────────────────

  private readonly _resolver: AssetResolver;
  private readonly _mapTag: string;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _showCollision: boolean;
  private readonly _showZBands: boolean;
  private readonly _zoom: number;

  constructor(options: MapPreviewViewModelOptions) {
    super(options);
    this._resolver = options.resolver;
    this._mapTag = options.mapTag;
    this._width = options.width ?? 640;
    this._height = options.height ?? 480;
    this._showCollision = options.showCollision ?? false;
    this._showZBands = options.showZBands ?? false;
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
    this.error = undefined;
    return await super.dispose();
  }

  // ── Rendering ─────────────────────────────────────────────────────

  private async _render(): Promise<void> {
    const canvas = this.canvasElement;
    if (!canvas) return;

    this.error = undefined;
    this.loaded = false;

    try {
      const url = this._resolver.resolve(this._mapTag);
      if (!url) {
        this.error = `Cannot resolve map: ${this._mapTag}`;
        return;
      }

      const response = await fetch(url);
      if (!response.ok) {
        this.error = `Failed to fetch map: ${response.status}`;
        return;
      }

      const mapData = await response.json();
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const zoom = this._zoom;
      const tileSize = 32;
      const scaledTile = Math.round(tileSize * zoom);
      const tiles = mapData.tiles ?? mapData.layers?.[0]?.tiles ?? [];
      const mapW = mapData.width ?? Math.floor(this._width / scaledTile);
      const mapH = mapData.height ?? Math.floor(this._height / scaledTile);

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, this._width, this._height);

      const tileFill = _tileFill();
      const tileStroke = _tileStroke();

      // Draw placeholder tiles
      for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
          const tileIdx = y * mapW + x;
          const tile = tiles[tileIdx];
          if (tile && tile !== 0) {
            ctx.fillStyle = tileFill;
            ctx.fillRect(x * scaledTile, y * scaledTile, scaledTile, scaledTile);
            ctx.strokeStyle = tileStroke;
            ctx.strokeRect(x * scaledTile, y * scaledTile, scaledTile, scaledTile);
          }
        }
      }

      // Collision overlay
      if (this._showCollision) {
        const collision = mapData.collision ?? mapData.layers?.[1]?.tiles ?? [];
        const collisionFill = _collisionFill();
        for (let y = 0; y < mapH; y++) {
          for (let x = 0; x < mapW; x++) {
            const idx = y * mapW + x;
            if (collision[idx]) {
              ctx.fillStyle = collisionFill;
              ctx.fillRect(x * scaledTile, y * scaledTile, scaledTile, scaledTile);
            }
          }
        }
      }

      // Z-band overlay
      if (this._showZBands) {
        const entities = mapData.entities ?? [];
        const zColors = _zBandColors();
        for (const entity of entities) {
          const ex = (entity.x ?? 0) * scaledTile;
          const ey = (entity.y ?? 0) * scaledTile;
          const band = entity.zBand ?? 0;
          ctx.fillStyle = zColors[band % zColors.length] + '60';
          ctx.fillRect(ex, ey, scaledTile, scaledTile);
        }
      }

      this.loaded = true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export const getMapPreviewViewModel = (
  options: MapPreviewViewModelOptions,
): MapPreviewViewModelInterface => MapPreviewViewModel.create(options);
