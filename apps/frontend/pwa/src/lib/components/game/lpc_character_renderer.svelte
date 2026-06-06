<script lang="ts">
  import type { LpcLayerRecipe } from '@aikami/frontend/engine';
  import {
    getLpcStateRow,
    LpcAnimationState,
    type LpcBatchManager,
    LpcDirection,
    TextureManager,
  } from '@aikami/frontend/engine';
  // apps/frontend/pwa/src/lib/components/game/lpc_character_renderer.svelte
  import { Container, Sprite, Texture } from 'pixi.js';
  import { getContext, onMount } from 'svelte';
  import {
    createMockSheetTexture,
    createPlaceholderTexture,
    getLpcAssetPath,
  } from '$lib/data/lpc_asset_path_mapper.ts';
  import { logger } from '$logger';
  import { LPC_BATCH_MANAGER_KEY, LPC_STAGE_CONTAINER_KEY } from './lpc_context_keys.ts';

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  /** Standard LPC spritesheet grid layout. */
  const LPC_LAYOUT = { frameWidth: 64, frameHeight: 64, columns: 13 } as const;

  /** Entity ID generator — monotonic counter to avoid bitECS collisions. */
  let _nextEid = 0x1000;

  // -----------------------------------------------------------------------
  // Component props
  // -----------------------------------------------------------------------

  const {
    x = 0,
    y = 0,
    state: animationState = LpcAnimationState.Walk,
    direction: facing = LpcDirection.Down,
    frame = 0,
    recipes = [] as readonly LpcLayerRecipe[],
    width = 64,
    height = 64,
    /** Enable TextureManager-based sprite rendering. When false, only UBO
     * data management runs (passive / sink mode for shader pipelines). */
    showSprites = false,
  }: {
    x?: number;
    y?: number;
    state?: LpcAnimationState;
    direction?: LpcDirection;
    frame?: number;
    recipes?: readonly LpcLayerRecipe[];
    width?: number;
    height?: number;
    showSprites?: boolean;
  } = $props();

  // -----------------------------------------------------------------------
  // Context resolution — guarded for SSR safety
  // -----------------------------------------------------------------------

  const batchManager = getContext<LpcBatchManager>(LPC_BATCH_MANAGER_KEY);
  const stageContainer = getContext<Container>(LPC_STAGE_CONTAINER_KEY);

  // -----------------------------------------------------------------------
  // Per-instance lifecycle state
  // -----------------------------------------------------------------------

  let eid: number | undefined = $state(undefined);
  let isRegistered = $state(false);

  // -----------------------------------------------------------------------
  // TextureManager — dedicated instance per renderer for independent
  // caching. Uses the same cache limits as the engine default.
  // -----------------------------------------------------------------------

  const textureManager = new TextureManager();

  // -----------------------------------------------------------------------
  // Sprite display objects — created per layer, managed via stage container
  // -----------------------------------------------------------------------

  let layerSprites: Sprite[] = [];
  let layerContainer: Container | undefined;

  // -----------------------------------------------------------------------
  // Row index — 0-20 derived from animationState + facing
  // -----------------------------------------------------------------------

  const currentRow = $derived(getLpcStateRow(animationState, facing));

  // -----------------------------------------------------------------------
  // Pre-allocated write buffer — recycled every $effect run
  // -----------------------------------------------------------------------

  const _writeBuffer: LpcLayerRecipe[] = [];

  // -----------------------------------------------------------------------
  // Texture asset loader for PixiJS Assets
  //
  // Attempts to load LPC spritesheets from local static paths. When the
  // file is missing (404) or the fetch fails, generates a high-visibility
  // magenta placeholder texture with the slot name.
  // -----------------------------------------------------------------------

  /**
   * Loads an LPC grayscale spritesheet texture from the static assets
   * directory. Falls back to a procedural mock sheet when the file is
   * unavailable, then to a magenta placeholder as a last-resort signal.
   *
   * @param slot - LPC slot name for path resolution.
   * @param assetId - Numeric asset ID string.
   * @returns A PixiJS Texture (real, mock, or placeholder).
   */
  const _loadGrayscaleTexture = async (slot: string, assetId: string): Promise<Texture> => {
    const path = getLpcAssetPath(slot, assetId);

    try {
      const { Assets } = await import('pixi.js');
      const texture = await Assets.load(path);
      texture.source.scaleMode = 'nearest';
      return texture;
    } catch {
      logger.debug('lpcRenderer.tryMockSheet', { slot, assetId, path });

      // Try procedural mock sheet — distinct geometric shapes per variant
      try {
        const mockTexture = await createMockSheetTexture(slot, 'default');
        if (mockTexture !== Texture.EMPTY) {
          return mockTexture;
        }
      } catch {
        // Fall through to placeholder
      }

      return createPlaceholderTexture(slot, assetId);
    }
  };

  // -----------------------------------------------------------------------
  // Grid lookup pipeline — maps frame + currentRow to exact 64×64
  // sub-texture regions using TextureManager.getFrameAt().
  //
  // Source X Offset = frame × 64
  // Source Y Offset = currentRow × 64
  // -----------------------------------------------------------------------

  /**
   * Computes the absolute row-major frame index within a spritesheet
   * given the animation frame column and the current spritesheet row.
   *
   * The formula is: `currentRow * LPC_COLUMNS + frame`
   * where `currentRow` = getLpcStateRow(animationState, direction)
   * and `frame` is the animation column (0-N per state).
   *
   * @param frame - Animation frame column (0-based within the state row).
   * @param row - Absolute spritesheet row (0-20).
   * @returns Row-major spritesheet frame index for TextureManager.getFrameAt().
   */
  const _computeFrameIndex = (frame: number, row: number): number => {
    return row * LPC_LAYOUT.columns + frame;
  };

  // -----------------------------------------------------------------------
  // Lifecycle: allocate UBO slot + create texture layer sprites
  // -----------------------------------------------------------------------

  onMount(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!batchManager) {
      const message =
        '[LpcCharacterRenderer] LpcBatchManager context not found. ' +
        'Ensure a parent component provides LPC_BATCH_MANAGER_KEY context via setContext().';
      logger.error('LpcCharacterRenderer.missingContext', { message });
      throw new Error(message);
    }

    // Allocate UBO slot
    const uid = _nextEid;
    _nextEid += 1;
    eid = uid;

    batchManager.registerEntity(uid, recipes as LpcLayerRecipe[]);
    isRegistered = true;

    // Create layer container for sprites
    if (showSprites && stageContainer) {
      layerContainer = new Container();
      layerContainer.x = x;
      layerContainer.y = y;
      stageContainer.addChild(layerContainer);
    }

    // Test hooks
    if (typeof window !== 'undefined') {
      const win = window as unknown as Record<string, unknown>;
      win.__lpc_active_instances = batchManager.activeInstances;
    }

    return () => {
      // Deregister UBO slot
      if (eid !== undefined && batchManager) {
        batchManager.deregisterEntity(eid);
        isRegistered = false;

        if (typeof window !== 'undefined') {
          const win = window as unknown as Record<string, unknown>;
          win.__lpc_active_instances = batchManager.activeInstances;
          win.__lpc_structural_hashes = batchManager.structuralHashesIssued;
        }
      }

      // Clean up sprites
      _destroySprites();

      if (layerContainer && stageContainer) {
        stageContainer.removeChild(layerContainer);
        layerContainer.destroy({ children: true });
        layerContainer = undefined;
      }
    };
  });

  // -----------------------------------------------------------------------
  // Sprite lifecycle helpers
  // -----------------------------------------------------------------------

  /**
   * Destroys all active layer sprites and clears the sprite array.
   * Sprites are removed from the parent container before destruction.
   */
  const _destroySprites = (): void => {
    for (const sprite of layerSprites) {
      if (layerContainer) {
        layerContainer.removeChild(sprite);
      }
      sprite.destroy();
    }
    layerSprites = [];
  };

  /**
   * Creates PixiJS Sprites from pre-loaded textures, positioned in the
   * layer container. Each layer recipe gets one sprite back-to-front.
   *
   * @param textures - Array of PixiJS Textures in recipe order.
   */
  const _createSprites = (textures: Texture[]): void => {
    _destroySprites();

    if (!layerContainer) {
      return;
    }

    for (const texture of textures) {
      if (!texture || texture === Texture.EMPTY) {
        continue;
      }

      const sprite = new Sprite(texture);
      sprite.eventMode = 'none';
      layerContainer.addChild(sprite);
      layerSprites.push(sprite);
    }
  };

  // -----------------------------------------------------------------------
  // Reactive UBO update — zero-allocation write path
  // -----------------------------------------------------------------------

  $effect(() => {
    void x;
    void y;
    void animationState;
    void facing;
    void frame;
    void recipes;
    void width;
    void height;

    if (!isRegistered || eid === undefined) {
      return;
    }

    // Recycle pre-allocated buffer
    for (let i = 0; i < recipes.length; i++) {
      if (i < _writeBuffer.length) {
        _writeBuffer[i] = recipes[i];
      } else {
        _writeBuffer.push(recipes[i]);
      }
    }
    _writeBuffer.length = recipes.length;

    batchManager.writeEntityUbo(eid, _writeBuffer);

    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__lpc_structural_hashes =
        batchManager.structuralHashesIssued;
    }

    // Update container position
    if (layerContainer) {
      layerContainer.x = x;
      layerContainer.y = y;
    }
  });

  // -----------------------------------------------------------------------
  // Texture-based sprite rendering
  //
  // This $effect runs whenever recipes, animationState, facing, or frame
  // change AND showSprites is true. It loads grayscale spritesheets via
  // the texture manager, extracts 64×64 sub-texture frames using the
  // grid lookup pipeline (frame × 64, currentRow × 64), and creates
  // PixiJS Sprite display objects in the stage container.
  // -----------------------------------------------------------------------

  $effect(() => {
    const currentRecipes = recipes;
    const currentFrame = frame;
    const row = currentRow;
    void animationState;
    void facing;
    void showSprites;

    if (!showSprites || !layerContainer || currentRecipes.length === 0) {
      return;
    }

    // Compute the absolute row-major frame index for TextureManager.getFrameAt()
    const frameIndex = _computeFrameIndex(currentFrame, row);

    // Load textures for each layer recipe and extract frame sub-textures
    const loadAndSlice = async (): Promise<void> => {
      const textures: Texture[] = [];

      for (const recipe of currentRecipes) {
        if (!recipe?.assetId) {
          textures.push(Texture.EMPTY);
          continue;
        }

        try {
          // Load the full grayscale spritesheet
          const sheet = await _loadGrayscaleTexture(recipe.slot ?? 'body', recipe.assetId);

          // Extract the 64×64 sub-texture at the computed frame index
          const frameTexture = textureManager.getFrameAt({
            texture: sheet,
            layout: LPC_LAYOUT,
            frameIndex,
          });

          textures.push(frameTexture ?? Texture.EMPTY);
        } catch {
          textures.push(Texture.EMPTY);
        }
      }

      _createSprites(textures);
    };

    void loadAndSlice();
  });
</script>

<!-- Component has no visible DOM — rendering is handled through
     PixiJS sprites added to the stage container. -->