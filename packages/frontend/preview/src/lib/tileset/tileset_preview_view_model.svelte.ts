// packages/frontend/preview/src/lib/tileset/tileset_preview_view_model.svelte.ts
//
// ViewModel for the tileset preview component — handles loading, asset resolution,
// Canvas rendering, reactive state, and hover coordinate calculation.
// The Svelte view becomes a pure wrapper.

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

/** Semantic grid stroke colour. */
const _gridStroke = (): string => _cssVar('--grid-stroke', 'rgba(68, 68, 255, 0.6)');

// ── Interface ──────────────────────────────────────────────────────────────

export type TilesetPreviewViewModelInterface = BaseViewModelInterface & {
  readonly canvasElement: HTMLCanvasElement | undefined;
  setCanvasElement(canvas: HTMLCanvasElement): void;
  readonly errorMessage: string | undefined;
  readonly loaded: boolean;
  readonly hoveredTileIndex: number | undefined;
  handleMouseMove(e: MouseEvent): void;
};

export type TilesetPreviewViewModelOptions = BaseViewModelOptions & {
  resolver: AssetResolver;
  tag: string;
  width?: number;
  height?: number;
  tileSize?: number;
  showGrid?: boolean;
  zoom?: number;
};

// ── Implementation ─────────────────────────────────────────────────────────

class TilesetPreviewViewModel
  extends BaseViewModel<TilesetPreviewViewModelOptions>
  implements TilesetPreviewViewModelInterface
{
  // ── Public reactive state ──────────────────────────────────────────

  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  errorMessage = $state<string | undefined>(undefined);
  loaded = $state(false);
  hoveredTileIndex = $state<number | undefined>(undefined);

  // ── Private state ──────────────────────────────────────────────────

  private readonly _resolver: AssetResolver;
  private readonly _tag: string;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _tileSize: number;
  private readonly _showGrid: boolean;

  /** Retained loaded image dimensions for hover coordinate conversion. */
  private _imgNaturalWidth = 0;
  private _imgNaturalHeight = 0;
  /** Actual column count computed from the loaded image. */
  private _actualCols = 0;
  private _actualRows = 0;

  constructor(options: TilesetPreviewViewModelOptions) {
    super(options);
    this._resolver = options.resolver;
    this._tag = options.tag;
    this._width = options.width ?? 512;
    this._height = options.height ?? 512;
    this._tileSize = options.tileSize ?? 32;
    this._showGrid = options.showGrid ?? false;
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
    this.hoveredTileIndex = undefined;
    return await super.dispose();
  }

  // ── Hover handling ────────────────────────────────────────────────

  handleMouseMove(e: MouseEvent): void {
    const canvas = this.canvasElement;
    if (!canvas || !this.loaded) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Convert from canvas display space to image (natural) space
    const scaleX = this._imgNaturalWidth / rect.width;
    const scaleY = this._imgNaturalHeight / rect.height;
    const imgX = canvasX * scaleX;
    const imgY = canvasY * scaleY;

    // Compute tile coordinates using image-space coords and actual column count
    const tileCol = Math.floor(imgX / this._tileSize);
    const tileRow = Math.floor(imgY / this._tileSize);
    this.hoveredTileIndex = tileRow * this._actualCols + tileCol;
  }

  // ── Rendering ─────────────────────────────────────────────────────

  private async _render(): Promise<void> {
    const canvas = this.canvasElement;
    if (!canvas) {
      return;
    }

    this.errorMessage = undefined;
    this.loaded = false;
    this.hoveredTileIndex = undefined;

    try {
      const url = this._resolver.resolve(this._tag);
      if (!url) {
        this.errorMessage = `Cannot resolve tileset: ${this._tag}`;
        return;
      }

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load tileset: ${this._tag}`));
        img.src = url;
      });

      if (!this.canvasElement) {
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }

      // Retain image dimensions for hover calculations
      this._imgNaturalWidth = img.width;
      this._imgNaturalHeight = img.height;
      this._actualCols = Math.floor(img.width / this._tileSize);
      this._actualRows = Math.floor(img.height / this._tileSize);

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, this._width, this._height);
      ctx.drawImage(img, 0, 0, this._width, this._height);

      if (this._showGrid) {
        const scaleX = this._width / img.width;
        const scaleY = this._height / img.height;
        const gridStroke = _gridStroke();

        ctx.strokeStyle = gridStroke;
        ctx.lineWidth = 1;

        for (let r = 0; r <= this._actualRows; r++) {
          ctx.beginPath();
          ctx.moveTo(0, r * this._tileSize * scaleY);
          ctx.lineTo(this._width, r * this._tileSize * scaleY);
          ctx.stroke();
        }
        for (let c = 0; c <= this._actualCols; c++) {
          ctx.beginPath();
          ctx.moveTo(c * this._tileSize * scaleX, 0);
          ctx.lineTo(c * this._tileSize * scaleX, this._height);
          ctx.stroke();
        }
      }

      this.loaded = true;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export const getTilesetPreviewViewModel = (
  options: TilesetPreviewViewModelOptions,
): TilesetPreviewViewModelInterface => new TilesetPreviewViewModel(options);
