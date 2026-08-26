// apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view_model.svelte.ts
//
// LPC Preview ViewModel — reusable PixiJS character preview for onboarding
// and character sheet. Renders LpcLayerRecipe[] with idle/walk animation,
// tint support, and missing-asset fallback.
// Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults

import type { LpcLayerRecipe } from '@aikami/frontend/engine/sim';
import { resolveLayerDepth } from '@aikami/frontend/engine/content';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { LpcAnimationState, LpcDirection, lpcStateSuffix } from '@aikami/lpc';
import {
  ANIMATION_STATE_OPTIONS,
  DIRECTION_OPTIONS,
} from '$lib/data/lpc_asset_catalog';
import { createLpcRenderer, detectLpcSheetLayout, getLpcSpriteAnchor } from '$lib/data/lpc_renderer';
import type { LpcRenderer } from '$lib/data/lpc_renderer';
import {
  Application,
  Container,
  type PixiApplication,
  Rectangle,
  Sprite,
  Texture,
} from './lpc_preview_pixi_facade';

// ── Constants ────────────────────────────────────────────────────────────

/** Default animation playback FPS. */

/** Default animation playback FPS. */
const DEFAULT_PLAYBACK_FPS = 12;

/** Default preview canvas dimensions. */
const DEFAULT_CANVAS_WIDTH = 256;
const DEFAULT_CANVAS_HEIGHT = 256;

