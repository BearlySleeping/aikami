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
  // apps/frontend/pwa/src/routes/(dev)/dev/lpc/component-lite/+page.svelte
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
    buildPaletteBuffer,
    LPC_DEFAULT_PALETTE,
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
  const zoom = $derived(urlConfig.zoom);

  // -----------------------------------------------------------------------
  // Canvas dimensions (scale with zoom)
  // -----------------------------------------------------------------------

  const canvasWidth = $derived(Math.round(CANVAS_BASE_WIDTH * zoom));
  const canvasHeight = $derived(Math.round(CANVAS_BASE_HEIGHT * zoom));

  // -----------------------------------------------------------------------
  // Active layers derived from URL config
  // -----------------------------------------------------------------------

  type ActiveLayerEntry = {
    slotDefIndex: number;
    variantIndex: number;
    palette: string[];
  };

  const activeLayers = $derived.by((): ActiveLayerEntry[] => {
    return urlConfig.layers.map((entry, layerIndex) => {
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
  });

  // -----------------------------------------------------------------------
  // Batch manager + stage container
  // -----------------------------------------------------------------------

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
      return cached;
    }

    const canvas = generateMockLpcSheet(slot, shapeType);
    if (!canvas) {
      return Texture.EMPTY;
    }

    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    _mockSheetTextureCache.set(cacheKey, texture);
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

  const stageContainer = new Container();
  stageContainer.label = 'lpc-character-stage';
  setContext(LPC_STAGE_CONTAINER_KEY, stageContainer);

  // -----------------------------------------------------------------------
  // Canvas + App refs
  // -----------------------------------------------------------------------

  let canvasElement: HTMLCanvasElement | undefined = $state();
  let pixiApp: Application | undefined;
  let characterContainer: Container | undefined;
  let layerSprites: Sprite[] = [];

  // -----------------------------------------------------------------------
  // PixiJS loaded flag for Playwright
  // -----------------------------------------------------------------------

  $effect(() => {
    if (pixiApp && characterContainer && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__PIXI_LOADED__ = true;
    }
  });

  // -----------------------------------------------------------------------
  // Initialize PixiJS
  // -----------------------------------------------------------------------

  onMount(async () => {
    if (!canvasElement) {
      logger.error('lpcLite.noCanvas');
      return;
    }

    try {
      const result = await createPixiApp({
        canvas: canvasElement,
        width: canvasWidth,
        height: canvasHeight,
        backgroundColor: 0x0d0d1a,
      });

      pixiApp = result.app;
      pixiApp.stage.addChild(stageContainer);

      logger.debug('lpcLite.initialized', { zoom, layers: activeLayers.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('lpcLite.initFailed', { error: message });
    }
  });

  // -----------------------------------------------------------------------
  // Render character from URL config
  // -----------------------------------------------------------------------

  $effect(() => {
    const currentLayers = activeLayers;
    const currentFrame = urlConfig.frame;
    const currentState = urlConfig.state;
    const currentDirection = urlConfig.direction;

    if (!pixiApp || currentLayers.length === 0) {
      return;
    }

    // Clean up previous sprites
    _destroyAllSprites();

    const row = getLpcStateRow(currentState, currentDirection);
    const frameIndex = row * LPC_LAYOUT.columns + currentFrame;

    try {
      const container = new Container();
      container.eventMode = 'none';

      for (let i = 0; i < currentLayers.length; i++) {
        const layer = currentLayers[i];
        if (!layer) {
          continue;
        }

        const slotDef = ALL_LPC_SLOTS[layer.slotDefIndex];
        const variant = slotDef?.variants[layer.variantIndex];
        if (!variant) {
          continue;
        }

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

      // Apply zoom scaling at container level
      container.scale.set(zoom, zoom);
      container.x = ENTITY_X * zoom - 32 * zoom;
      container.y = ENTITY_Y * zoom - 32 * zoom;

      pixiApp.stage.addChild(container);
      characterContainer = container;

      // Signal PixiJS loaded for Playwright
      if (typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>).__PIXI_LOADED__ = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('lpcLite.composeFailed', { error: message });

      const fallbackGfx = new Graphics();
      fallbackGfx.rect(0, 0, 64, 64);
      fallbackGfx.fill({ color: 0xff00ff, alpha: 0.9 });
      fallbackGfx.rect(0, 0, 64, 64);
      fallbackGfx.stroke({ color: 0xff0000, width: 2 });
      fallbackGfx.x = ENTITY_X * zoom - 32 * zoom;
      fallbackGfx.y = ENTITY_Y * zoom - 32 * zoom;
      fallbackGfx.eventMode = 'none';

      pixiApp.stage.addChild(fallbackGfx);
      characterContainer = undefined;
      layerSprites = [];
    }
  });

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
  /* Zero-chrome full-viewport canvas */
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
