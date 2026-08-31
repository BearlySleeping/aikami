// packages/frontend/preview/src/lib/lpc/lpc_preview_view_model.svelte.ts
//
// ViewModel for the LPC preview component — host-agnostic, no SvelteKit deps.
// Manages layer selection, animation state, palette overrides, and PixiJS rendering.

import type { LpcLayerRecipe } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { LpcAnimationState, LpcDirection, lpcStateSuffix } from '@aikami/lpc';
import {
  LPC_DEFAULT_BODY_ASSET_ID,
  LPC_DEFAULT_HEAD_ASSET_ID,
  REQUIRED_LPC_SLOTS,
} from '@aikami/schemas';
import type { AssetResolver } from '@aikami/types';
import { type Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { createPixiApp, LpcBatchManager, resolveLayerDepth } from '../../../../engine/src/index.ts';
import type { LpcRenderer } from './lpc_renderer';
import { createLpcRenderer, detectLpcSheetLayout, getLpcSpriteAnchor } from './lpc_renderer';
import { encodeLpcPreviewState, type LpcPreviewState } from './preview_url_state';

// ── Constants ────────────────────────────────────────────────────────────

const MaxLayers = 8;
const CanvasWidth = 960;
const CanvasHeight = 540;
const EntityX = CanvasWidth / 2;
const EntityY = CanvasHeight / 2 - 32;

// ── Template constants exposed via the interface ──────────────────────────

// LpcAnimationState/LpcDirection are plain `as const` objects (no reverse
// string mapping like a real TS enum), so Object.values already yields only
// their numeric literal values — no filter needed.
export const ANIMATION_STATE_OPTIONS = Object.values(LpcAnimationState);
export const DIRECTION_OPTIONS = Object.values(LpcDirection);

// ── Types ─────────────────────────────────────────────────────────────────

export type ActiveLayerConfig = {
  slotDefIndex: number;
  variantIndex: number;
};

export type LpcPreviewViewModelInterface = BaseViewModelInterface & {
  readonly canvasElement: HTMLCanvasElement | undefined;
  setCanvasElement(canvas: HTMLCanvasElement): void;

  readonly animationState: LpcAnimationState;
  readonly facingDirection: LpcDirection;
  readonly animationFrame: number;
  readonly maxFrame: number;
  readonly isPlaying: boolean;
  readonly playbackFps: number;
  readonly showGridOverlay: boolean;
  readonly isolateLayerIndex: number;

  readonly activeLayers: ActiveLayerConfig[];
  readonly recipes: readonly LpcLayerRecipe[];
  readonly paletteColors: Record<number, string>;
  setLayerColor(layerIndex: number, hexColor: string): void;
  readonly globalTint: string;
  setGlobalTint(hexColor: string): void;
  readonly layerOverrides: Record<number, boolean>;
  toggleLayerOverride(layerIndex: number): void;

  readonly fps: number;
  readonly frameDurationMs: number;
  readonly compositionFailed: boolean;
  readonly zoom: number;

  readonly maxLayers: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly entityX: number;
  readonly entityY: number;
  readonly allSlots: LpcSlotDef[];
  readonly statusBanner: { message: string; level: 'info' | 'warn' | 'error' } | undefined;

  // Template logic exposed for the view
  readonly animationStateOptions: readonly number[];
  readonly directionOptions: readonly number[];

  togglePlayback(): void;
  stepNext(): void;
  stepPrev(): void;
  clearStatus(): void;
  addLayer(): void;
  removeLayer(index: number): void;
  setSlotDef(layerIndex: number, slotDefIndex: number): void;
  setVariant(layerIndex: number, variantIndex: number): void;
  setAnimationState(state: LpcAnimationState): void;
  setFacingDirection(direction: LpcDirection): void;
  setAnimationFrame(frame: number): void;
  setPlaybackFps(fps: number): void;
  setShowGridOverlay(show: boolean): void;
  setIsolateLayerIndex(index: number): void;
  setZoom(zoom: number): void;

  /** Serialises current state to URLSearchParams. */
  getStateParams(): URLSearchParams;
};

export type LpcSlotDef = {
  slot: string;
  label: string;
  variants: Array<{ label: string; assetId: string }>;
};

export type LpcPreviewViewModelOptions = BaseViewModelOptions & {
  resolver: AssetResolver;
  allSlots: LpcSlotDef[];
  initialState?: LpcPreviewState;
  onStateChange?: (state: LpcPreviewState) => void;
  zoom?: number;
};

class LpcPreviewViewModel
  extends BaseViewModel<LpcPreviewViewModelOptions>
  implements LpcPreviewViewModelInterface
{
  // ── Private internals (before public for convention) ─────────────────

  private readonly _resolver: AssetResolver;
  private readonly _onStateChange?: (state: LpcPreviewState) => void;
  private _sheetTextureCache = new Map<string, Texture>();
  private _sheetTexturePromises = new Map<string, Promise<Texture>>();
  private _characterContainer: Container | undefined;
  private _layerSprites: Sprite[] = [];
  private _gridGraphics: Container | undefined;
  private _tickAccumulator = 0;
  private _lpcRenderer: LpcRenderer | undefined;
  /** Generation counter to serialise async _renderCharacter updates. */
  private _renderGeneration = 0;

  // ── Public reactive state ──────────────────────────────────────────

  readonly maxLayers = MaxLayers;
  readonly canvasWidth = CanvasWidth;
  readonly canvasHeight = CanvasHeight;
  readonly entityX = EntityX;
  readonly entityY = EntityY;

  readonly animationStateOptions = ANIMATION_STATE_OPTIONS;
  readonly directionOptions = DIRECTION_OPTIONS;

  allSlots = $state<LpcSlotDef[]>([]);

  // ── PixiJS infrastructure ────────────────────────────────────────────

  readonly batchManager = new LpcBatchManager({ maxInstances: 8 });
  readonly stageContainer: Container;
  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  pixiApp = $state<Application | undefined>(undefined);

  // ── Status ───────────────────────────────────────────────────────────

  statusBanner = $state<{ message: string; level: 'info' | 'warn' | 'error' } | undefined>(
    undefined,
  );

  // ── Animation ────────────────────────────────────────────────────────

  animationState = $state<LpcAnimationState>(LpcAnimationState.Walk);
  facingDirection = $state<LpcDirection>(LpcDirection.Down);
  animationFrame = $state(0);
  maxFrame = $state(8);
  isPlaying = $state(false);
  playbackFps = $state(12);

  // ── Diagnostics ─────────────────────────────────────────────────────

  showGridOverlay = $state(false);
  isolateLayerIndex = $state(-1);

  // ── Layers ──────────────────────────────────────────────────────────

  activeLayers = $state<ActiveLayerConfig[]>([]);

  // ── Palette colors ─────────────────────────────────────────────────

  globalTint = $state('');
  paletteColors = $state<Record<number, string>>({});
  layerOverrides = $state<Record<number, boolean>>({});

  // ── Telemetry ───────────────────────────────────────────────────────

  fps = $state(0);
  frameDurationMs = $state(0);
  compositionFailed = $state(false);
  zoom = $state(1);

  constructor(options: LpcPreviewViewModelOptions) {
    super(options);
    this._resolver = options.resolver;
    this._onStateChange = options.onStateChange;
    this.allSlots = options.allSlots;
    this.zoom = options.zoom ?? 1;
    this.stageContainer = new Container();
    this.stageContainer.label = 'lpc-preview-stage';

    const hadInitialState = !!options.initialState;
    if (options.initialState) {
      this._applyPreviewState(options.initialState);
    }

    // Auto-add default required slots only when no initialState was supplied,
    // so the preview renders a character immediately on first visit.
    // Preserves an explicit initialState containing layers: [] without replacing.
    // Uses REQUIRED_LPC_SLOTS (head, body, torso) to match the set that
    // triggers error banners in the recipes getter.
    if (!hadInitialState && this.activeLayers.length === 0 && this.allSlots.length > 0) {
      const defaults = REQUIRED_LPC_SLOTS.map((slot) =>
        this.allSlots.findIndex((s) => s.slot === slot),
      )
        .filter((slotDefIndex) => slotDefIndex >= 0)
        .map((slotDefIndex) => ({ slotDefIndex, variantIndex: 0 }));
      if (defaults.length > 0) {
        this.activeLayers = defaults;
      }
    }
  }

  // ── Canvas setter ───────────────────────────────────────────────────

  setCanvasElement(canvas: HTMLCanvasElement): void {
    this.canvasElement = canvas;
  }

  // ── Playback ────────────────────────────────────────────────────────

  togglePlayback(): void {
    this.isPlaying = !this.isPlaying;
    this._tickAccumulator = 0;
  }

  stepNext(): void {
    if (this.isPlaying) {
      return;
    }
    this.animationFrame = (this.animationFrame + 1) % (this.maxFrame + 1);
  }

  stepPrev(): void {
    if (this.isPlaying) {
      return;
    }
    this.animationFrame = this.animationFrame === 0 ? this.maxFrame : this.animationFrame - 1;
  }

  // ── Status ──────────────────────────────────────────────────────────

  clearStatus(): void {
    this.statusBanner = undefined;
  }

  private _setStatus(message: string, level: 'info' | 'warn' | 'error'): void {
    this.statusBanner = { message, level };
    if (level === 'info') {
      setTimeout(() => {
        if (this.statusBanner?.message === message) {
          this.statusBanner = undefined;
        }
      }, 3000);
    }
  }

  // ── Layer management ────────────────────────────────────────────────

  addLayer(): void {
    if (this.activeLayers.length >= MaxLayers) {
      this._setStatus(`Maximum ${MaxLayers} layers reached.`, 'warn');
      return;
    }

    const usedSlotKeys = new Set(
      this.activeLayers.map((l) => {
        const def = this.allSlots[l.slotDefIndex];
        return def?.slot;
      }),
    );

    const unusedIndex = this.allSlots.findIndex((s) => !usedSlotKeys.has(s.slot));
    const slotDefIndex =
      unusedIndex >= 0 ? unusedIndex : this.activeLayers.length % this.allSlots.length;

    this.activeLayers = [...this.activeLayers, { slotDefIndex, variantIndex: 0 }];
  }

  removeLayer(index: number): void {
    this.activeLayers = this.activeLayers.filter((_, i) => i !== index);
    if (this.isolateLayerIndex === index) {
      this.isolateLayerIndex = -1;
    }
  }

  // ── Slot / variant ──────────────────────────────────────────────────

  setSlotDef(layerIndex: number, slotDefIndex: number): void {
    this.activeLayers = this.activeLayers.map((layer, i) => {
      if (i !== layerIndex) {
        return layer;
      }
      return { ...layer, slotDefIndex, variantIndex: 0 };
    });
  }

  setVariant(layerIndex: number, variantIndex: number): void {
    this.activeLayers = this.activeLayers.map((layer, i) => {
      if (i !== layerIndex) {
        return layer;
      }
      return { ...layer, variantIndex };
    });
  }

  setLayerColor(layerIndex: number, hexColor: string): void {
    this.paletteColors = { ...this.paletteColors, [layerIndex]: hexColor };
  }

  setGlobalTint(hexColor: string): void {
    this.globalTint = hexColor;
  }

  toggleLayerOverride(layerIndex: number): void {
    const current = this.layerOverrides[layerIndex] ?? false;
    this.layerOverrides = { ...this.layerOverrides, [layerIndex]: !current };
  }

  // ── Recipes (derived) ───────────────────────────────────────────────

  get recipes(): readonly LpcLayerRecipe[] {
    const result: LpcLayerRecipe[] = [];

    for (let i = 0; i < this.activeLayers.length; i++) {
      const layer = this.activeLayers[i];
      if (!layer) {
        continue;
      }

      if (this.isolateLayerIndex >= 0 && i !== this.isolateLayerIndex) {
        continue;
      }

      const slotDef = this.allSlots[layer.slotDefIndex];
      if (!slotDef) {
        continue;
      }
      const variant = slotDef.variants[layer.variantIndex];
      if (!variant) {
        continue;
      }

      const palette = new Uint8Array(1024);
      const hexColor =
        this.layerOverrides[i] && this.paletteColors[i] ? this.paletteColors[i] : this.globalTint;
      if (hexColor) {
        const r = Number.parseInt(hexColor.slice(1, 3), 16);
        const g = Number.parseInt(hexColor.slice(3, 5), 16);
        const b = Number.parseInt(hexColor.slice(5, 7), 16);
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
          for (let entry = 0; entry < 256; entry++) {
            const offset = entry * 4;
            palette[offset] = r;
            palette[offset + 1] = g;
            palette[offset + 2] = b;
            palette[offset + 3] = 255;
          }
        }
      }

      result.push({
        slot: slotDef.slot,
        assetId: variant.assetId,
        hexPalette: palette,
      });
    }

    // Body layer fallback
    const hasBody = result.some((r) => r.slot === 'body');
    if (!hasBody && result.length > 0) {
      result.unshift({
        slot: 'body',
        assetId: LPC_DEFAULT_BODY_ASSET_ID,
        hexPalette: new Uint8Array(1024),
      });
    }

    // Required slot validation
    if (result.length > 0) {
      const presentSlots = new Set(result.map((r) => r.slot));
      for (const required of REQUIRED_LPC_SLOTS) {
        if (!presentSlots.has(required)) {
          if (required === 'head') {
            this.warn('lpc.recipeValidation.headMissing', {
              message: 'Head slot not configured — will fallback to default head spritesheet.',
            });
          } else {
            this.error('lpc.recipeValidation.missingRequiredSlot', {
              slot: required,
              message: `Missing required LPC spritesheet: "${required}". Character render will be incomplete.`,
            });
            this._setStatus(
              `Missing required spritesheet: "${required}". Add a ${required} layer to render correctly.`,
              'error',
            );
          }
        }
      }
    }

    return result;
  }

  // ── Animation setters ───────────────────────────────────────────────

  setAnimationState(state: LpcAnimationState): void {
    this.animationState = state;
    this._updateMaxFrame(state);
  }

  setFacingDirection(direction: LpcDirection): void {
    this.facingDirection = direction;
  }

  setAnimationFrame(frame: number): void {
    if (!this.isPlaying) {
      this.animationFrame = frame;
    }
  }

  setPlaybackFps(fps: number): void {
    this.playbackFps = Math.max(1, fps);
  }

  setShowGridOverlay(show: boolean): void {
    this.showGridOverlay = show;
  }

  setIsolateLayerIndex(index: number): void {
    this.isolateLayerIndex = index;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
  }

  private _updateMaxFrame(state: LpcAnimationState): void {
    const frameCounts: Record<number, number> = {
      [LpcAnimationState.Spellcast]: 6,
      [LpcAnimationState.Thrust]: 7,
      [LpcAnimationState.Walk]: 8,
      [LpcAnimationState.Slash]: 5,
      [LpcAnimationState.Shoot]: 12,
      [LpcAnimationState.Die]: 5,
    };
    this.maxFrame = frameCounts[state] ?? 8;

    if (this.animationFrame > this.maxFrame) {
      this.animationFrame = 0;
    }
  }

  // ── Texture / sheet helpers ─────────────────────────────────────────

  private async _loadSheetTexture(
    _slot: string,
    assetId: string,
    state: LpcAnimationState,
  ): Promise<Texture> {
    const stateSuffix = lpcStateSuffix(state);
    const cacheKey = `__lpc__${assetId}.${stateSuffix}`;

    const cached = this._sheetTextureCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const cachedPromise = this._sheetTexturePromises.get(cacheKey);
    if (cachedPromise) {
      return cachedPromise;
    }

    const promise = (async () => {
      if (!this._lpcRenderer) {
        return Texture.EMPTY;
      }
      const texture = await this._lpcRenderer.loadSheet(assetId, state);
      if (texture !== Texture.EMPTY) {
        this._sheetTextureCache.set(cacheKey, texture);
      }
      return texture;
    })();

    this._sheetTexturePromises.set(cacheKey, promise);
    void promise.finally(() => {
      this._sheetTexturePromises.delete(cacheKey);
    });
    return promise;
  }

  // ── Rendering ───────────────────────────────────────────────────────

  private async _renderCharacter(): Promise<void> {
    // Increment generation to invalidate any in-flight renders
    this._renderGeneration++;
    const thisGeneration = this._renderGeneration;

    const currentRecipes = this.recipes;
    const currentFrame = this.animationFrame;
    const currentZoom = this.zoom;
    const currentState = this.animationState;
    const currentDirection = this.facingDirection;

    if (!this.pixiApp || currentRecipes.length === 0) {
      return;
    }

    try {
      const newSprites: Sprite[] = [];

      const layerPromises = currentRecipes.map(async (recipe, i) => {
        if (!recipe) {
          return;
        }

        const recipeSlot = recipe.slot;
        const recipeAssetId = recipe.assetId;

        let texture = await this._loadSheetTexture(recipeSlot, recipeAssetId, currentState);

        if (
          (!texture || texture === Texture.EMPTY) &&
          recipeSlot === 'head' &&
          LPC_DEFAULT_HEAD_ASSET_ID !== recipeAssetId
        ) {
          this.warn('lpc.headFallback', {
            original: recipeAssetId,
            fallback: LPC_DEFAULT_HEAD_ASSET_ID,
          });
          texture = await this._loadSheetTexture('head', LPC_DEFAULT_HEAD_ASSET_ID, currentState);
        }

        if (!texture || texture === Texture.EMPTY) {
          return;
        }

        const layout = detectLpcSheetLayout(texture);
        const col = currentFrame % layout.columns;
        const row = layout.rows > 1 ? currentDirection % layout.rows : 0;
        const x = col * layout.pitch;
        const y = row * layout.pitch;

        if (x + layout.pitch > texture.width || y + layout.pitch > texture.height) {
          return;
        }

        const frameTexture = new Texture({
          source: texture.source,
          frame: new Rectangle(x, y, layout.pitch, layout.pitch),
        });

        const anchor = getLpcSpriteAnchor(layout);
        const sprite = new Sprite(frameTexture);
        sprite.eventMode = 'none';
        sprite.x = anchor.x;
        sprite.y = anchor.y;
        sprite.scale.set(layout.scale, layout.scale);
        sprite.alpha = 1.0;
        sprite.zIndex = resolveLayerDepth({
          slot: recipeSlot,
          layerRole: recipe.layerRole ?? 'front',
          direction: 2,
        });
        (sprite as unknown as Record<string, unknown>)._originalIndex = i;

        const effectiveColor =
          this.layerOverrides[i] && this.paletteColors[i] ? this.paletteColors[i] : this.globalTint;
        if (effectiveColor) {
          const tintR = Number.parseInt(effectiveColor.slice(1, 3), 16);
          const tintG = Number.parseInt(effectiveColor.slice(3, 5), 16);
          const tintB = Number.parseInt(effectiveColor.slice(5, 7), 16);
          if (!Number.isNaN(tintR) && !Number.isNaN(tintG) && !Number.isNaN(tintB)) {
            sprite.tint = (tintR << 16) | (tintG << 8) | tintB;
          }
        }

        newSprites.push(sprite);
      });

      await Promise.all(layerPromises);

      // Check if this render is stale
      if (thisGeneration !== this._renderGeneration) {
        // Stale render — destroy newly created children and abort
        for (const sprite of newSprites) {
          sprite.destroy();
        }
        return;
      }

      this._destroyAllSprites();

      newSprites.sort((a, b) => {
        if (a.zIndex !== b.zIndex) {
          return a.zIndex - b.zIndex;
        }
        const aIdx = (a as unknown as Record<string, unknown>)._originalIndex as number;
        const bIdx = (b as unknown as Record<string, unknown>)._originalIndex as number;
        return aIdx - bIdx;
      });

      const container = new Container();
      container.eventMode = 'none';
      container.sortableChildren = true;

      for (const s of newSprites) {
        container.addChild(s);
        this._layerSprites.push(s);
      }

      container.scale.set(currentZoom, currentZoom);
      container.x = CanvasWidth / 2;
      container.y = CanvasHeight / 2;

      this.pixiApp.stage.addChild(container);
      this._characterContainer = container;
      this.compositionFailed = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error('lpcPreview.composeFailed', { error: message });
      this._destroyAllSprites();
      this.compositionFailed = true;
      this._setStatus(`Composition failed: ${message}`, 'error');
    }
  }

  private _destroyAllSprites(): void {
    for (const sprite of this._layerSprites) {
      sprite.destroy();
    }
    this._layerSprites = [];

    if (this._characterContainer) {
      if (this._characterContainer.parent) {
        this._characterContainer.parent.removeChild(this._characterContainer);
      }
      this._characterContainer.destroy({ children: true });
      this._characterContainer = undefined;
    }

    if (this._gridGraphics) {
      if (this._gridGraphics.parent) {
        this._gridGraphics.parent.removeChild(this._gridGraphics);
      }
      this._gridGraphics.destroy({ children: true });
      this._gridGraphics = undefined;
    }
  }

  // ── Grid overlay ────────────────────────────────────────────────────

  private _updateGridOverlay(): void {
    if (!this.pixiApp) {
      return;
    }

    if (this._gridGraphics) {
      this.pixiApp.stage.removeChild(this._gridGraphics);
      this._gridGraphics.destroy();
      this._gridGraphics = undefined;
    }

    if (!this.showGridOverlay) {
      return;
    }

    const gfx = new Graphics();
    gfx.rect(0, 0, 64, 64);
    gfx.stroke({ color: 0x4444ff, width: 1, alpha: 0.6 });
    gfx.moveTo(32, 0);
    gfx.lineTo(32, 64);
    gfx.moveTo(0, 32);
    gfx.lineTo(64, 32);
    gfx.stroke({ color: 0x4444ff, width: 1, alpha: 0.35 });
    gfx.moveTo(16, 0);
    gfx.lineTo(16, 64);
    gfx.moveTo(48, 0);
    gfx.lineTo(48, 64);
    gfx.moveTo(0, 16);
    gfx.lineTo(64, 16);
    gfx.moveTo(0, 48);
    gfx.lineTo(64, 48);
    gfx.stroke({ color: 0x4444ff, width: 1, alpha: 0.18 });
    gfx.eventMode = 'none';

    const gridContainer = new Container();
    gridContainer.eventMode = 'none';
    gridContainer.scale.set(this.zoom, this.zoom);
    gridContainer.x = CanvasWidth / 2;
    gridContainer.y = CanvasHeight / 2;
    gfx.x = -32;
    gfx.y = -32;
    gridContainer.addChild(gfx);

    this.pixiApp.stage.addChild(gridContainer);
    this._gridGraphics = gridContainer;
  }

  // ── State serialisation ─────────────────────────────────────────────

  getStateParams(): URLSearchParams {
    return encodeLpcPreviewState(this._buildPreviewState());
  }

  private _buildPreviewState(): LpcPreviewState {
    return {
      layers: this.activeLayers.map((layer) => ({
        slotDefIndex: layer.slotDefIndex,
        variantIndex: layer.variantIndex,
      })),
      paletteOverrides: new Map(
        Object.entries(this.layerOverrides)
          .filter(([, enabled]) => enabled)
          .map(([key]) => {
            const idx = Number(key);
            return [key, this.paletteColors[idx] ?? ''] as const;
          }),
      ),
      state: this.animationState,
      direction: this.facingDirection,
      frame: this.animationFrame,
      playing: this.isPlaying,
      zoom: this.zoom,
    };
  }

  private _applyPreviewState(state: LpcPreviewState): void {
    if (state.layers.length > 0) {
      this.activeLayers = state.layers.map((entry) => ({
        slotDefIndex: entry.slotDefIndex,
        variantIndex: entry.variantIndex,
      }));
    }
    this.animationState = state.state;
    this._updateMaxFrame(state.state);
    this.facingDirection = state.direction;
    this.animationFrame = state.frame;
    this.isPlaying = state.playing;
    this.zoom = state.zoom;

    // Restore palette overrides
    if (state.paletteOverrides && state.paletteOverrides.size > 0) {
      for (const [idx, color] of state.paletteOverrides) {
        this.layerOverrides = { ...this.layerOverrides, [idx]: true };
        if (color) {
          this.paletteColors = { ...this.paletteColors, [idx]: color };
        }
      }
    }
  }

  // ── Initialize / Dispose ────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this._lpcRenderer = createLpcRenderer({ resolver: this._resolver });

    this.registerEffectRoot(() => {
      $effect(() => {
        void this.showGridOverlay;
        void this.zoom;
        this._updateGridOverlay();
      });

      $effect(() => {
        void this.activeLayers.map((l) => `${l.slotDefIndex}:${l.variantIndex}`).join(',');
        void this.animationState;
        void this.facingDirection;
        void this.animationFrame;
        void this.isPlaying;
        void this.zoom;

        if (this.pixiApp) {
          const state = this._buildPreviewState();
          this._onStateChange?.(state);
        }
      });

      $effect(() => {
        void this.recipes;
        void this.animationFrame;
        void this.zoom;
        void this.animationState;
        void this.facingDirection;
        this._renderCharacter();
      });

      $effect(() => {
        if (this.canvasElement && !this.pixiApp) {
          void this._initPixiApp();
        }
      });
    });

    return await super.initialize();
  }

  private async _initPixiApp(): Promise<void> {
    if (!this.canvasElement) {
      return;
    }

    try {
      const result = await createPixiApp({
        canvas: this.canvasElement,
        width: CanvasWidth,
        height: CanvasHeight,
        backgroundColor: 0x0d0d1a,
      });

      this.pixiApp = result.app;
      this.pixiApp.stage.addChild(this.stageContainer);

      const canvas = this.pixiApp.renderer.canvas as HTMLCanvasElement;
      // preventDefault() is required by the WebGL spec for the browser to
      // attempt restoration — without it `webglcontextrestored` never fires
      // and the preview stays blank permanently. The status banner matters
      // just as much: a lost context renders nothing and raises no error, so
      // without it the canvas is simply, inexplicably empty.
      canvas.addEventListener('webglcontextlost', (event: Event) => {
        event.preventDefault();
        this.error('lpcPreview.webglContextLost', { event: String(event) });
        this._setStatus('WebGL context lost — the GPU dropped the canvas.', 'error');
      });
      canvas.addEventListener('webglcontextrestored', () => {
        this.warn('lpcPreview.webglContextRestored');
        this._setStatus('WebGL context restored.', 'info');
      });

      const app = result.app;
      app.ticker.add(() => {
        const delta = app.ticker.deltaMS;
        this.fps = result.debug.fps;
        this.frameDurationMs = result.debug.frameDurationMs;

        if (this.isPlaying) {
          const frameInterval = 1000 / this.playbackFps;
          this._tickAccumulator += delta;

          while (this._tickAccumulator >= frameInterval) {
            this._tickAccumulator -= frameInterval;
            this.animationFrame = (this.animationFrame + 1) % (this.maxFrame + 1);
          }
        }
      });

      this._setStatus('LPC preview initialized.', 'info');

      if (typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>).__PIXI_LOADED__ = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error('lpcPreview.initFailed', { error: message });
      this._setStatus(`Initialization failed: ${message}`, 'error');
    }
  }

  override async dispose(): Promise<void> {
    this._destroyAllSprites();
    this._sheetTextureCache.clear();
    this._sheetTexturePromises.clear();

    if (this.stageContainer.parent) {
      this.stageContainer.parent.removeChild(this.stageContainer);
    }
    this.stageContainer.destroy({ children: true });

    if (this.pixiApp) {
      this.pixiApp.destroy(true, { children: true });
      this.pixiApp = undefined;
    }

    return await super.dispose();
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export const getLpcPreviewViewModel = (
  options: LpcPreviewViewModelOptions,
): LpcPreviewViewModelInterface => LpcPreviewViewModel.create(options);
