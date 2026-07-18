// apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view_model.svelte.ts
//
// LPC Preview ViewModel — reusable PixiJS character preview for onboarding
// and character sheet. Renders LpcLayerRecipe[] with idle/walk animation,
// tint support, and missing-asset fallback.
// Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults

import type { LpcLayerRecipe } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { LpcAnimationState, LpcDirection } from '$lib/data/lpc_models';
import {
  Application,
  Assets,
  Container,
  Graphics,
  type PixiApplication,
  Rectangle,
  Sprite,
  Texture,
} from './lpc_preview_pixi_facade';

// ── Constants ────────────────────────────────────────────────────────────

/** Import LPC asset URLs via Vite glob */
const LPC_ASSET_URLS = import.meta.glob('/src/lib/assets/lpc/**/*.webp', {
  query: '?url',
  import: 'default',
  eager: false,
}) as Record<string, () => Promise<string>>;

/** Canonical Aikami z-order offsets for each slot. */
const SLOT_Z_ORDER: Record<string, number> = {
  body: 0,
  legs: 10,
  feet: 20,
  torso: 30,
  head: 40,
  hair: 50,
};
const DEFAULT_Z_ORDER = 100;

/** Frame dimensions for LPC spritesheet extraction. */
const FRAME_W = 64;
const FRAME_H = 64;

/** Default animation playback FPS. */
const DEFAULT_PLAYBACK_FPS = 12;

/** Default preview canvas dimensions. */
const DEFAULT_CANVAS_WIDTH = 256;
const DEFAULT_CANVAS_HEIGHT = 256;

/** Default background color (dark navy). */
const DEFAULT_BG_COLOR = 0x0d0d1a;

/** Animation state → spritesheet filename suffix. */
const STATE_SUFFIX: Record<number, string> = {
  [LpcAnimationState.Walk]: 'walk',
  [LpcAnimationState.Spellcast]: 'spellcast',
  [LpcAnimationState.Thrust]: 'thrust',
  [LpcAnimationState.Slash]: 'slash',
  [LpcAnimationState.Shoot]: 'shoot',
  [LpcAnimationState.Die]: 'hurt',
};

/** Frame counts per animation state. */
const FRAME_COUNTS: Record<number, number> = {
  [LpcAnimationState.Spellcast]: 6,
  [LpcAnimationState.Thrust]: 7,
  [LpcAnimationState.Walk]: 8,
  [LpcAnimationState.Slash]: 5,
  [LpcAnimationState.Shoot]: 12,
  [LpcAnimationState.Die]: 5,
};

// ── Interface ────────────────────────────────────────────────────────────

export type LpcPreviewViewModelInterface = BaseViewModelInterface & {
  readonly isPlaying: boolean;
  readonly animationFrame: number;
  readonly zoom: number;
  readonly compositionFailed: boolean;

  /** Canvas element reference — bind via `bind:this={viewModel.setCanvasElement}`. */
  canvasElement: HTMLCanvasElement | undefined;
  setCanvasElement(canvas: HTMLCanvasElement): void;

  /** Set the LPC layer recipes to render. Triggers a full recompose. */
  setRecipes(recipes: readonly LpcLayerRecipe[]): void;

  /** Set the animation state (idle=Walk with playback=false, walk=Walk with playback=true). */
  setAnimationState(state: LpcAnimationState): void;

  /** Toggle animation playback on/off. */
  togglePlayback(): void;

  /** Set the preview zoom level. */
  setZoom(zoom: number): void;
};

// ── Options ──────────────────────────────────────────────────────────────

export type LpcPreviewViewModelOptions = BaseViewModelOptions & {
  /** Canvas width in pixels (default 256). */
  width?: number;
  /** Canvas height in pixels (default 256). */
  height?: number;
  /** Background color as hex number (default 0x0d0d1a). */
  backgroundColor?: number;
};

// ── Implementation ───────────────────────────────────────────────────────

