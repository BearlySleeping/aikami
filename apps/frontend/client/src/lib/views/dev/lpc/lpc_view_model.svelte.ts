// apps/frontend/client/src/lib/views/dev/lpc/lpc_view_model.svelte.ts

import type { LpcLayerRecipe } from '@aikami/frontend/engine';
import { createPixiApp, LpcBatchManager, TextureManager } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { Application } from 'pixi.js';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { setContext } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import {
  LPC_BATCH_MANAGER_KEY,
  LPC_STAGE_CONTAINER_KEY,
} from '$lib/components/game/lpc_context_keys';
import {
  ALL_LPC_SLOTS,
  ANIMATION_STATE_OPTIONS,
  buildPaletteBuffer,
  DIRECTION_OPTIONS,
  hexToPixiTint,
  LPC_DEFAULT_PALETTE,
  LPC_LAYER_Z_INDEX,
} from '$lib/data/lpc_asset_catalog';
import { getAvailableLpcAssets } from '$lib/data/lpc_asset_checker';
import { createPlaceholderTexture, getLpcAssetPath } from '$lib/data/lpc_asset_path_mapper';
import { LpcAnimationState, LpcDirection } from '$lib/data/lpc_models';
import {
  type LpcUrlState,
  lpcStateToSearchParams,
  searchParamsToLpcState,
} from '$lib/data/lpc_url_config';

// Compute the available slots at initialization based on static folder contents.
// We do this eagerly but outside of component state to avoid constant re-evaluation.
const AVAILABLE_ASSET_IDS = getAvailableLpcAssets();

// Create a dynamically filtered slot list so that variants without files are hidden.
const FILTERED_LPC_SLOTS: typeof ALL_LPC_SLOTS = ALL_LPC_SLOTS.map((slot) => {
  return {
    ...slot,
    variants: slot.variants.filter((variant) => AVAILABLE_ASSET_IDS.has(variant.assetId)),
  };
}).filter((slot) => slot.variants.length > 0);

// ── Constants ────────────────────────────────────────────────────────────

const MAX_LAYERS = 8;
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const ENTITY_X = CANVAS_WIDTH / 2;
const ENTITY_Y = CANVAS_HEIGHT / 2 - 32;
const PALETTE_DISPLAY_COUNT = 16;
const FALLBACK_COLOR = 0xff00ff;

// ── Types ─────────────────────────────────────────────────────────────────

/** Active layer configuration with palette state. */
export type ActiveLayerConfig = {
  slotDefIndex: number;
  variantIndex: number;
  palette: string[];
  selectedPaletteIndex: number;
};

export type LpcViewModelInterface = BaseViewModelInterface & {
  readonly isFullscreen: boolean;
  canvasElement: HTMLCanvasElement | undefined;
  setCanvasElement(canvas: HTMLCanvasElement): void;
  provideSvelteContext(): void;

  readonly batchManager: LpcBatchManager;
  readonly stageContainer: Container;

  readonly pixiApp: Application | undefined;
  readonly statusBanner: { message: string; level: 'info' | 'warn' | 'error' } | undefined;

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

  readonly fps: number;
  readonly frameDurationMs: number;
  readonly totalFrames: number;
  readonly structuralHashes: number;
  readonly batchUpdates: number;
  readonly activeInstances: number;
  readonly poolSize: number;
  readonly tickerFrame: number;
  readonly frameBudgetPercent: string;
  readonly compositionFailed: boolean;
  readonly zoom: number;

  readonly MAX_LAYERS: number;
  readonly CANVAS_WIDTH: number;
  readonly CANVAS_HEIGHT: number;
  readonly ENTITY_X: number;
  readonly ENTITY_Y: number;
  readonly PALETTE_DISPLAY_COUNT: number;
  readonly allSlots: typeof ALL_LPC_SLOTS;
  readonly animationStateOptions: typeof ANIMATION_STATE_OPTIONS;
  readonly directionOptions: typeof DIRECTION_OPTIONS;

  togglePlayback(): void;
  stepNext(): void;
  stepPrev(): void;
  clearStatus(): void;
  addLayer(): void;
  removeLayer(index: number): void;
  setSlotDef(layerIndex: number, slotDefIndex: number): void;
  setVariant(layerIndex: number, variantIndex: number): void;
  setPaletteColor(layerIndex: number, paletteIndex: number, hexColor: string): void;
  setSelectedPaletteIndex(layerIndex: number, paletteIndex: number): void;
  getPaletteHex(layerIndex: number): string;
  setAnimationState(state: LpcAnimationState): void;
  setFacingDirection(direction: LpcDirection): void;
  setAnimationFrame(frame: number): void;
  setPlaybackFps(fps: number): void;
  setShowGridOverlay(show: boolean): void;
  setIsolateLayerIndex(index: number): void;
  setZoom(zoom: number): void;
};

