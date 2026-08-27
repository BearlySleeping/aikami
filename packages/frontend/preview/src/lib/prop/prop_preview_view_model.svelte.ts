// packages/frontend/preview/src/lib/prop/prop_preview_view_model.svelte.ts
//
// ViewModel for the prop preview component — handles loading, asset resolution,
// Canvas rendering, and reactive state. The Svelte view becomes a pure wrapper.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { AssetResolver } from '@aikami/types';

// ── Interface ──────────────────────────────────────────────────────────────

export type PropPreviewViewModelInterface = BaseViewModelInterface & {
  readonly canvasElement: HTMLCanvasElement | undefined;
  setCanvasElement(canvas: HTMLCanvasElement): void;
  readonly errorMessage: string | undefined;
};

export type PropPreviewViewModelOptions = BaseViewModelOptions & {
  resolver: AssetResolver;
  tag: string;
  width?: number;
  height?: number;
  zoom?: number;
};

// ── Implementation ─────────────────────────────────────────────────────────

class PropPreviewViewModel
  extends BaseViewModel<PropPreviewViewModelOptions>
  implements PropPreviewViewModelInterface
{
  // ── Public reactive state ──────────────────────────────────────────

  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  errorMessage = $state<string | undefined>(undefined);

  // ── Private state ──────────────────────────────────────────────────

  private readonly _resolver: AssetResolver;
  private readonly _tag: string;
  private readonly _width: number;
  private readonly _height: number;
  private readonly _zoom: number;

  constructor(options: PropPreviewViewModelOptions) {
    super(options);
    this._resolver = options.resolver;
    this._tag = options.tag;
    this._width = options.width ?? 128;
    this._height = options.height ?? 128;
    this._zoom = options.zoom ?? 2;
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

    try {
      const url = this._resolver.resolve(this._tag);
      if (!url) {
        this.errorMessage = `Cannot resolve prop: ${this._tag}`;
        return;
      }

      const img = new Image();
      img.onload = () => {
        if (!this.canvasElement) {
          return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return;
        }

        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, this._width, this._height);

        // Center the sprite
        const drawW = img.width * this._zoom;
        const drawH = img.height * this._zoom;
        const dx = (this._width - drawW) / 2;
        const dy = (this._height - drawH) / 2;
        ctx.drawImage(img, dx, dy, drawW, drawH);
      };
      img.onerror = () => {
        this.errorMessage = `Failed to load prop: ${this._tag}`;
      };
      img.src = url;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export const getPropPreviewViewModel = (
  options: PropPreviewViewModelOptions,
): PropPreviewViewModelInterface => new PropPreviewViewModel(options);
