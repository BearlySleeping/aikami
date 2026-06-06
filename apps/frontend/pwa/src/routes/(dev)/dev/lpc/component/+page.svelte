<script lang="ts">
  import type { LpcLayerRecipe } from '@aikami/frontend/engine';
  import {
    createPixiApp,
    getLpcStateRow,
    LpcAnimationState,
    LpcBatchManager,
    LpcDirection,
    TextureManager,
  } from '@aikami/frontend/engine';
  // apps/frontend/pwa/src/routes/(dev)/dev/lpc/component/+page.svelte
  import type { Application } from 'pixi.js';
  import { Container, Graphics, Sprite, Texture } from 'pixi.js';
  import { onMount, setContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import LpcCharacterRenderer from '$lib/components/game/lpc_character_renderer.svelte';
  import {
    LPC_BATCH_MANAGER_KEY,
    LPC_STAGE_CONTAINER_KEY,
  } from '$lib/components/game/lpc_context_keys.ts';
  import type { LpcMockShapeType, LpcSlotVariant } from '$lib/data/lpc_asset_catalog.ts';
  import {
    ALL_LPC_SLOTS,
    ANIMATION_STATE_OPTIONS,
    buildPaletteBuffer,
    DIRECTION_OPTIONS,
    LPC_DEFAULT_PALETTE,
  } from '$lib/data/lpc_asset_catalog.ts';
  import { generateMockLpcSheet, LPC_MOCK_LAYOUT } from '$lib/data/lpc_asset_path_mapper.ts';
  import {
    createDefaultLpcUrlState,
    type LpcUrlState,
    lpcStateToSearchParams,
    searchParamsToLpcState,
  } from '$lib/data/lpc_url_config.ts';
  import { logger } from '$logger';

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  const MAX_LAYERS = 8;
  const CANVAS_WIDTH = 960;
  const CANVAS_HEIGHT = 540;
  const ENTITY_X = CANVAS_WIDTH / 2;
  const ENTITY_Y = CANVAS_HEIGHT / 2 - 32;
  const PALETTE_SIZE = 256;
  const PALETTE_DISPLAY_COUNT = 16;
  const LPC_LAYOUT = { frameWidth: 64, frameHeight: 64, columns: 13 } as const;
  const FALLBACK_COLOR = 0xff00ff;

  // -----------------------------------------------------------------------
  // Batch manager + stage container — created eagerly for synchronous setContext
  // -----------------------------------------------------------------------

  const batchManager = new LpcBatchManager({ maxInstances: 8 });
  setContext(LPC_BATCH_MANAGER_KEY, batchManager);

  /**
   * TextureManager with a custom loader that generates procedural mock
   * LPC spritesheets in dev/emulator mode. Each (slot, shapeType) pair
   * produces a full 832×1344 grid — rendered once and cached.
   */
  const textureManager = new TextureManager({
    loadTexture: async (_key: number): Promise<Texture> => {
      // Numeric keys are compound: high 16 bits = row hint, low 16 bits = index.
      // The actual mock sheet is resolved by slot + shapeType via _mockSheetCache.
      // This stub is never called directly; getLayeredTextureBatch is used instead.
      return Texture.WHITE;
    },
  });

  /**
   * Cache: `${slot}:${shapeType}` → HTMLCanvasElement.
   *
   * Mock sheets are 832×1344 canvases — expensive to generate (273 cells ×
   * Canvas2D draw calls). Caching ensures each unique variant is drawn once.
   */
  const _mockSheetCanvasCache = new Map<string, HTMLCanvasElement>();

  /**
   * Cache: `${slot}:${shapeType}` → PixiJS Texture.
   *
   * Wraps the canvas cache entries as PixiJS Textures for faster
   * repeated access during frame slicing.
   */
  const _mockSheetTextureCache = new Map<string, Texture>();

  /**
   * Returns a cached PixiJS Texture for a procedural mock LPC spritesheet.
   *
   * Generates the sheet on first access, caches both the canvas and
   * the PixiJS Texture for subsequent calls.
   *
   * @param slot - LPC slot name.
   * @param shapeType - Mock shape variant identifier.
   * @returns A cached PixiJS Texture of the full 832×1344 sheet.
   */
  const _getMockSheetTexture = (slot: string, shapeType: LpcMockShapeType): Texture => {
    const cacheKey = `${slot}:${shapeType}`;

    const cachedTexture = _mockSheetTextureCache.get(cacheKey);
    if (cachedTexture) {
      return cachedTexture;
    }

    const canvas = generateMockLpcSheet(slot, shapeType);
    if (!canvas) {
      return Texture.EMPTY;
    }

    _mockSheetCanvasCache.set(cacheKey, canvas);

    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    _mockSheetTextureCache.set(cacheKey, texture);

    return texture;
  };

  /**
   * Cache key → cached 64×64 frame Texture for tooltip / speed display.
   *
   * Key: `${slot}:${shapeType}:${frameIndex}`
   */
  const _frameTextureCache = new Map<string, Texture>();

  /**
   * Returns a 64×64 frame sub-texture from a mock LPC spritesheet.
   *
   * Caches both the full sheet and the individual frame slices.
   *
   * @param slot - LPC slot name.
   * @param shapeType - Mock shape variant.
   * @param frameIndex - Row-major frame index within the sheet.
   * @returns A 64×64 PixiJS Texture for the specified frame.
   */
  const _getMockFrameTexture = (
    slot: string,
    shapeType: LpcMockShapeType,
    frameIndex: number,
  ): Texture => {
    const frameKey = `${slot}:${shapeType}:${frameIndex}`;

    const cached = _frameTextureCache.get(frameKey);
    if (cached) {
      return cached;
    }

    const sheet = _getMockSheetTexture(slot, shapeType);
    if (sheet === Texture.EMPTY) {
      return Texture.EMPTY;
    }

    const frame = textureManager.getFrameAt({
      texture: sheet,
      layout: LPC_MOCK_LAYOUT,
      frameIndex,
    });

    if (frame) {
      _frameTextureCache.set(frameKey, frame);
      return frame;
    }

    return Texture.EMPTY;
  };

  /**
   * Stage container for LPC texture-based sprite rendering.
   * Created eagerly at init so setContext can reference it.
   * Added to the PixiJS stage in onMount after pixiApp is ready.
   */
  const stageContainer = new Container();
  stageContainer.label = 'lpc-character-stage';
  setContext(LPC_STAGE_CONTAINER_KEY, stageContainer);

  // -----------------------------------------------------------------------
  // Canvas + App refs
  // -----------------------------------------------------------------------

  let canvasElement: HTMLCanvasElement | undefined = $state();
  let pixiApp: Application | undefined;

  // -----------------------------------------------------------------------
  // Status banner
  // -----------------------------------------------------------------------

  let statusBanner: { message: string; level: 'info' | 'warn' | 'error' } | undefined = $state();

  // -----------------------------------------------------------------------
  // Animation controls
  // -----------------------------------------------------------------------

  let animationState = $state<LpcAnimationState>(LpcAnimationState.Walk);
  let facingDirection = $state<LpcDirection>(LpcDirection.Down);
  let animationFrame = $state(0);
  let maxFrame = $state(8);

  // -----------------------------------------------------------------------
  // Animation ticker state — Play/Pause toggle + FPS speed control
  // -----------------------------------------------------------------------

  let isPlaying = $state(false);
  let playbackFps = $state(12);
  let animationTickRef: number | undefined;

  /** Ticks elapsed since last frame advance — used to throttle at playbackFps. */
  let _tickAccumulator = 0;

  // -----------------------------------------------------------------------
  // Diagnostic overlay toggles
  // -----------------------------------------------------------------------

  let showGridOverlay = $state(false);
  let isolateLayerIndex = $state(-1); // -1 = show all layers
  let gridGraphics: Graphics | undefined;

  // -----------------------------------------------------------------------
  // Active layer configurations
  // -----------------------------------------------------------------------

  type ActiveLayerConfig = {
    slotDefIndex: number;
    variantIndex: number;
    palette: string[];
    selectedPaletteIndex: number;
  };

  let activeLayers: ActiveLayerConfig[] = $state([]);

  /** Whether URL sync is currently applying state (suppress pushback loop). */
  let _isApplyingUrlState = false;

  /**
   * Builds ActiveLayerConfig[] from parsed LpcUrlState.
   *
   * Each layer entry in the URL state maps to a full palette-backed
   * configuration with palette overrides applied.
   */
  const _urlStateToActiveLayers = (urlState: LpcUrlState): ActiveLayerConfig[] => {
    return urlState.layers.map((entry, layerIndex) => {
      const palette = [...LPC_DEFAULT_PALETTE];

      // Apply palette overrides for this layer
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
  };

  const _createDefaultLayers = (): ActiveLayerConfig[] => {
    const bodySlotIdx = ALL_LPC_SLOTS.findIndex((s) => s.slot === 'body');
    const hairSlotIdx = ALL_LPC_SLOTS.findIndex((s) => s.slot === 'hair');

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
  };

  // -----------------------------------------------------------------------
  // Derived: LpcLayerRecipe[] for rendering
  // -----------------------------------------------------------------------

  const recipes = $derived.by((): readonly LpcLayerRecipe[] => {
    const result: LpcLayerRecipe[] = [];

    for (let i = 0; i < activeLayers.length; i++) {
      const layer = activeLayers[i];
      if (!layer) {
        continue;
      }

      // Respect isolate layer filter
      if (isolateLayerIndex >= 0 && i !== isolateLayerIndex) {
        continue;
      }

      const slotDef = ALL_LPC_SLOTS[layer.slotDefIndex];
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
  });

  // -----------------------------------------------------------------------
  // Telemetry
  // -----------------------------------------------------------------------

  let fps = $state(0);
  let frameDurationMs = $state(0);
  let totalFrames = $state(0);
  let structuralHashes = $state(0);
  let batchUpdates = $state(0);
  let activeInstances = $state(0);
  let poolSize = $state(batchManager.poolSize);
  let tickerFrame = $state(0);

  const frameBudgetPercent = $derived(
    frameDurationMs > 0 ? ((frameDurationMs / 16.6) * 100).toFixed(1) : '0.0',
  );

  // -----------------------------------------------------------------------
  // Defensive fallback tracking
  // -----------------------------------------------------------------------

  let compositionFailed = $state(false);

  // -----------------------------------------------------------------------
  // Character visual display object
  // -----------------------------------------------------------------------

  /** Container holding all layer sprites for the composed character. */
  let characterContainer: Container | undefined;
  let layerSprites: Sprite[] = [];

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  onMount(async () => {
    if (!canvasElement) {
      setStatus('Canvas element not found.', 'error');
      return;
    }

    try {
      const result = await createPixiApp({
        canvas: canvasElement,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        backgroundColor: 0x0d0d1a,
      });

      pixiApp = result.app;

      // Add the pre-created stage container to the PixiJS stage now that
      // the app is ready. The container was created at component init
      // so setContext could reference it during initialization.
      pixiApp.stage.addChild(stageContainer);

      // Per-frame telemetry ticker
      pixiApp.ticker.add(() => {
        fps = result.debug.fps;
        frameDurationMs = result.debug.frameDurationMs;
        totalFrames = result.debug.totalFrames;
        structuralHashes = batchManager.structuralHashesIssued;
        batchUpdates = batchManager.batchUpdatesPerformed;
        activeInstances = batchManager.activeInstances;
        tickerFrame += 1;
      });

      // Seed layers from URL params (or defaults if empty)
      _applyUrlParamsToState();

      setStatus('LPC debugger initialized.', 'info');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('lpcDebugger.initFailed', { error: message });
      setStatus(`Initialization failed: ${message}`, 'error');
    }
  });

  // -----------------------------------------------------------------------
  // URL → State (on load + navigation)
  // -----------------------------------------------------------------------

  /**
   * Reads current page URL search params and applies them to the
   * component's reactive state. Called on mount and whenever the
   * URL changes externally (back/forward navigation).
   */
  const _applyUrlParamsToState = (): void => {
    _isApplyingUrlState = true;

    const currentParams = $page.url.searchParams;
    const urlState = searchParamsToLpcState(currentParams);

    if (urlState.layers.length > 0) {
      activeLayers = _urlStateToActiveLayers(urlState);
    } else {
      activeLayers = _createDefaultLayers();
    }

    animationState = urlState.state;
    updateMaxFrame(urlState.state);
    facingDirection = urlState.direction;
    animationFrame = urlState.frame;
    isPlaying = urlState.playing;

    if (isPlaying) {
      _startPlayback();
    }

    _isApplyingUrlState = false;
  };

  /**
   * Reactively watch page URL changes (back/forward navigation)
   * and re-apply state.
   */
  $effect(() => {
    void $page.url.searchParams;
    if (!_isApplyingUrlState) {
      _applyUrlParamsToState();
    }
  });

  // -----------------------------------------------------------------------
  // State → URL (on user interaction)
  // -----------------------------------------------------------------------

  /** Debounce timer handle for URL push — avoids rapid-fire pushes. */
  let _pushUrlTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Pushes the current component state to the URL search params.
   *
   * Uses SvelteKit's `goto` with `replaceState` and `keepFocus`
   * so the URL updates without a full page reload or focus loss.
   * Debounced at 100ms to avoid flooding the history on slider drags.
   */
  const _pushStateToUrl = (): void => {
    if (_isApplyingUrlState) {
      return;
    }

    if (_pushUrlTimer !== undefined) {
      clearTimeout(_pushUrlTimer);
    }

    _pushUrlTimer = setTimeout(() => {
      _pushUrlTimer = undefined;

      const urlState: LpcUrlState = {
        layers: activeLayers.map((layer) => ({
          slotDefIndex: layer.slotDefIndex,
          variantIndex: layer.variantIndex,
        })),
        paletteOverrides: _collectPaletteOverrides(),
        state: animationState,
        direction: facingDirection,
        frame: animationFrame,
        playing: isPlaying,
        zoom: 1,
      };

      const params = lpcStateToSearchParams(urlState);
      const newUrl = `${$page.url.pathname}?${params.toString()}`;

      void goto(newUrl, { replaceState: true, keepFocus: true, noScroll: true });
    }, 100);
  };

  /**
   * Collects palette colour overrides from active layers.
   *
   * Only colours that differ from LPC_DEFAULT_PALETTE are included
   * to keep the URL compact.
   */
  const _collectPaletteOverrides = (): Map<string, string> => {
    const overrides = new Map<string, string>();

    for (let i = 0; i < activeLayers.length; i++) {
      const layer = activeLayers[i];
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
  };

  // -----------------------------------------------------------------------
  // Animation ticker — requestAnimationFrame loop for Playback
  // -----------------------------------------------------------------------

  /**
   * Starts the animation playback ticker using requestAnimationFrame.
   *
   * Advances `animationFrame` at the configured `playbackFps` rate
   * with modulus wrapping at action boundaries (AC-2).
   */
  const _startPlayback = (): void => {
    if (animationTickRef !== undefined) {
      return; // Already running
    }

    _tickAccumulator = 0;
    let lastTimestamp = performance.now();

    const tick = (now: number): void => {
      if (!isPlaying) {
        animationTickRef = undefined;
        return;
      }

      const delta = now - lastTimestamp;
      lastTimestamp = now;

      const frameInterval = 1000 / playbackFps;
      _tickAccumulator += delta;

      while (_tickAccumulator >= frameInterval) {
        _tickAccumulator -= frameInterval;
        animationFrame = (animationFrame + 1) % (maxFrame + 1);
      }

      animationTickRef = requestAnimationFrame(tick);
    };

    animationTickRef = requestAnimationFrame(tick);
  };

  /**
   * Toggles the Play/Pause state for the animation ticker.
   * Starts/stops the requestAnimationFrame loop accordingly.
   */
  const togglePlayback = (): void => {
    isPlaying = !isPlaying;

    if (isPlaying) {
      _startPlayback();
    }
    // Stop is handled inside the tick loop via `!isPlaying` check
  };

  /**
   * Advances the animation frame by one step (wrap at maxFrame).
   * Only operates when playback is paused.
   */
  const stepNext = (): void => {
    if (isPlaying) {
      return;
    }
    animationFrame = (animationFrame + 1) % (maxFrame + 1);
  };

  /**
   * Decrements the animation frame by one step (wrap to maxFrame).
   * Only operates when playback is paused.
   */
  const stepPrev = (): void => {
    if (isPlaying) {
      return;
    }
    animationFrame = animationFrame === 0 ? maxFrame : animationFrame - 1;
  };

  // -----------------------------------------------------------------------
  // Status banner helpers
  // -----------------------------------------------------------------------

  const setStatus = (message: string, level: 'info' | 'warn' | 'error'): void => {
    statusBanner = { message, level };

    if (level === 'info') {
      setTimeout(() => {
        if (statusBanner?.message === message) {
          statusBanner = undefined;
        }
      }, 3000);
    }
  };

  const clearStatus = (): void => {
    statusBanner = undefined;
  };

  // -----------------------------------------------------------------------
  // Layer management
  // -----------------------------------------------------------------------

  const addLayer = (): void => {
    if (activeLayers.length >= MAX_LAYERS) {
      setStatus(`Maximum ${MAX_LAYERS} layers reached.`, 'warn');
      return;
    }

    const usedSlotKeys = new Set(
      activeLayers.map((l) => {
        const def = ALL_LPC_SLOTS[l.slotDefIndex];
        return def?.slot;
      }),
    );

    const unusedIndex = ALL_LPC_SLOTS.findIndex((s) => !usedSlotKeys.has(s.slot));
    const slotDefIndex =
      unusedIndex >= 0 ? unusedIndex : activeLayers.length % ALL_LPC_SLOTS.length;

    activeLayers = [
      ...activeLayers,
      {
        slotDefIndex,
        variantIndex: 0,
        palette: [...LPC_DEFAULT_PALETTE],
        selectedPaletteIndex: 0,
      },
    ];
  };

  const removeLayer = (index: number): void => {
    activeLayers = activeLayers.filter((_, i) => i !== index);
    // Reset isolate if the removed layer was the isolated one
    if (isolateLayerIndex === index) {
      isolateLayerIndex = -1;
    }
  };

  // -----------------------------------------------------------------------
  // Slot / variant selection
  // -----------------------------------------------------------------------

  const setSlotDef = (layerIndex: number, slotDefIndex: number): void => {
    activeLayers = activeLayers.map((layer, i) => {
      if (i !== layerIndex) {
        return layer;
      }
      return {
        ...layer,
        slotDefIndex,
        variantIndex: 0,
      };
    });
  };

  const setVariant = (layerIndex: number, variantIndex: number): void => {
    activeLayers = activeLayers.map((layer, i) => {
      if (i !== layerIndex) {
        return layer;
      }
      return {
        ...layer,
        variantIndex,
      };
    });
  };

  // -----------------------------------------------------------------------
  // Palette colour manipulation
  // -----------------------------------------------------------------------

  const setPaletteColor = (layerIndex: number, paletteIndex: number, hexColor: string): void => {
    activeLayers = activeLayers.map((layer, i) => {
      if (i !== layerIndex) {
        return layer;
      }
      const newPalette = [...layer.palette];
      newPalette[paletteIndex] = hexColor;
      return {
        ...layer,
        palette: newPalette,
        selectedPaletteIndex: paletteIndex,
      };
    });
  };

  const getPaletteHex = (layerIndex: number): string => {
    const layer = activeLayers[layerIndex];
    if (!layer) {
      return '000000';
    }
    return layer.palette[layer.selectedPaletteIndex] ?? '000000';
  };

  // -----------------------------------------------------------------------
  // Animation frame range
  // -----------------------------------------------------------------------

  const updateMaxFrame = (state: LpcAnimationState): void => {
    const frameCounts: Record<number, number> = {
      [LpcAnimationState.Spellcast]: 6,
      [LpcAnimationState.Thrust]: 7,
      [LpcAnimationState.Walk]: 8,
      [LpcAnimationState.Slash]: 5,
      [LpcAnimationState.Shoot]: 12,
      [LpcAnimationState.Die]: 5,
    };
    maxFrame = frameCounts[state] ?? 8;

    if (animationFrame > maxFrame) {
      animationFrame = 0;
    }
  };

  const setAnimationState = (state: LpcAnimationState): void => {
    animationState = state;
    updateMaxFrame(state);
  };

  // -----------------------------------------------------------------------
  // Grid overlay — draws 64×64 crosshair bounding boxes on the canvas
  // -----------------------------------------------------------------------

  /**
   * Draws or removes the 64×64 grid overlay diagnostic visualization.
   * Renders a crosshair bounding box centered on the entity position
   * with quarter-division markers at 16px intervals.
   */
  const _updateGridOverlay = (): void => {
    if (!pixiApp) {
      return;
    }

    // Remove existing grid overlay
    if (gridGraphics) {
      pixiApp.stage.removeChild(gridGraphics);
      gridGraphics.destroy();
      gridGraphics = undefined;
    }

    if (!showGridOverlay) {
      return;
    }

    const gfx = new Graphics();

    // Outer bounding box
    gfx.rect(0, 0, 64, 64);
    gfx.stroke({ color: 0x4444ff, width: 1, alpha: 0.6 });

    // Center crosshair
    gfx.moveTo(32, 0);
    gfx.lineTo(32, 64);
    gfx.moveTo(0, 32);
    gfx.lineTo(64, 32);
    gfx.stroke({ color: 0x4444ff, width: 1, alpha: 0.35 });

    // Quarter markers at 16px divisions
    gfx.moveTo(16, 0);
    gfx.lineTo(16, 64);
    gfx.moveTo(48, 0);
    gfx.lineTo(48, 64);
    gfx.moveTo(0, 16);
    gfx.lineTo(64, 16);
    gfx.moveTo(0, 48);
    gfx.lineTo(64, 48);
    gfx.stroke({ color: 0x4444ff, width: 1, alpha: 0.18 });

    gfx.x = ENTITY_X - 32;
    gfx.y = ENTITY_Y - 32;
    gfx.eventMode = 'none';

    pixiApp.stage.addChild(gfx);
    gridGraphics = gfx;
  };

  // -----------------------------------------------------------------------
  // Diagnostic overlay reactivity
  // -----------------------------------------------------------------------

  $effect(() => {
    void showGridOverlay;
    _updateGridOverlay();
  });

  // -----------------------------------------------------------------------
  // URL sync — push state changes to the address bar
  // -----------------------------------------------------------------------

  $effect(() => {
    // Read all URL-relevant state to register dependencies
    void activeLayers
      .map((l) => `${l.slotDefIndex}:${l.variantIndex}:${l.palette[l.selectedPaletteIndex]}`)
      .join(',');
    void animationState;
    void facingDirection;
    void animationFrame;
    void isPlaying;

    if (pixiApp && !_isApplyingUrlState) {
      _pushStateToUrl();
    }
  });

  // -----------------------------------------------------------------------
  // Visual rendering — Texture-based layer compositing (C-049)
  //
  // For each active layer, generates a procedural mock LPC spritesheet
  // (832×1344), extracts the 64×64 frame sub-texture matching the current
  // animation state + direction + frame, and stacks sprites in layer
  // priority order on the PixiJS stage.
  // -----------------------------------------------------------------------

  $effect(() => {
    const currentRecipes = recipes;
    const currentFrame = animationFrame;
    void animationState;
    void facingDirection;

    if (!pixiApp || currentRecipes.length === 0) {
      return;
    }

    // Clean up previous sprites
    _destroyAllSprites();

    try {
      const container = new Container();
      container.eventMode = 'none';

      for (let i = 0; i < currentRecipes.length; i++) {
        const recipe = currentRecipes[i];
        const layer = activeLayers[i];
        if (!recipe || !layer) {
          continue;
        }

        const slotDef = ALL_LPC_SLOTS[layer.slotDefIndex];
        const variant = slotDef?.variants[layer.variantIndex];
        if (!variant) {
          continue;
        }

        // Compute row-major frame index: row = getLpcStateRow(state, dir)
        // frameIndex = row * 13 + currentFrame
        const row = getLpcStateRow(animationState, facingDirection);
        const frameIndex = row * 13 + currentFrame;

        const frameTexture = _getMockFrameTexture(slotDef.slot, variant.shapeType, frameIndex);

        if (frameTexture === Texture.EMPTY) {
          continue;
        }

        const sprite = new Sprite(frameTexture);
        sprite.eventMode = 'none';
        sprite.alpha = slotDef.slot === 'body' ? 1.0 : 0.85;
        container.addChild(sprite);
        layerSprites.push(sprite);
      }

      container.x = ENTITY_X - 32;
      container.y = ENTITY_Y - 32;

      pixiApp.stage.addChild(container);
      characterContainer = container;
      compositionFailed = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('lpcDebugger.composeFailed', { error: message });

      const fallbackGfx = new Graphics();
      fallbackGfx.rect(0, 0, 64, 64);
      fallbackGfx.fill({ color: FALLBACK_COLOR, alpha: 0.9 });
      fallbackGfx.rect(0, 0, 64, 64);
      fallbackGfx.stroke({ color: 0xff0000, width: 2 });

      fallbackGfx.x = ENTITY_X - 32;
      fallbackGfx.y = ENTITY_Y - 32;
      fallbackGfx.eventMode = 'none';

      pixiApp.stage.addChild(fallbackGfx);
      characterContainer = undefined;
      layerSprites = [];
      compositionFailed = true;

      setStatus(`Composition failed: ${message} — fallback block shown.`, 'error');
    }
  });

  /**
   * Destroys all sprites in the character container and removes
   * the container from the stage.
   */
  const _destroyAllSprites = (): void => {
    for (const sprite of layerSprites) {
      sprite.destroy();
    }
    layerSprites = [];

    if (characterContainer) {
      if (characterContainer.parent) {
        characterContainer.parent.removeChild(characterContainer);
      }
      characterContainer.destroy({ children: true });
      characterContainer = undefined;
    }
  };

  // -----------------------------------------------------------------------
  // Test hooks — C-048 + C-049 lab state exposure
  // -----------------------------------------------------------------------

  $effect(() => {
    if (typeof window !== 'undefined') {
      const activeRecipeSnapshots = activeLayers.map((layer, i) => {
        const slotDef = ALL_LPC_SLOTS[layer.slotDefIndex];
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
      (window as unknown as Record<string, unknown>).__lpc_debug_active_recipes =
        activeRecipeSnapshots;
      (window as unknown as Record<string, unknown>).__lpc_active_instances =
        batchManager.activeInstances;
      (window as unknown as Record<string, unknown>).__lpc_structural_hashes =
        batchManager.structuralHashesIssued;

      // C-048 lab test hooks
      (window as unknown as Record<string, unknown>).__lpc_lab_play_state = isPlaying;
      (window as unknown as Record<string, unknown>).__lpc_lab_current_frame = animationFrame;
      (window as unknown as Record<string, unknown>).__lpc_lab_active_slots = activeLayers.map(
        (l) => {
          const def = ALL_LPC_SLOTS[l.slotDefIndex];
          return def?.slot ?? 'unknown';
        },
      );

      // C-049 test hooks
      (window as unknown as Record<string, unknown>).__lpc_workbench_active_layers =
        activeLayers.map((layer) => {
          const slotDef = ALL_LPC_SLOTS[layer.slotDefIndex];
          const variant = slotDef?.variants[layer.variantIndex];
          return {
            slot: slotDef?.slot ?? 'unknown',
            variant: variant?.label ?? '',
            shapeType: variant?.shapeType ?? 'default',
            assetId: variant?.assetId ?? '',
            paletteSize: layer.palette.length,
          };
        });
      (window as unknown as Record<string, unknown>).__lpc_workbench_mock_cache_size =
        _mockSheetCanvasCache.size;
    }
  });
</script>

<svelte:head>
  <title>LPC Layer Visual Debugger</title>
</svelte:head>

<div class="debug-workbench">
  <!-- Status Banner -->
  {#if statusBanner}
    <div
      class="status-banner"
      class:status-info={statusBanner.level === 'info'}
      class:status-warn={statusBanner.level === 'warn'}
      class:status-error={statusBanner.level === 'error'}
    >
      <span class="status-text">{statusBanner.message}</span>
      <button class="status-dismiss" onclick={clearStatus} aria-label="Dismiss notification">
        ✕
      </button>
    </div>
  {/if}

  <!-- ================================================================= -->
  <!-- LEFT PANEL — Viewport                                             -->
  <!-- ================================================================= -->
  <div class="viewport-panel">
    <canvas
      bind:this={canvasElement}
      class="debug-canvas"
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
    ></canvas>

    <!-- UBO data management (invisible) -->
    <div class="ubo-sink" aria-hidden="true">
      <LpcCharacterRenderer
        x={ENTITY_X}
        y={ENTITY_Y}
        state={animationState}
        direction={facingDirection}
        frame={animationFrame}
        {recipes}
        showSprites={false}
      />
    </div>

    {#if compositionFailed}
      <div class="fallback-overlay">
        ⚠️ Fallback rendering active — see status banner for details
      </div>
    {/if}
  </div>

  <!-- ================================================================= -->
  <!-- CENTER PANEL — Layer Assembly + Ticker + Palette                  -->
  <!-- ================================================================= -->
  <aside class="assembly-panel">
    <div class="panel-header">
      <h2 class="panel-title">Layer Assembly</h2>
      <span class="layer-count">{activeLayers.length} / {MAX_LAYERS} layers</span>
    </div>

    <!-- Animation Controls -->
    <fieldset class="control-section">
      <legend class="section-legend">Animation</legend>

      <div class="control-row">
        <label class="control-label">
          State
          <select
            class="control-select"
            value={animationState}
            onchange={(e: Event) => {
              const target = e.target as HTMLSelectElement;
              setAnimationState(Number.parseInt(target.value, 10) as LpcAnimationState);
            }}
          >
            {#each ANIMATION_STATE_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>

        <label class="control-label">
          Direction
          <select
            class="control-select"
            value={facingDirection}
            onchange={(e: Event) => {
              const target = e.target as HTMLSelectElement;
              facingDirection = Number.parseInt(target.value, 10) as LpcDirection;
            }}
          >
            {#each DIRECTION_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
      </div>

      <!-- Animation Playback Ticker Deck -->
      <fieldset class="ticker-controls">
        <legend class="ticker-legend">Playback Ticker</legend>

        <div class="ticker-row">
          <button
            class="btn btn-play"
            class:btn-pause={isPlaying}
            onclick={togglePlayback}
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>

          <button
            class="btn btn-step"
            onclick={stepPrev}
            disabled={isPlaying}
            aria-label="Step previous frame"
          >
            ◀ Prev
          </button>

          <button
            class="btn btn-step"
            onclick={stepNext}
            disabled={isPlaying}
            aria-label="Step next frame"
          >
            Next ▶
          </button>
        </div>

        <label class="control-label">
          Speed: {playbackFps} FPS
          <input type="range" class="slider" min="1" max="60" bind:value={playbackFps}>
        </label>

        <label class="control-label">
          Frame: {animationFrame} / {maxFrame}
          <input
            type="range"
            class="slider"
            min="0"
            bind:value={animationFrame}
            max={maxFrame}
            disabled={isPlaying}
          >
        </label>
      </fieldset>
    </fieldset>

    <!-- Diagnostic Overlays -->
    <fieldset class="control-section">
      <legend class="section-legend">Diagnostic Overlays</legend>

      <label class="control-checkbox">
        <input type="checkbox" bind:checked={showGridOverlay}>
        <span>Show Grid Layout (64×64)</span>
      </label>

      <label class="control-label">
        Isolate Layer
        <select
          class="control-select"
          value={isolateLayerIndex}
          onchange={(e: Event) => {
            const target = e.target as HTMLSelectElement;
            isolateLayerIndex = Number.parseInt(target.value, 10);
          }}
        >
          <option value={-1}>All Layers</option>
          {#each activeLayers as _, i}
            <option value={i}>Layer {i}</option>
          {/each}
        </select>
      </label>
    </fieldset>

    <!-- Layer Cards -->
    <div class="layer-list">
      {#each activeLayers as layer, i (i)}
        {@const slotDef = ALL_LPC_SLOTS[layer.slotDefIndex]}
        {@const variant = slotDef?.variants[layer.variantIndex]}
        {@const paletteHex = getPaletteHex(i)}
        {@const isIsolated = isolateLayerIndex >= 0 && i !== isolateLayerIndex}

        <div class="layer-card" class:layer-isolated={isIsolated}>
          <div class="layer-card-header">
            <span class="layer-index">Layer {i}</span>
            {#if isIsolated}
              <span class="layer-isolated-badge">hidden</span>
            {/if}
            <button
              class="btn btn-remove"
              onclick={() => removeLayer(i)}
              aria-label="Remove layer {i}"
              title="Remove layer"
            >
              ✕
            </button>
          </div>

          <label class="control-label">
            Slot
            <select
              class="control-select"
              value={layer.slotDefIndex}
              onchange={(e: Event) => {
                const target = e.target as HTMLSelectElement;
                setSlotDef(i, Number.parseInt(target.value, 10));
              }}
            >
              {#each ALL_LPC_SLOTS as slotOpt, sIdx}
                <option value={sIdx}>{slotOpt.label}</option>
              {/each}
            </select>
          </label>

          {#if slotDef}
            <label class="control-label">
              Variant
              <select
                class="control-select"
                value={layer.variantIndex}
                onchange={(e: Event) => {
                  const target = e.target as HTMLSelectElement;
                  setVariant(i, Number.parseInt(target.value, 10));
                }}
              >
                {#each slotDef.variants as varOpt, vIdx}
                  <option value={vIdx}>{varOpt.label}</option>
                {/each}
              </select>
            </label>
          {/if}

          <!-- Palette colour picker -->
          <div class="palette-section">
            <label class="control-label">
              Palette Index: {layer.selectedPaletteIndex}
              <input
                type="range"
                class="slider"
                min="0"
                max={PALETTE_SIZE - 1}
                value={layer.selectedPaletteIndex}
                oninput={(e: Event) => {
                  const target = e.target as HTMLInputElement;
                  const idx = Number.parseInt(target.value, 10);
                  activeLayers = activeLayers.map((l, li) =>
                    li === i ? { ...l, selectedPaletteIndex: idx } : l,
                  );
                }}
              >
            </label>

            <div class="color-picker-row">
              <input
                type="color"
                class="color-input"
                value="#{paletteHex}"
                oninput={(e: Event) => {
                  const target = e.target as HTMLInputElement;
                  const hex = target.value.replace('#', '');
                  setPaletteColor(i, layer.selectedPaletteIndex, hex);
                }}
              >
              <code class="color-hex">#{paletteHex}</code>
            </div>

            <!-- Palette swatch strip (first 16 entries) -->
            <div class="palette-strip">
              {#each layer.palette.slice(0, PALETTE_DISPLAY_COUNT) as color, pIdx}
                <button
                  class="palette-swatch"
                  class:palette-swatch-active={pIdx === layer.selectedPaletteIndex}
                  style="background-color: #{color}"
                  onclick={() =>
                    (activeLayers = activeLayers.map((l, li) =>
                      li === i ? { ...l, selectedPaletteIndex: pIdx } : l,
                    ))}
                  title="Index {pIdx}: #{color}"
                  aria-label="Select palette index {pIdx}"
                ></button>
              {/each}
            </div>
          </div>
        </div>
      {/each}
    </div>

    <button class="btn btn-add" onclick={addLayer} disabled={activeLayers.length >= MAX_LAYERS}>
      + Add Layer
    </button>
  </aside>

  <!-- ================================================================= -->
  <!-- RIGHT PANEL — Telemetry                                            -->
  <!-- ================================================================= -->
  <aside class="telemetry-panel">
    <h2 class="panel-title">Runtime Telemetry</h2>

    <div class="metric-card">
      <div class="metric-row">
        <span class="metric-label">FPS</span>
        <span class="metric-value" class:metric-warn={fps < 30} class:metric-danger={fps < 15}>
          {fps.toFixed(1)}
        </span>
      </div>

      <div class="metric-row">
        <span class="metric-label">Frame Duration</span>
        <span class="metric-value">{frameDurationMs.toFixed(2)} ms</span>
      </div>

      <div class="metric-row">
        <span class="metric-label">Frame Budget</span>
        <span
          class="metric-value"
          class:metric-warn={Number.parseFloat(frameBudgetPercent) > 80}
          class:metric-danger={Number.parseFloat(frameBudgetPercent) > 95}
        >
          {frameBudgetPercent}%
        </span>
      </div>

      <div class="metric-row">
        <span class="metric-label">Total Frames</span>
        <span class="metric-value">{totalFrames}</span>
      </div>
    </div>

    <hr class="metric-divider">

    <div class="metric-card">
      <div class="metric-row">
        <span class="metric-label">Active Instances</span>
        <span class="metric-value">{activeInstances} / {poolSize}</span>
      </div>

      <div class="metric-row">
        <span class="metric-label">Pool Utilization</span>
        <span class="metric-value">
          {poolSize > 0 ? ((activeInstances / poolSize) * 100).toFixed(1) : '0.0'}%
        </span>
      </div>
    </div>

    <hr class="metric-divider">

    <div class="metric-card">
      <div class="metric-header">Pipeline Counters</div>

      <div class="metric-row">
        <span class="metric-label">Structural Hashes</span>
        <span class="metric-value">{structuralHashes}</span>
      </div>

      <div class="metric-row">
        <span class="metric-label">Batch Updates</span>
        <span class="metric-value">{batchUpdates}</span>
      </div>

      <div class="metric-row">
        <span class="metric-label">Ticker Frame</span>
        <span class="metric-value">{tickerFrame}</span>
      </div>
    </div>

    <hr class="metric-divider">

    <div class="metric-card">
      <div class="metric-header">Animation State</div>

      <div class="metric-row">
        <span class="metric-label">State</span>
        <span class="metric-value">{LpcAnimationState[animationState]}</span>
      </div>

      <div class="metric-row">
        <span class="metric-label">Direction</span>
        <span class="metric-value">{LpcDirection[facingDirection]}</span>
      </div>

      <div class="metric-row">
        <span class="metric-label">Frame</span>
        <span class="metric-value">{animationFrame} / {maxFrame}</span>
      </div>

      <div class="metric-row">
        <span class="metric-label">Playback</span>
        <span class="metric-value" class:metric-warn={isPlaying}>
          {isPlaying ? `▶ ${playbackFps} FPS` : '⏸ Paused'}
        </span>
      </div>
    </div>

    <hr class="metric-divider">

    {#if isolateLayerIndex >= 0}
      <div class="metric-card">
        <div class="metric-header">Isolate Layer Active</div>
        <div class="metric-row">
          <span class="metric-value">Only showing Layer {isolateLayerIndex}</span>
        </div>
      </div>
      <hr class="metric-divider">
    {/if}

    {#if compositionFailed}
      <div
        class="metric-card"
        style="background: rgba(255, 0, 0, 0.1); border-radius: 4px; padding: 0.5rem;"
      >
        <div class="metric-header" style="color: #ff6666;">⚠️ Composition Failed</div>
        <div class="metric-row">
          <span class="metric-label" style="color: #ff8888;">
            Fallback render block active. Check console for details.
          </span>
        </div>
      </div>
    {/if}
  </aside>
</div>

<style>
  /* ================================================================== */
  /* Layout                                                              */
  /* ================================================================== */

  .debug-workbench {
    display: grid;
    grid-template-columns: 1fr 360px 260px;
    grid-template-rows: auto 1fr;
    height: calc(100vh - 4rem);
    gap: 0;
    background: #0a0a14;
    color: #d0d0e0;
    font-family: "Inter", system-ui, sans-serif;
    position: relative;
  }

  /* ================================================================== */
  /* Status Banner                                                       */
  /* ================================================================== */

  .status-banner {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    border-bottom: 1px solid transparent;
    z-index: 20;
  }

  .status-info {
    background: #1a2a44;
    border-color: #4488cc;
    color: #88bbff;
  }

  .status-warn {
    background: #3a2a14;
    border-color: #cc8844;
    color: #ffcc88;
  }

  .status-error {
    background: #441a1a;
    border-color: #cc4444;
    color: #ff8888;
  }

  .status-text {
    flex: 1;
  }

  .status-dismiss {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0 0.25rem;
    opacity: 0.7;
  }
  .status-dismiss:hover {
    opacity: 1;
  }

  /* ================================================================== */
  /* Viewport Panel                                                      */
  /* ================================================================== */

  .viewport-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d0d1a;
    border-right: 1px solid #1a1a2e;
    position: relative;
    overflow: hidden;
  }

  .debug-canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    border-radius: 2px;
  }

  .ubo-sink {
    position: absolute;
    pointer-events: none;
    opacity: 0;
    width: 0;
    height: 0;
    overflow: hidden;
  }

  .fallback-overlay {
    position: absolute;
    bottom: 0.5rem;
    left: 0.5rem;
    right: 0.5rem;
    background: rgba(255, 0, 0, 0.2);
    border: 1px solid #ff4444;
    color: #ff6666;
    padding: 0.3rem 0.75rem;
    border-radius: 4px;
    font-size: 0.72rem;
    text-align: center;
    z-index: 10;
  }

  /* ================================================================== */
  /* Assembly Panel (Center)                                             */
  /* ================================================================== */

  .assembly-panel {
    background: #0e0e1c;
    border-right: 1px solid #1a1a2e;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #1a1a2e;
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: #8888cc;
    margin: 0;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .layer-count {
    font-size: 0.72rem;
    color: #666688;
    font-variant-numeric: tabular-nums;
  }

  .control-section {
    border: none;
    border-bottom: 1px solid #1a1a2e;
    padding: 0.75rem 1rem;
    margin: 0;
    flex-shrink: 0;
  }

  .section-legend {
    font-size: 0.75rem;
    font-weight: 600;
    color: #6666aa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0;
    margin-bottom: 0.5rem;
  }

  .control-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .control-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.72rem;
    color: #8888aa;
    margin-bottom: 0.5rem;
  }

  .control-row .control-label {
    flex: 1;
    min-width: 0;
  }

  .control-select {
    background: #111122;
    border: 1px solid #2a2a3e;
    border-radius: 4px;
    color: #ccccdd;
    padding: 0.3rem 0.5rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    width: 100%;
  }
  .control-select:focus {
    outline: none;
    border-color: #5555aa;
  }

  .control-checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
    color: #aaaacc;
    margin-bottom: 0.5rem;
    cursor: pointer;
  }
  .control-checkbox input[type="checkbox"] {
    accent-color: #6666cc;
    width: 14px;
    height: 14px;
  }

  .slider {
    width: 100%;
    accent-color: #6666cc;
    margin-top: 0.25rem;
  }
  .slider:disabled {
    opacity: 0.4;
  }

  /* ================================================================== */
  /* Playback Ticker Deck                                                */
  /* ================================================================== */

  .ticker-controls {
    border: 1px solid #1a1a2e;
    border-radius: 6px;
    padding: 0.6rem;
    margin-top: 0.3rem;
    background: #0a0a18;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .ticker-legend {
    font-size: 0.7rem;
    font-weight: 600;
    color: #5555aa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0;
  }

  .ticker-row {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }

  .btn-play {
    background: #1a2a1a;
    color: #66cc66;
    border-color: #2a4a2a;
    flex: 1;
  }
  .btn-play:hover {
    background: #224422;
    border-color: #44aa44;
  }

  .btn-pause {
    background: #3a2a14;
    color: #ffcc66;
    border-color: #554422;
  }
  .btn-pause:hover {
    background: #4a3a1a;
    border-color: #886622;
  }

  .btn-step {
    background: #1a1a2e;
    color: #8888cc;
    border-color: #2a2a4a;
    flex: 1;
  }
  .btn-step:hover:not(:disabled) {
    background: #222255;
    border-color: #5555aa;
  }
  .btn-step:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* Layer cards */

  .layer-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .layer-card {
    background: #111122;
    border: 1px solid #1a1a2e;
    border-radius: 6px;
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .layer-isolated {
    opacity: 0.4;
    border-color: #2a1a1a;
  }

  .layer-isolated-badge {
    font-size: 0.62rem;
    color: #cc4444;
    font-weight: 600;
    text-transform: uppercase;
    padding: 0.05rem 0.3rem;
    background: rgba(255, 0, 0, 0.1);
    border-radius: 3px;
  }

  .layer-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .layer-index {
    font-size: 0.7rem;
    font-weight: 600;
    color: #6666aa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Palette section */

  .palette-section {
    border-top: 1px solid #1a1a2e;
    padding-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .color-picker-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .color-input {
    width: 32px;
    height: 24px;
    border: 1px solid #2a2a3e;
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
    background: none;
  }
  .color-input:focus {
    outline: none;
    border-color: #5555aa;
  }

  .color-hex {
    font-size: 0.78rem;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    color: #aaaacc;
    background: #1a1a2e;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }

  .palette-strip {
    display: flex;
    gap: 1px;
    flex-wrap: wrap;
  }

  .palette-swatch {
    width: 18px;
    height: 18px;
    border: 1px solid #2a2a3e;
    border-radius: 2px;
    padding: 0;
    cursor: pointer;
    transition: border-color 0.1s;
  }
  .palette-swatch:hover {
    border-color: #8888cc;
    transform: scale(1.15);
  }
  .palette-swatch-active {
    border-color: #ffffff;
    box-shadow: 0 0 4px rgba(136, 136, 204, 0.6);
  }

  /* Buttons */

  .btn {
    padding: 0.4rem 0.75rem;
    border: 1px solid transparent;
    border-radius: 5px;
    font-size: 0.76rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s;
    text-align: center;
    font-family: inherit;
  }

  .btn-add {
    background: #1a1a3a;
    color: #8888cc;
    border-color: #2a2a4a;
    margin: 0.5rem 1rem 1rem;
    flex-shrink: 0;
  }
  .btn-add:hover:not(:disabled) {
    background: #222255;
    border-color: #5555aa;
  }
  .btn-add:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-remove {
    background: none;
    border: 1px solid transparent;
    color: #666688;
    cursor: pointer;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    font-size: 0.7rem;
    line-height: 1;
  }
  .btn-remove:hover {
    background: #332222;
    border-color: #553333;
    color: #ff6666;
  }

  /* ================================================================== */
  /* Telemetry Panel (Right)                                             */
  /* ================================================================== */

  .telemetry-panel {
    background: #0e0e1c;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .telemetry-panel .panel-title {
    margin-bottom: 0.5rem;
  }

  .metric-card {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .metric-header {
    font-size: 0.68rem;
    font-weight: 600;
    color: #666688;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding-bottom: 0.2rem;
  }

  .metric-divider {
    border: none;
    border-top: 1px solid #1a1a2e;
    margin: 0.5rem 0;
  }

  .metric-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.15rem 0;
  }

  .metric-label {
    font-size: 0.72rem;
    color: #7777aa;
  }

  .metric-value {
    font-size: 0.78rem;
    font-weight: 600;
    color: #ccccff;
    font-variant-numeric: tabular-nums;
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }

  .metric-warn {
    color: #ffaa44;
  }

  .metric-danger {
    color: #ff4444;
  }

  /* ================================================================== */
  /* Scrollbar styling                                                   */
  /* ================================================================== */

  .assembly-panel::-webkit-scrollbar,
  .telemetry-panel::-webkit-scrollbar,
  .layer-list::-webkit-scrollbar {
    width: 5px;
  }

  .assembly-panel::-webkit-scrollbar-track,
  .telemetry-panel::-webkit-scrollbar-track,
  .layer-list::-webkit-scrollbar-track {
    background: #0a0a14;
  }

  .assembly-panel::-webkit-scrollbar-thumb,
  .telemetry-panel::-webkit-scrollbar-thumb,
  .layer-list::-webkit-scrollbar-thumb {
    background: #2a2a3e;
    border-radius: 3px;
  }
</style>