export type LpcViewModelOptions = BaseViewModelOptions & {};

class LpcViewModel extends BaseViewModel<LpcViewModelOptions> implements LpcViewModelInterface {
  // ── Constants (exposed) ──────────────────────────────────────────────

  readonly MAX_LAYERS = MAX_LAYERS;
  readonly CANVAS_WIDTH = CANVAS_WIDTH;
  readonly CANVAS_HEIGHT = CANVAS_HEIGHT;
  readonly ENTITY_X = ENTITY_X;
  readonly ENTITY_Y = ENTITY_Y;
  readonly PALETTE_DISPLAY_COUNT = PALETTE_DISPLAY_COUNT;
  readonly allSlots = FILTERED_LPC_SLOTS as typeof ALL_LPC_SLOTS;
  readonly animationStateOptions = ANIMATION_STATE_OPTIONS as typeof ANIMATION_STATE_OPTIONS;
  readonly directionOptions = DIRECTION_OPTIONS as typeof DIRECTION_OPTIONS;

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

  // ── Telemetry ───────────────────────────────────────────────────────

  fps = $state(0);
  frameDurationMs = $state(0);
  totalFrames = $state(0);
  structuralHashes = $state(0);
  batchUpdates = $state(0);
  activeInstances = $state(0);
  poolSize = $state(8);
  tickerFrame = $state(0);
  compositionFailed = $state(false);

  // ── Zoom ────────────────────────────────────────────────────────────

  zoom = $state(1);

  // ── Private internals ───────────────────────────────────────────────

  private _textureManager = new TextureManager({
    loadTexture: async (): Promise<Texture> => Texture.WHITE,
  });

  private _frameTextureCache = new Map<string, Texture>();
  private _sheetTextureCache = new Map<string, Texture>();
  private _sheetTexturePromises = new Map<string, Promise<Texture>>();

  private _characterContainer: Container | undefined;
  private _layerSprites: Sprite[] = [];
  private _gridGraphics: Graphics | undefined;
  private _tickAccumulator = 0;
  private _isApplyingUrlState = false;
  private _pushUrlTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Derived ─────────────────────────────────────────────────────────

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

      const slotDef = FILTERED_LPC_SLOTS[layer.slotDefIndex];
      if (!slotDef) {
        continue;
      }
      const variant = slotDef.variants[layer.variantIndex];
      if (!variant) {
        continue;
      }