/** Default background color (dark navy). */
const DEFAULT_BG_COLOR = 0x0d0d1a;

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
  /** Last frame index for the current animation state (inclusive). */
  readonly maxFrame: number;
  readonly zoom: number;
  readonly compositionFailed: boolean;
  /** Slots whose asset could not be loaded in the last render ("slot:assetId"). */
  readonly missingAssets: string[];

  readonly animationState: LpcAnimationState;
  readonly facingDirection: LpcDirection;
  readonly playbackFps: number;
  readonly animationStateOptions: typeof ANIMATION_STATE_OPTIONS;
  readonly directionOptions: typeof DIRECTION_OPTIONS;

  /** Canvas element reference — bind via `bind:this={viewModel.setCanvasElement}`. */
  canvasElement: HTMLCanvasElement | undefined;
  setCanvasElement(canvas: HTMLCanvasElement): void;

  /** Set the LPC layer recipes to render. Triggers a full recompose. */
  setRecipes(recipes: readonly LpcLayerRecipe[]): void;

  /** Set the animation state (idle=Walk with playback=false, walk=Walk with playback=true). */
  setAnimationState(state: LpcAnimationState): void;

  /** Set the facing direction row. Triggers a recompose. */
  setFacingDirection(direction: LpcDirection): void;

  /** Toggle animation playback on/off. */
  togglePlayback(): void;

  /** Step one frame forward (no-op while playing). */
  stepNext(): void;

  /** Step one frame backward (no-op while playing). */
  stepPrev(): void;

  /** Set the animation frame directly (no-op while playing). */
  setAnimationFrame(frame: number): void;

  /** Set playback speed in FPS. */
  setPlaybackFps(fps: number): void;

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
  missingAssets = $state<string[]>([]);

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
  private _lpcRenderer: LpcRenderer | undefined;

  constructor(options: LpcPreviewViewModelOptions) {
    super(options);
    this._canvasWidth = options.width ?? DEFAULT_CANVAS_WIDTH;
    this._canvasHeight = options.height ?? DEFAULT_CANVAS_HEIGHT;
    this._backgroundColor = options.backgroundColor ?? DEFAULT_BG_COLOR;
  }

  // ── Public API ────────────────────────────────────────────────────

  readonly animationStateOptions = ANIMATION_STATE_OPTIONS;
  readonly directionOptions = DIRECTION_OPTIONS;

  get animationState(): LpcAnimationState {
    return this._animationState;
  }

  get facingDirection(): LpcDirection {
    return this._facingDirection;
  }

  get maxFrame(): number {
    return this._maxFrame;
  }

  get playbackFps(): number {
    return this._playbackFps;
  }

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

  setFacingDirection(direction: LpcDirection): void {
    this._facingDirection = direction;
    if (this._isInitialized) {
      this._renderCharacter();
    }
  }

  togglePlayback(): void {
    this.isPlaying = !this.isPlaying;
    this._tickAccumulator = 0;
  }

  stepNext(): void {
    if (this.isPlaying) {
      return;
    }
    this.animationFrame = (this.animationFrame + 1) % (this._maxFrame + 1);
  }

  stepPrev(): void {
    if (this.isPlaying) {
      return;
    }
    this.animationFrame = this.animationFrame === 0 ? this._maxFrame : this.animationFrame - 1;
  }

  setAnimationFrame(frame: number): void {
    if (!this.isPlaying) {
      this.animationFrame = frame;
    }
  }

  setPlaybackFps(fps: number): void {
    this._playbackFps = Math.max(1, fps);
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    if (this._characterContainer) {
      this._characterContainer.scale.set(zoom, zoom);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Ensure the manifest-backed LPC URL resolver is wired and the manifest
    // is loaded before any layer lookup (idempotent).
    // Create LPC renderer with the registry resolver
    const { createRegistryAssetResolver } = await import('$lib/services/assets/registry_asset_resolver');
    this._lpcRenderer = createLpcRenderer({ resolver: createRegistryAssetResolver() });

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
   * frame (auto-detecting standard 64px vs universal 128px cell layouts),
   * applies tints, enforces z-order, and renders the composite.
   * Missing assets are skipped gracefully and surfaced via `missingAssets`
   * instead of painting placeholder rectangles over the character.
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
    const missingLayers: string[] = [];

    try {
      const newChildren: Container[] = [];

      const layerPromises = recipes.map(async (recipe, i) => {
        const slotName = recipe.slot;
        const assetId = recipe.assetId;
        const hexPalette = recipe.hexPalette;

        const sheetKey = `${assetId}.${lpcStateSuffix(currentState)}`;
        const texture = await this._loadSheetTexture(assetId, currentState);

        if (!texture || texture === Texture.EMPTY) {
          this.warn('lpcPreview.missingAsset', { slot: slotName, assetId, sheetKey });
          // Graceful degradation: skip the layer instead of covering the
          // character with a placeholder square. The slot is surfaced via
          // `missingAssets` so UI can show a subtle diagnostic.
          missingLayers.push(`${slotName}:${assetId}`);
          return;
        }

        // Extract frame from spritesheet (handles both 64px standard and
        // 128px universal cell layouts — e.g. bow walk sheets).
        const layout = detectLpcSheetLayout(texture);
        const stateRow = this._getStateRow(currentState, currentDirection);

        const col = currentFrame % layout.columns;
        const row = layout.rows > 1 ? stateRow % layout.rows : 0;
        const x = col * layout.pitch;
        const y = row * layout.pitch;

        if (x + layout.pitch > texture.width || y + layout.pitch > texture.height) {
          this.warn('lpcPreview.frameOutOfBounds', {
            slot: slotName,
            assetId,
            frame: col,
            row,
          });
          missingLayers.push(`${slotName}:${assetId}`);
          return;
        }

        const frameTexture = new Texture({
          source: texture.source,
          frame: new Rectangle(x, y, layout.pitch, layout.pitch),
        });

        const anchor = getLpcSpriteAnchor(layout);
        const sprite = new Sprite(frameTexture);
        sprite.eventMode = 'none';
        // Anchor at the 64px logical frame origin. Universal 128px cells are
        // scaled down but keep the same anchor — the drawing is centered in
        // the padded cell, so scaling + standard anchoring aligns it with the
        // character's hands.
        sprite.x = anchor.x;
        sprite.y = anchor.y;
        sprite.scale.set(layout.scale, layout.scale);
        sprite.alpha = 1.0;

        // Z-order: use the canonical LPC_LAYER_ORDER table (C-430).
        // This replaces the local SLOT_Z_ORDER definition.
        const zIndex = resolveLayerDepth({
          slot: slotName,
          layerRole: recipe.layerRole ?? 'front',
          direction: 2, // default facing (down)
        });
        sprite.zIndex = zIndex;
        // Store original index for stable sorting
        (sprite as unknown as Record<string, unknown>)._originalIndex = i;

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
        // Stale render — destroy newly created children and abort without
        // publishing diagnostics that could race a newer render.
        for (const child of newChildren) {
          child.destroy({ children: true });
        }
        return;
      }

      // Only publish diagnostics once the render is confirmed current
      this.missingAssets = missingLayers;

      // Sort by zIndex for correct render order, using original index as tie-breaker
      newChildren.sort((a, b) => {
        if (a.zIndex !== b.zIndex) {
          return a.zIndex - b.zIndex;
        }
        // Equal depth: preserve original recipe order
        const aIdx = (a as unknown as Record<string, unknown>)._originalIndex as number;
        const bIdx = (b as unknown as Record<string, unknown>)._originalIndex as number;
        return aIdx - bIdx;
      });

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

      // Graceful degradation: clear the stage and leave the canvas empty.
      // The compositionFailed flag + view notice surface the failure without
      // painting a loud placeholder over the character.
      this._destroyAllChildren();
      this.missingAssets = missingLayers;
      this.compositionFailed = true;
    }
  }

  // ── Private: texture loading ──────────────────────────────────────

  private async _loadSheetTexture(assetId: string, state: LpcAnimationState): Promise<Texture> {
    const stateSuffix = lpcStateSuffix(state);
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
      const texture = await this._lpcRenderer.loadSheet(assetId, state);
      // Only cache successful textures — transient EMPTY must be retried on a
      // later call (the renderer only permanently caches genuinely unmapped
      // assets once the manifest is loaded).
      if (texture !== Texture.EMPTY) {
        this._sheetCache.set(cacheKey, texture);
      }
      return texture;
    })();

    this._sheetPromises.set(cacheKey, promise);
    void promise.finally(() => {
      // Release the in-flight entry once settled so EMPTY results can retry.
      this._sheetPromises.delete(cacheKey);
    });
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