class LpcPreviewViewModel
  extends BaseViewModel<LpcPreviewViewModelOptions>
  implements LpcPreviewViewModelInterface
{
  // ── Public reactive state ──────────────────────────────────────────

  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  isPlaying = $state(false);
  animationFrame = $state(0);
  zoom = $state(1.0);
  compositionFailed = $state(false);

  // ── Private state ──────────────────────────────────────────────────

  private _pixiApp: PixiApplication | undefined;
  private _characterContainer: Container | undefined;
  /** All child display objects in the current composite. Includes Sprites and placeholder Containers. */
  private _currentChildren: Container[] = [];
  private _recipes: readonly LpcLayerRecipe[] = [];
  private _animationState: LpcAnimationState = LpcAnimationState.Walk;
  private _facingDirection: LpcDirection = LpcDirection.Down;
  private _playbackFps = DEFAULT_PLAYBACK_FPS;
  private _tickAccumulator = 0;
  private _maxFrame = 8;
  private _sheetCache = new Map<string, Texture>();
  private _sheetPromises = new Map<string, Promise<Texture>>();
  private _canvasWidth: number;
  private _canvasHeight: number;
  private _backgroundColor: number;
  private _isInitialized = false;
  private _renderGeneration = 0;

  constructor(options: LpcPreviewViewModelOptions) {
    super(options);
    this._canvasWidth = options.width ?? DEFAULT_CANVAS_WIDTH;
    this._canvasHeight = options.height ?? DEFAULT_CANVAS_HEIGHT;
    this._backgroundColor = options.backgroundColor ?? DEFAULT_BG_COLOR;
  }

  // ── Public API ────────────────────────────────────────────────────

  setCanvasElement(canvas: HTMLCanvasElement): void {
    this.canvasElement = canvas;
  }

  setRecipes(recipes: readonly LpcLayerRecipe[]): void {
    this._recipes = recipes;
    if (this._isInitialized) {
      this._renderCharacter();
    }
  }

  setAnimationState(state: LpcAnimationState): void {
    this._animationState = state;
    this._maxFrame = FRAME_COUNTS[state] ?? 8;
    if (this.animationFrame > this._maxFrame) {
      this.animationFrame = 0;
    }
    this._sheetCache.clear();
    this._sheetPromises.clear();
    if (this._isInitialized) {
      this._renderCharacter();
    }
  }

  togglePlayback(): void {
    this.isPlaying = !this.isPlaying;
    this._tickAccumulator = 0;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    if (this._characterContainer) {
      this._characterContainer.scale.set(zoom, zoom);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this.registerEffectRoot(() => {
      // Reactively initialize PixiJS when canvasElement becomes available
      $effect(() => {
        if (this.canvasElement && !this._pixiApp) {
          void this._initPixiApp();
        }
      });

      // Animate: drive animationFrame from the ticker, not from $effect
      // (the ticker runs inside PixiJS, mutations to animationFrame trigger re-render)
      $effect(() => {
        void this.animationFrame;
        void this.zoom;
        if (this._isInitialized) {
          this._renderCharacter();
        }
      });
    });

    return await super.initialize();
  }

  override async dispose(): Promise<void> {
    this._isInitialized = false;
    this._destroyAllChildren();
    this._sheetCache.clear();
    this._sheetPromises.clear();

    if (this._pixiApp) {
      this._pixiApp.destroy(true, { children: true });
      this._pixiApp = undefined;
    }

    return await super.dispose();
  }

  // ── Private: PixiJS init ──────────────────────────────────────────

  private async _initPixiApp(): Promise<void> {
    if (!this.canvasElement) {
      return;
    }

    try {
      this._pixiApp = new Application();

      await this._pixiApp.init({
        canvas: this.canvasElement,
        width: this._canvasWidth,
        height: this._canvasHeight,
        background: this._backgroundColor,
        antialias: false,
        resolution: 1,
        autoDensity: false,
        sharedTicker: false,
      });

      // Register playback ticker for animation frame advancement
      this._pixiApp.ticker.add(() => {
        if (this.isPlaying) {
          const delta = this._pixiApp?.ticker.deltaMS ?? 0;
          const frameInterval = 1000 / this._playbackFps;
          this._tickAccumulator += delta;

          while (this._tickAccumulator >= frameInterval) {
            this._tickAccumulator -= frameInterval;
            this.animationFrame = (this.animationFrame + 1) % (this._maxFrame + 1);
          }
        }
      });

      // Signal Playwright visual tests that PixiJS is ready
      if (typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>).__PIXI_LPC_PREVIEW_LOADED__ = true;
      }

      this._isInitialized = true;

      this.debug('lpcPreview.initialized', {
        width: this._canvasWidth,
        height: this._canvasHeight,
      });

      // Render initial frame if recipes are already set
      if (this._recipes.length > 0) {
        this._renderCharacter();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error('lpcPreview.initFailed', { error: message });
      this.compositionFailed = true;
    }
  }

  // ── Private: character rendering ──────────────────────────────────

  /**
   * Composes all layers into the PixiJS stage.
   *
   * Loads spritesheets for each recipe layer, extracts the correct animation
   * frame, applies tints, enforces z-order, and renders the composite.
   * Missing assets render as magenta placeholder rectangles.
   */
  private async _renderCharacter(): Promise<void> {
    const recipes = this._recipes;
    const currentFrame = this.animationFrame;
    const currentZoom = this.zoom;
    const currentState = this._animationState;
    const currentDirection = this._facingDirection;

    if (!this._pixiApp || !this._isInitialized) {
      return;
    }

    // Increment generation to invalidate any in-flight renders
    this._renderGeneration++;
    const thisGeneration = this._renderGeneration;
    const capturedPixiApp = this._pixiApp;

    this.compositionFailed = false;

    try {
      const newChildren: Container[] = [];

      const layerPromises = recipes.map(async (recipe, i) => {
        const slotName = recipe.slot;
        const assetId = recipe.assetId;
        const hexPalette = recipe.hexPalette;

        const stateSuffix = STATE_SUFFIX[currentState] ?? 'walk';
        const sheetKey = `${assetId}.${stateSuffix}`;
        const texture = await this._loadSheetTexture(assetId, stateSuffix);

        if (!texture || texture === Texture.EMPTY) {
          this.warn('lpcPreview.missingAsset', { slot: slotName, assetId, sheetKey });
          const placeholder = this._createPlaceholder(slotName);
          newChildren.push(placeholder);
          return;
        }

        // Extract frame from spritesheet
        const columns = Math.max(1, Math.floor(texture.width / FRAME_W));
        const stateRow = this._getStateRow(currentState, currentDirection);
        const rows = Math.max(1, Math.floor(texture.height / FRAME_H));

        const col = currentFrame % columns;
        const row = rows > 1 ? stateRow % rows : 0;
        const x = col * FRAME_W;
        const y = row * FRAME_H;

        if (x + FRAME_W > texture.width || y + FRAME_H > texture.height) {
          this.warn('lpcPreview.frameOutOfBounds', {
            slot: slotName,
            assetId,
            frame: col,
            row,
          });
          const placeholder = this._createPlaceholder(slotName);
          newChildren.push(placeholder);
          return;
        }

        const frameTexture = new Texture({
          source: texture.source,
          frame: new Rectangle(x, y, FRAME_W, FRAME_H),
        });

        const sprite = new Sprite(frameTexture);
        sprite.eventMode = 'none';
        sprite.x = -FRAME_W / 2;
        sprite.y = -FRAME_H / 2;
        sprite.alpha = 1.0;

        // Z-order: use canonical slot mapping, fall back to index-based
        const zIndex = SLOT_Z_ORDER[slotName] ?? DEFAULT_Z_ORDER + i;
        sprite.zIndex = zIndex;

        // Apply palette tint from LpcLayerRecipe.hexPalette
        const tintColor = this._extractTintFromPalette(hexPalette);
        if (tintColor !== undefined) {
          sprite.tint = tintColor;
        }

        newChildren.push(sprite);
      });

      await Promise.all(layerPromises);

      // Check if this render is stale
      if (
        thisGeneration !== this._renderGeneration ||
        this._pixiApp !== capturedPixiApp ||
        !this._isInitialized
      ) {
        // Stale render — destroy newly created children and abort
        for (const child of newChildren) {
          child.destroy({ children: true });
        }
        return;
      }

      // Sort by zIndex for correct render order
      newChildren.sort((a, b) => a.zIndex - b.zIndex);

      this._destroyAllChildren();

      const container = new Container();
      container.eventMode = 'none';
      container.sortableChildren = true;

      for (const child of newChildren) {
        container.addChild(child);
        this._currentChildren.push(child);
      }

      container.scale.set(currentZoom, currentZoom);
      container.x = this._canvasWidth / 2;
      container.y = this._canvasHeight / 2;

      this._pixiApp.stage.addChild(container);
      this._characterContainer = container;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error('lpcPreview.composeFailed', { error: message });

      // Check if still valid before fallback operations
      if (
        thisGeneration !== this._renderGeneration ||
        this._pixiApp !== capturedPixiApp ||
        !this._isInitialized
      ) {
        return;
      }

      // Global fallback: magenta rectangle covering the center
      this._destroyAllChildren();
      const fallbackContainer = this._createPlaceholder('_global');
      fallbackContainer.x = this._canvasWidth / 2;
      fallbackContainer.y = this._canvasHeight / 2;
      this._pixiApp.stage.addChild(fallbackContainer);
      this._currentChildren.push(fallbackContainer);
      this.compositionFailed = true;
    }
  }

  // ── Private: texture loading ──────────────────────────────────────

  private async _loadSheetTexture(assetId: string, stateSuffix: string): Promise<Texture> {
    const cacheKey = `__lpc_preview__${assetId}.${stateSuffix}`;

    const cached = this._sheetCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = this._sheetPromises.get(cacheKey);
    if (pending) {
      return pending;
    }

    const promise = (async () => {
      try {
        // Look up asset URL from the import.meta.glob map
        const assetPath = `/src/lib/assets/lpc/${assetId}.${stateSuffix}.webp`;
        const urlLoader = LPC_ASSET_URLS[assetPath];

        if (!urlLoader) {
          this._sheetCache.set(cacheKey, Texture.EMPTY);
          return Texture.EMPTY;
        }

        const url = await urlLoader();
        const texture = await Assets.load(url);
        texture.source.scaleMode = 'nearest';
        this._sheetCache.set(cacheKey, texture);
        return texture;
      } catch {
        this._sheetCache.set(cacheKey, Texture.EMPTY);
        return Texture.EMPTY;
      }
    })();

    this._sheetPromises.set(cacheKey, promise);
    return promise;
  }

  // ── Private: helpers ──────────────────────────────────────────────

  /**
   * Returns the absolute spritesheet row for the given state + direction.
   * Mirrors `getLpcStateRow` from the engine animation controller.
   */
  private _getStateRow(state: LpcAnimationState, direction: LpcDirection): number {
    if (state === LpcAnimationState.Die) {
      return state;
    }
    return state + direction;
  }

  /**
   * Extracts an RGB tint value (0xRRGGBB) from a palette LUT's first entry.
   * Returns undefined if the palette is all-zeros (no tint).
   */
  private _extractTintFromPalette(hexPalette: Uint8Array): number | undefined {
    if (!hexPalette || hexPalette.length < 3) {
      return undefined;
    }
    const r = hexPalette[0] ?? 0;
    const g = hexPalette[1] ?? 0;
    const b = hexPalette[2] ?? 0;
    if (r === 0 && g === 0 && b === 0) {
      return undefined;
    }
    return (r << 16) | (g << 8) | b;
  }

  /**
   * Creates a 64×64 magenta placeholder with red border for a missing layer.
   *
   * Uses a Graphics object inside a Container, centered at origin.
   */
  private _createPlaceholder(slotName: string): Container {
    const gfx = new Graphics();
    gfx.rect(0, 0, FRAME_W, FRAME_H);
    gfx.fill({ color: 0xff00ff, alpha: 0.9 });
    gfx.rect(0, 0, FRAME_W, FRAME_H);
    gfx.stroke({ color: 0xff0000, width: 2 });
    gfx.eventMode = 'none';

    const container = new Container();
    container.eventMode = 'none';
    container.x = -FRAME_W / 2;
    container.y = -FRAME_H / 2;
    container.zIndex = SLOT_Z_ORDER[slotName] ?? DEFAULT_Z_ORDER;
    container.addChild(gfx);

    this.warn('lpcPreview.placeholderRendered', { slot: slotName });
    return container;
  }

  /** Destroys all existing display children and clears the character container. */
  private _destroyAllChildren(): void {
    for (const child of this._currentChildren) {
      if (child.parent) {
        child.parent.removeChild(child);
      }
      child.destroy({ children: true });
    }
    this._currentChildren = [];

    if (this._characterContainer) {
      if (this._characterContainer.parent) {
        this._characterContainer.parent.removeChild(this._characterContainer);
      }
      this._characterContainer.destroy({ children: true });
      this._characterContainer = undefined;
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

export const getLpcPreviewViewModel = (
  options: LpcPreviewViewModelOptions,
): LpcPreviewViewModelInterface => LpcPreviewViewModel.create(options);