      result.push({
        slot: slotDef.slot,
        assetId: variant.assetId,
        hexPalette: buildPaletteBuffer(layer.palette),
      });
    }

    return result;
  }

  get frameBudgetPercent(): string {
    return this.frameDurationMs > 0 ? ((this.frameDurationMs / 16.6) * 100).toFixed(1) : '0.0';
  }

  get isFullscreen(): boolean {
    return page.url.searchParams.has('fullscreen');
  }

  // ── Canvas setter ───────────────────────────────────────────────────

  setCanvasElement(canvas: HTMLCanvasElement): void {
    this.canvasElement = canvas;
  }

  // ── Svelte context ─────────────────────────────────────────────────

  /**
   * Provides LPC batch manager and stage container to child components
   * via Svelte's context API. Must be called during component initialization
   * (from the view's `<script>` block).
   */
  provideSvelteContext(): void {
    setContext(LPC_BATCH_MANAGER_KEY, this.batchManager);
    setContext(LPC_STAGE_CONTAINER_KEY, this.stageContainer);
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
    if (this.activeLayers.length >= MAX_LAYERS) {
      this._setStatus(`Maximum ${MAX_LAYERS} layers reached.`, 'warn');
      return;
    }

    const usedSlotKeys = new Set(
      this.activeLayers.map((l) => {
        const def = FILTERED_LPC_SLOTS[l.slotDefIndex];
        return def?.slot;
      }),
    );

    const unusedIndex = FILTERED_LPC_SLOTS.findIndex((s) => !usedSlotKeys.has(s.slot));
    const slotDefIndex =
      unusedIndex >= 0 ? unusedIndex : this.activeLayers.length % FILTERED_LPC_SLOTS.length;

    this.activeLayers = [
      ...this.activeLayers,
      {
        slotDefIndex,
        variantIndex: 0,
        palette: [...LPC_DEFAULT_PALETTE],
        selectedPaletteIndex: 0,
      },
    ];
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

  // ── Palette ─────────────────────────────────────────────────────────

  setPaletteColor(layerIndex: number, paletteIndex: number, hexColor: string): void {
    this.activeLayers = this.activeLayers.map((layer, i) => {
      if (i !== layerIndex) {
        return layer;
      }
      const newPalette = [...layer.palette];
      newPalette[paletteIndex] = hexColor;
      return { ...layer, palette: newPalette, selectedPaletteIndex: paletteIndex };
    });
  }

  setSelectedPaletteIndex(layerIndex: number, paletteIndex: number): void {
    this.activeLayers = this.activeLayers.map((l, li) =>
      li === layerIndex ? { ...l, selectedPaletteIndex: paletteIndex } : l,
    );
  }

  getPaletteHex(layerIndex: number): string {
    const layer = this.activeLayers[layerIndex];
    if (!layer) {
      return '000000';
    }
    return layer.palette[layer.selectedPaletteIndex] ?? '000000';
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
    this.playbackFps = fps;
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

  private async _loadSheetTexture(path: string, slot: string, assetId: string): Promise<Texture> {
    const cachedTexture = this._sheetTextureCache.get(path);
    if (cachedTexture) {
      return cachedTexture;
    }
    const cachedPromise = this._sheetTexturePromises.get(path);
    if (cachedPromise) {
      return cachedPromise;
    }

    const promise = (async () => {
      const { Assets } = await import('pixi.js');
      try {
        const sheet = await Assets.load(path);
        sheet.source.scaleMode = 'nearest';
        this._sheetTextureCache.set(path, sheet);
        return sheet;
      } catch {
        const fallback = await createPlaceholderTexture(slot, assetId);
        this._sheetTextureCache.set(path, fallback);
        return fallback;
      }
    })();

    this._sheetTexturePromises.set(path, promise);
    return promise;
  }

  private async _getRealFrameTexture(
    slot: string,
    assetId: string,
    state: LpcAnimationState,
    frameIndex: number,
    sheet: Texture,
  ): Promise<Texture> {
    const frameKey = `${slot}:${assetId}:${state}:${frameIndex}`;

    const cached = this._frameTextureCache.get(frameKey);
    if (cached) {
      return cached;
    }

    if (sheet === Texture.EMPTY) {
      return Texture.EMPTY;
    }

    // Determine layout dynamically based on texture size
    const columns = Math.floor(sheet.width / 64);
    const rows = Math.floor(sheet.height / 64);

    const frame = this._textureManager.getFrameAt({
      texture: sheet,
      layout: { frameWidth: 64, frameHeight: 64, columns, rows },
      frameIndex,
    });

    if (frame) {
      this._frameTextureCache.set(frameKey, frame);
      return frame;
    }

    return Texture.EMPTY;
  }

  // ── Rendering ───────────────────────────────────────────────────────

  private async _renderCharacter(): Promise<void> {
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
        const layer = this.activeLayers[i];
        if (!recipe || !layer) {
          return;
        }

        const slotDef = FILTERED_LPC_SLOTS[layer.slotDefIndex];
        const variant = slotDef?.variants[layer.variantIndex];
        if (!variant) {
          return;
        }

        const path = getLpcAssetPath(slotDef.slot, variant.assetId, currentState);
        const sheet = await this._loadSheetTexture(path, slotDef.slot, variant.assetId);

        if (sheet === Texture.EMPTY) {
          return;
        }

        let effectiveRow = currentDirection;
        const columns = Math.floor(sheet.width / 64);
        const rows = Math.floor(sheet.height / 64);
        if (rows === 1) {
          effectiveRow = 0;
        }

        const frameCol = currentFrame % columns;
        const frameIndex = effectiveRow * columns + frameCol;

        const frameTexture = await this._getRealFrameTexture(
          slotDef.slot,
          variant.assetId,
          currentState,
          frameIndex,
          sheet,
        );

        if (frameTexture === Texture.EMPTY) {
          return;
        }

        const sprite = new Sprite(frameTexture);
        sprite.eventMode = 'none';
        sprite.x = -32;
        sprite.y = -32;
        sprite.alpha = 1.0;

        // Apply the active palette color to the layer.
        // We skip 000000 (default transparent black) so we don't accidentally turn assets invisible/black
        const hexColor = layer.palette[layer.selectedPaletteIndex];
        if (hexColor && hexColor !== '000000') {
          sprite.tint = hexToPixiTint(hexColor);
        }

        const zIndex = LPC_LAYER_Z_INDEX[slotDef.slot];
        if (zIndex !== undefined) {
          sprite.zIndex = zIndex;
        }

        newSprites.push(sprite);
      });

      await Promise.all(layerPromises);

      this._destroyAllSprites();

      const container = new Container();
      container.eventMode = 'none';
      container.sortableChildren = true;

      newSprites.sort((a, b) => a.zIndex - b.zIndex);
      for (const s of newSprites) {
        container.addChild(s);
        this._layerSprites.push(s);
      }

      container.scale.set(currentZoom, currentZoom);
      container.x = CANVAS_WIDTH / 2;
      container.y = CANVAS_HEIGHT / 2;

      this.pixiApp.stage.addChild(container);
      this._characterContainer = container;
      this.compositionFailed = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error('lpcDebugger.composeFailed', { error: message });

      const fallbackGfx = new Graphics();
      fallbackGfx.rect(0, 0, 64, 64);
      fallbackGfx.fill({ color: FALLBACK_COLOR, alpha: 0.9 });
      fallbackGfx.rect(0, 0, 64, 64);
      fallbackGfx.stroke({ color: 0xff0000, width: 2 });
      fallbackGfx.x = CANVAS_WIDTH / 2 - 32;
      fallbackGfx.y = CANVAS_HEIGHT / 2 - 32;
      fallbackGfx.eventMode = 'none';

      this.pixiApp.stage.addChild(fallbackGfx);
      this._characterContainer = undefined;
      this._layerSprites = [];
      this.compositionFailed = true;

      this._setStatus(`Composition failed: ${message} — fallback block shown.`, 'error');
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
    gfx.x = CANVAS_WIDTH / 2 - 32;
    gfx.y = CANVAS_HEIGHT / 2 - 32;
    gfx.eventMode = 'none';

    this.pixiApp.stage.addChild(gfx);
    this._gridGraphics = gfx;
  }

  // ── URL sync (state ↔ URL) ──────────────────────────────────────────

  private _urlStateToActiveLayers(urlState: LpcUrlState): ActiveLayerConfig[] {
    return urlState.layers.map((entry, layerIndex) => {
      const palette = [...LPC_DEFAULT_PALETTE];

      for (const [key, hex] of urlState.paletteOverrides) {
        const colonIdx = key.indexOf(':');
        if (colonIdx === -1) {
          continue;
        }
        const overrideLayerIdx = Number.parseInt(key.slice(0, colonIdx), 10);
        if (overrideLayerIdx !== layerIndex) {
          continue;
        }
        const paletteIdx = Number.parseInt(key.slice(colonIdx + 1), 10);
        if (!Number.isNaN(paletteIdx) && paletteIdx >= 0 && paletteIdx < 256) {
          palette[paletteIdx] = hex;
        }
      }

      return {
        slotDefIndex: entry.slotDefIndex,
        variantIndex: entry.variantIndex,
        palette,
        selectedPaletteIndex: 0,
      };
    });
  }

  private _createDefaultLayers(): ActiveLayerConfig[] {
    const bodySlotIdx = FILTERED_LPC_SLOTS.findIndex((s) => s.slot === 'body');
    const hairSlotIdx = FILTERED_LPC_SLOTS.findIndex((s) => s.slot === 'hair');

    return [
      {
        slotDefIndex: bodySlotIdx >= 0 ? bodySlotIdx : 0,
        variantIndex: 0,
        palette: [...LPC_DEFAULT_PALETTE],
        selectedPaletteIndex: 0,
      },
      {
        slotDefIndex: hairSlotIdx >= 0 ? hairSlotIdx : 0,
        variantIndex: 0,
        palette: [...LPC_DEFAULT_PALETTE],
        selectedPaletteIndex: 64,
      },
    ];
  }

  private _applyUrlParamsToState(): void {
    this._isApplyingUrlState = true;

    const currentParams = page.url.searchParams;
    const urlState = searchParamsToLpcState(currentParams);

    if (urlState.layers.length > 0) {
      this.activeLayers = this._urlStateToActiveLayers(urlState);
    } else {
      this.activeLayers = this._createDefaultLayers();
    }

    this.animationState = urlState.state;
    this._updateMaxFrame(urlState.state);
    this.facingDirection = urlState.direction;
    this.animationFrame = urlState.frame;
    this.isPlaying = urlState.playing;
    this.zoom = urlState.zoom;

    this._isApplyingUrlState = false;
  }

  private _collectPaletteOverrides(): Map<string, string> {
    const overrides = new Map<string, string>();

    for (let i = 0; i < this.activeLayers.length; i++) {
      const layer = this.activeLayers[i];
      if (!layer) {
        continue;
      }

      for (let p = 0; p < layer.palette.length; p++) {
        const current = layer.palette[p];
        const default_ = LPC_DEFAULT_PALETTE[p];
        if (current !== default_ && current !== '000000') {
          overrides.set(`${i}:${p}`, current ?? '000000');
        }
      }
    }

    return overrides;
  }

  private _pushStateToUrl(): void {
    if (this._isApplyingUrlState) {
      return;
    }

    if (this._pushUrlTimer !== undefined) {
      clearTimeout(this._pushUrlTimer);
    }

    this._pushUrlTimer = setTimeout(() => {
      this._pushUrlTimer = undefined;

      const urlState: LpcUrlState = {
        layers: this.activeLayers.map((layer) => ({
          slotDefIndex: layer.slotDefIndex,
          variantIndex: layer.variantIndex,
        })),
        paletteOverrides: this._collectPaletteOverrides(),
        state: this.animationState,
        direction: this.facingDirection,
        frame: this.animationFrame,
        playing: this.isPlaying,
        zoom: this.zoom,
      };

      const params = lpcStateToSearchParams(urlState);
      const newUrl = `${page.url.pathname}?${params.toString()}`;

      this._isApplyingUrlState = true;
      void goto(newUrl, { replaceState: true, keepFocus: true, noScroll: true }).finally(() => {
        this._isApplyingUrlState = false;
      });
    }, 100);
  }

  private _exposeTestHooks(): void {
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__lpc_debug_active_recipes =
        this.activeLayers.map((layer, i) => {
          const slotDef = FILTERED_LPC_SLOTS[layer.slotDefIndex];
          const variant = slotDef?.variants[layer.variantIndex];
          return {
            index: i,
            slot: slotDef?.slot ?? 'unknown',
            assetId: variant?.assetId ?? '',
            variantLabel: variant?.label ?? '',
            shapeType: variant?.shapeType ?? 'default',
            paletteIndex0: layer.palette[0],
          };
        });
      (window as unknown as Record<string, unknown>).__lpc_active_instances =
        this.batchManager.activeInstances;
      (window as unknown as Record<string, unknown>).__lpc_structural_hashes =
        this.batchManager.structuralHashesIssued;
      (window as unknown as Record<string, unknown>).__lpc_lab_play_state = this.isPlaying;
      (window as unknown as Record<string, unknown>).__lpc_lab_current_frame = this.animationFrame;
      (window as unknown as Record<string, unknown>).__lpc_lab_active_slots = this.activeLayers.map(
        (l) => {
          const def = FILTERED_LPC_SLOTS[l.slotDefIndex];
          return def?.slot ?? 'unknown';
        },
      );
      (window as unknown as Record<string, unknown>).__lpc_workbench_active_layers =
        this.activeLayers.map((layer) => {
          const slotDef = FILTERED_LPC_SLOTS[layer.slotDefIndex];
          const variant = slotDef?.variants[layer.variantIndex];
          return {
            slot: slotDef?.slot ?? 'unknown',
            variant: variant?.label ?? '',
            shapeType: variant?.shapeType ?? 'default',
            assetId: variant?.assetId ?? '',
            paletteSize: layer.palette.length,
          };
        });
      (window as unknown as Record<string, unknown>).__lpc_workbench_mock_cache_size = 0;
    }
  }

  // ── Initialize / Dispose ────────────────────────────────────────────

  constructor(options: LpcViewModelOptions) {
    super(options);

    this.stageContainer = new Container();
    this.stageContainer.label = 'lpc-character-stage';

    // Provide Svelte context to child LpcCharacterRenderer component.
    // Called in constructor so setContext runs during component init.
    this.provideSvelteContext();
  }

  override async initialize(): Promise<void> {
    // Register $effect blocks via registerEffectRoot.
    // PixiJS init is deferred to a reactive $effect that fires when
    // canvasElement becomes available (after bind:this propagates).
    // We do NOT react to page.url.searchParams anymore to prevent infinite
    // loops where the URL state fights the local ticker state.
    // Instead, we only push our state to the URL.

    this.registerEffectRoot(() => {
      $effect(() => {
        void this.showGridOverlay;
        this._updateGridOverlay();
      });
    });

    this.registerEffectRoot(() => {
      $effect(() => {
        void this.activeLayers
          .map((l) => `${l.slotDefIndex}:${l.variantIndex}:${l.palette[l.selectedPaletteIndex]}`)
          .join(',');
        void this.animationState;
        void this.facingDirection;
        void this.animationFrame;
        void this.isPlaying;
        void this.zoom;

        if (this.pixiApp && !this._isApplyingUrlState) {
          this._pushStateToUrl();
        }
      });
    });

    this.registerEffectRoot(() => {
      $effect(() => {
        void this.recipes;
        void this.animationFrame;
        void this.zoom;
        void this.animationState;
        void this.facingDirection;

        this._renderCharacter();
      });
    });

    this.registerEffectRoot(() => {
      $effect(() => {
        this._exposeTestHooks();
      });
    });

    // PixiJS init — fires reactively when canvasElement becomes available.
    // This avoids the timing race between bind:this propagation and onMount.
    this.registerEffectRoot(() => {
      $effect(() => {
        if (this.canvasElement && !this.pixiApp) {
          void this._initPixiApp();
        }
      });
    });

    return await super.initialize();
  }

  /**
   * Creates the PixiJS application and attaches it to the canvas.
   *
   * Called reactively by a $effect when canvasElement becomes available.
   * Registers WebGL context loss listeners, per-frame telemetry ticker,
   * and playback ticker logic.
   */
  private async _initPixiApp(): Promise<void> {
    if (!this.canvasElement) {
      return;
    }

    try {
      const result = await createPixiApp({
        canvas: this.canvasElement,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        backgroundColor: 0x0d0d1a,
      });

      this.pixiApp = result.app;
      this.pixiApp.stage.addChild(this.stageContainer);

      const canvas = this.pixiApp.renderer.canvas as HTMLCanvasElement;
      canvas.addEventListener('webglcontextlost', (event: Event) => {
        this.error('lpcViewModel.webglContextLost', { event: String(event) });
      });
      canvas.addEventListener('webglcontextrestored', () => {
        this.warn('lpcViewModel.webglContextRestored');
      });

      const app = result.app;
      app.ticker.add(() => {
        const delta = app.ticker.deltaMS;
        this.fps = result.debug.fps;
        this.frameDurationMs = result.debug.frameDurationMs;
        this.totalFrames = result.debug.totalFrames;
        this.structuralHashes = this.batchManager.structuralHashesIssued;
        this.batchUpdates = this.batchManager.batchUpdatesPerformed;
        this.activeInstances = this.batchManager.activeInstances;
        this.tickerFrame += 1;

        if (this.isPlaying) {
          const frameInterval = 1000 / this.playbackFps;
          this._tickAccumulator += delta;

          while (this._tickAccumulator >= frameInterval) {
            this._tickAccumulator -= frameInterval;
            this.animationFrame = (this.animationFrame + 1) % (this.maxFrame + 1);
          }
        }
      });

      this._applyUrlParamsToState();
      this._setStatus('LPC debugger initialized.', 'info');

      // Signal to Playwright visual tests that PixiJS is ready
      if (typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>).__PIXI_LOADED__ = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error('lpcViewModel.initFailed', { error: message });
      this._setStatus(`Initialization failed: ${message}`, 'error');
    }
  }

  override async dispose(): Promise<void> {
    this._destroyAllSprites();

    this._sheetTextureCache.clear();
    this._sheetTexturePromises.clear();
    this._frameTextureCache.clear();

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

export const getLpcViewModel = (options: LpcViewModelOptions): LpcViewModelInterface =>
  new LpcViewModel(options);
