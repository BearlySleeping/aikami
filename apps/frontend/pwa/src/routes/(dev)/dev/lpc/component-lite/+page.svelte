<script lang="ts">
  // apps/frontend/pwa/src/routes/(dev)/dev/lpc/component-lite/+page.svelte
  // LPC Component Lite — isolated character renderer for visual testing.
  // Zero UI chrome. Reads configuration entirely from URL search params.
  //
  // URL params:
  //   l<N>=<slotDefIndex>:<variantIndex>  — layer config
  //   p<N>:<paletteIndex>=<hex>           — palette override
  //   state=<number>                       — LpcAnimationState
  //   dir=<number>                         — LpcDirection
  //   frame=<number>                       — animation frame
  //   zoom=<number>                        — canvas scale (default 1)
  //
  // Exposes window.__PIXI_LOADED__ for Playwright to await rendering.

  import {
    createPixiApp,
    getLpcStateRow,
    LpcAnimationState,
    LpcBatchManager,
    LpcDirection,
    TextureManager,
  } from '@aikami/frontend/engine';
  import type { Application } from 'pixi.js';
  import { Container, Graphics, Sprite, Texture } from 'pixi.js';
  import { onMount, setContext } from 'svelte';
  import { page } from '$app/stores';
  import {
    LPC_BATCH_MANAGER_KEY,
    LPC_STAGE_CONTAINER_KEY,
  } from '$lib/components/game/lpc_context_keys.ts';
  import type { LpcMockShapeType } from '$lib/data/lpc_asset_catalog';
  import {
    ALL_LPC_SLOTS,
    hexToPixiTint,
    LPC_DEFAULT_PALETTE,
    LPC_LAYER_Z_INDEX,
    LPC_SLOT_PALETTE_INDEX,
  } from '$lib/data/lpc_asset_catalog';
  import { generateMockLpcSheet, LPC_MOCK_LAYOUT } from '$lib/data/lpc_asset_path_mapper';
  import { type LpcUrlState, searchParamsToLpcState } from '$lib/data/lpc_url_config';
  import { logger } from '$logger';

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  const CANVAS_BASE_WIDTH = 960;
  const CANVAS_BASE_HEIGHT = 540;
  const ENTITY_X = CANVAS_BASE_WIDTH / 2;
  const ENTITY_Y = CANVAS_BASE_HEIGHT / 2 - 32;
  const LPC_LAYOUT = { frameWidth: 64, frameHeight: 64, columns: 13 } as const;

  // -----------------------------------------------------------------------
  // URL-derived config
  // -----------------------------------------------------------------------

  const urlConfig = $derived(searchParamsToLpcState($page.url.searchParams));

  $effect(() => {
    logger.debug('lpcLite.urlConfig', {
      layers: urlConfig.layers.length,
      state: urlConfig.state,
      direction: urlConfig.direction,
      frame: urlConfig.frame,
      zoom: urlConfig.zoom,
      paletteOverrides: urlConfig.paletteOverrides.size,
    });
  });

  const zoom = $derived(urlConfig.zoom);

  // -----------------------------------------------------------------------
  // Canvas dimensions (scale with zoom)
  // -----------------------------------------------------------------------

  const canvasWidth = $derived(Math.round(CANVAS_BASE_WIDTH * zoom));
  const canvasHeight = $derived(Math.round(CANVAS_BASE_HEIGHT * zoom));

  $effect(() => {
    logger.debug('lpcLite.canvasSize', {
      zoom,
      canvasWidth,
      canvasHeight,
    });
  });

  // -----------------------------------------------------------------------
  // Active layers derived from URL config
  // -----------------------------------------------------------------------

  type ActiveLayerEntry = {
    slotDefIndex: number;
    variantIndex: number;
    palette: string[];
  };

  const activeLayers = $derived.by((): ActiveLayerEntry[] => {
    const result = urlConfig.layers.map((entry, layerIndex) => {
      const palette = [...LPC_DEFAULT_PALETTE];

      for (const [key, hex] of urlConfig.paletteOverrides) {
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
      };
    });

    logger.debug('lpcLite.activeLayers', {
      count: result.length,
      slots: result.map((l) => {
        const def = ALL_LPC_SLOTS[l.slotDefIndex];
        return def?.slot ?? 'unknown';
      }),
    });

    return result;
  });

  // -----------------------------------------------------------------------
  // Batch manager + stage container
  // -----------------------------------------------------------------------

  logger.debug('lpcLite.createBatchManager', { maxInstances: 8 });

  const batchManager = new LpcBatchManager({ maxInstances: 8 });
  setContext(LPC_BATCH_MANAGER_KEY, batchManager);

  const textureManager = new TextureManager({
    loadTexture: async (_key: number): Promise<Texture> => {
      return Texture.WHITE;
    },
  });

  const _mockSheetTextureCache = new Map<string, Texture>();
  const _frameTextureCache = new Map<string, Texture>();

  const _getMockSheetTexture = (slot: string, shapeType: LpcMockShapeType): Texture => {
    const cacheKey = `${slot}:${shapeType}`;
    const cached = _mockSheetTextureCache.get(cacheKey);
    if (cached) {
      logger.debug('lpcLite.mockSheetTexture.cacheHit', { slot, shapeType });
      return cached;
    }

    logger.debug('lpcLite.mockSheetTexture.generate', { slot, shapeType });

    const canvas = generateMockLpcSheet(slot, shapeType);
    if (!canvas) {
      logger.warn('lpcLite.mockSheetTexture.generateFailed', { slot, shapeType });
      return Texture.EMPTY;
    }

    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    _mockSheetTextureCache.set(cacheKey, texture);

    logger.debug('lpcLite.mockSheetTexture.generated', {
      slot,
      shapeType,
      cacheSize: _mockSheetTextureCache.size,
    });

    return texture;
  };

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
      logger.warn('lpcLite.mockFrameTexture.emptySheet', { slot, shapeType, frameIndex });
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

    logger.warn('lpcLite.mockFrameTexture.noFrame', { slot, shapeType, frameIndex });
    return Texture.EMPTY;
  };

  const stageContainer = new Container();
  stageContainer.label = 'lpc-character-stage';
  setContext(LPC_STAGE_CONTAINER_KEY, stageContainer);

  // -----------------------------------------------------------------------
  // Canvas + App refs
  // -----------------------------------------------------------------------

  let canvasElement: HTMLCanvasElement | undefined = $state();
  let pixiApp: Application | undefined = $state();
  /** Non-reactive — mutated in render $effect, read in destroy/cleanup only. */
  let characterContainer: Container | undefined;
  let layerSprites: Sprite[] = [];

  // -----------------------------------------------------------------------
  // Initialize PixiJS
  // -----------------------------------------------------------------------

  onMount(() => {
    logger.debug('lpcLite.onMount.start', {
      hasCanvas: !!canvasElement,
      canvasWidth,
      canvasHeight,
      zoom,
    });

    if (!canvasElement) {
      logger.error('lpcLite.noCanvas');
      return;
    }

    const initApp = async (): Promise<void> => {
      try {
        logger.debug('lpcLite.createPixiApp.start', {
          width: canvasWidth,
          height: canvasHeight,
        });

        const result = await createPixiApp({
          canvas: canvasElement!,
          width: canvasWidth,
          height: canvasHeight,
          backgroundColor: 0x0d0d1a,
        });

        pixiApp = result.app;

        logger.debug('lpcLite.pixiApp.created', {
          width: pixiApp.renderer.width,
          height: pixiApp.renderer.height,
          rendererType: pixiApp.renderer.type,
          fps: result.debug.fps,
        });

        pixiApp.stage.addChild(stageContainer);

        logger.debug('lpcLite.stageContainer.added', {
          stageChildren: pixiApp.stage.children.length,
        });

        // Listen for WebGL context loss
        const canvas = pixiApp.renderer.canvas as HTMLCanvasElement;
        canvas.addEventListener('webglcontextlost', (event: Event) => {
          logger.error('lpcLite.webglContextLost', { event: String(event) });
        });
        canvas.addEventListener('webglcontextrestored', () => {
          logger.warn('lpcLite.webglContextRestored');
        });

        logger.debug('lpcLite.initialized', { zoom, layers: activeLayers.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('lpcLite.initFailed', {
          error: message,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    };

    void initApp();

    // Cleanup: destroy PixiJS app on unmount to release WebGL context
    return () => {
      logger.debug('lpcLite.unmount.cleanup', {
        hasApp: !!pixiApp,
        hasContainer: !!characterContainer,
        spriteCount: layerSprites.length,
        sheetCacheSize: _mockSheetTextureCache.size,
        frameCacheSize: _frameTextureCache.size,
      });

      _destroyAllSprites();

      _mockSheetTextureCache.clear();
      _frameTextureCache.clear();

      if (stageContainer.parent) {
        stageContainer.parent.removeChild(stageContainer);
      }
      stageContainer.destroy({ children: true });

      if (pixiApp) {
        pixiApp.destroy(true, { children: true });
        pixiApp = undefined;
      }
    };
  });

  // -----------------------------------------------------------------------
  // Render character from URL config
  // -----------------------------------------------------------------------

  $effect(() => {
    const currentLayers = activeLayers;
    const currentFrame = urlConfig.frame;
    const currentState = urlConfig.state;
    const currentDirection = urlConfig.direction;
    const currentZoom = zoom;

    logger.debug('lpcLite.render.trigger', {
      layers: currentLayers.length,
      frame: currentFrame,
      state: currentState,
      direction: currentDirection,
      zoom: currentZoom,
      hasApp: !!pixiApp,
    });

    if (!pixiApp) {
      logger.warn('lpcLite.render.noApp');
      return;
    }

    if (currentLayers.length === 0) {
      logger.warn('lpcLite.render.noLayers');
      return;
    }

    // Clean up previous sprites
    _destroyAllSprites();

    const row = getLpcStateRow(currentState, currentDirection);
    const frameIndex = row * LPC_LAYOUT.columns + currentFrame;

    logger.debug('lpcLite.render.frameGrid', {
      state: currentState,
      direction: currentDirection,
      row,
      frame: currentFrame,
      frameIndex,
    });

    try {
      const container = new Container();
      container.eventMode = 'none';
      container.sortableChildren = true;

      let spriteCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < currentLayers.length; i++) {
        const layer = currentLayers[i];
        if (!layer) {
          skippedCount += 1;
          continue;
        }

        const slotDef = ALL_LPC_SLOTS[layer.slotDefIndex];
        const variant = slotDef?.variants[layer.variantIndex];
        if (!variant) {
          logger.warn('lpcLite.render.noVariant', {
            i,
            slotDefIndex: layer.slotDefIndex,
            variantIndex: layer.variantIndex,
          });
          skippedCount += 1;
          continue;
        }

        const frameTexture = _getMockFrameTexture(slotDef.slot, variant.shapeType, frameIndex);
        if (frameTexture === Texture.EMPTY) {
          logger.warn('lpcLite.render.emptyTexture', {
            i,
            slot: slotDef.slot,
            shapeType: variant.shapeType,
            frameIndex,
          });
          skippedCount += 1;
          continue;
        }

        const sprite = new Sprite(frameTexture);
        sprite.eventMode = 'none';
        sprite.x = -32;
        sprite.y = -32;
        sprite.alpha = slotDef.slot === 'body' ? 1.0 : 0.85;

        const zIndex = LPC_LAYER_Z_INDEX[slotDef.slot];
        if (zIndex !== undefined) {
          sprite.zIndex = zIndex;
        }

        const paletteIndex = LPC_SLOT_PALETTE_INDEX[slotDef.slot] ?? 0;
        const hexColor = layer.palette[paletteIndex];
        sprite.tint = hexToPixiTint(hexColor);

        container.addChild(sprite);
        layerSprites.push(sprite);
        spriteCount += 1;
      }

      logger.debug('lpcLite.render.composed', {
        totalRecipes: currentLayers.length,
        spritesCreated: spriteCount,
        spritesSkipped: skippedCount,
        containerChildren: container.children.length,
        zoom: currentZoom,
        containerX: canvasWidth / 2,
        containerY: canvasHeight / 2,
      });

      container.scale.set(currentZoom, currentZoom);
      container.x = canvasWidth / 2;
      container.y = canvasHeight / 2;

      pixiApp.stage.addChild(container);
      characterContainer = container;

      logger.debug('lpcLite.render.complete', {
        stageChildren: pixiApp.stage.children.length,
        canvasWidth,
        canvasHeight,
        zoom: currentZoom,
      });

      if (typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>).__PIXI_LOADED__ = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('lpcLite.composeFailed', {
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
        zoom: currentZoom,
        layers: currentLayers.length,
      });

      const fallbackGfx = new Graphics();
      fallbackGfx.rect(0, 0, 64, 64);
      fallbackGfx.fill({ color: 0xff00ff, alpha: 0.9 });
      fallbackGfx.rect(0, 0, 64, 64);
      fallbackGfx.stroke({ color: 0xff0000, width: 2 });
      fallbackGfx.x = canvasWidth / 2 - 32 * zoom;
      fallbackGfx.y = canvasHeight / 2 - 32 * zoom;
      fallbackGfx.eventMode = 'none';

      pixiApp.stage.addChild(fallbackGfx);
      characterContainer = undefined;
      layerSprites = [];
    }
  });

  const _destroyAllSprites = (): void => {
    logger.debug('lpcLite.destroySprites', { count: layerSprites.length });

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
</script>

<svelte:head>
  <title>LPC Component Lite</title>
  <meta name="robots" content="noindex,nofollow">
</svelte:head>

<div class="lite-viewport">
  <canvas
    bind:this={canvasElement}
    class="lite-canvas"
    width={canvasWidth}
    height={canvasHeight}
  ></canvas>
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    background: #0d0d1a;
    overflow: hidden;
  }

  .lite-viewport {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100vw;
    height: 100vh;
    background: #0d0d1a;
    overflow: hidden;
  }

  .lite-canvas {
    display: block;
    image-rendering: pixelated;
  }
</style>
