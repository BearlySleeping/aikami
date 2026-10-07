<script lang="ts">
// apps/frontend/client/src/lib/components/game/lpc_character_renderer.svelte
//
// C-168: LPC character sprite component with async Spritesheet-based
// texture loading. Shows an invisible placeholder while textures load
// via Assets.load() + Spritesheet.parse(), then swaps in the correctly
// cropped frame once the GPU texture is ready.

import type {
  LpcBatchManager,
  SpritesheetLease,
  TextureManager,
} from '@aikami/frontend/engine/render';
import type { LpcLayerRecipe } from '@aikami/frontend/engine/sim';
import type { LpcAnimationState, LpcDirection } from '@aikami/lpc';
import { Assets, Sprite } from 'pixi.js';
import { getContext, onDestroy } from 'svelte';
import { LPC_BATCH_MANAGER_KEY, LPC_STAGE_CONTAINER_KEY } from './lpc_context_keys.ts';

type Props = {
  x: number;
  y: number;
  state: LpcAnimationState;
  direction: LpcDirection;
  frame: number;
  recipes: readonly LpcLayerRecipe[];
  showSprites: boolean;
  showGrid: boolean;
  zoom: number;
  compositionFailed: boolean;
  /** Optional TextureManager for Spritesheet-based frame extraction. */
  textureManager?: TextureManager;
  /**
   * Optional asset URL resolver — maps (slot, assetId, state) to
   * a static asset URL (e.g. `/game-data/lpc/body/bodies_male.walk.webp`).
   */
  assetUrlResolver?: (slot: string, assetId: string, state: string) => string;
};

let {
  x,
  y,
  state: _animationState,
  direction: _direction,
  frame: _frame,
  recipes,
  showSprites: _showSprites,
  showGrid: _showGrid,
  zoom: _zoom,
  compositionFailed: _compositionFailed,
  textureManager,
  assetUrlResolver,
}: Props = $props();

// Context injection (used by parent LPC dev view for UBO data mgmt).
const _batchManager = getContext<LpcBatchManager>(LPC_BATCH_MANAGER_KEY);
const _stageContainer = getContext(LPC_STAGE_CONTAINER_KEY);

// Loading state — true while Assets.load + Spritesheet.parse are in flight.
let loading = $state(true);

// Internal pixi display object (set after async load completes).
let displaySprite: Sprite | undefined = $state(undefined);

// Per-layer sheet LEASES — one per URL. A lease pins the sheet in the shared
// registry for as long as this component animates from it, and `release()`
// gives the pin back. The sheet itself is owned by the registry (and by
// PixiJS' asset cache underneath): this component must never destroy it.
let sheetLeases: Map<string, SpritesheetLease> = $state(new Map());

// Monotonic cycle counter. Every async continuation checks it, so a load that
// was superseded mid-flight releases its own lease instead of resurrecting a
// sheet into the next cycle's map.
let loadCycle = 0;

/** Releases every held lease and drops the display sprite. */
const releaseSheets = (): void => {
  for (const lease of sheetLeases.values()) {
    lease.release();
  }
  sheetLeases = new Map();
  displaySprite?.destroy();
  displaySprite = undefined;
};

/** True when `cycle` is no longer the current load cycle. */
const isStaleCycle = (cycle: number): boolean => cycle !== loadCycle;

/**
 * Loads LPC layer textures and creates cached Spritesheets for
 * WebGPU-safe frame extraction (C-168).
 *
 * Runs when recipes or the URL resolver change. Clears previous
 * sprites and starts a fresh async load cycle.
 */
$effect(() => {
  // Skip when no resolver is provided — the parent ViewModel handles
  // all PixiJS rendering directly via its own pipeline.
  if (!assetUrlResolver) {
    return;
  }

  // Capture current values for this effect cycle.
  const currentRecipes = recipes;
  const currentResolver = assetUrlResolver;
  const currentTextureManager = textureManager;

  const cycle = ++loadCycle;
  loading = true;

  void (async () => {
    try {
      const stateStr = 'walk';

      const loadPromises = currentRecipes.map(async (recipe) => {
        if (!recipe.assetId || !currentResolver) {
          return;
        }

        const url = currentResolver(recipe.slot ?? 'body', recipe.assetId, stateStr);
        if (!url) {
          return;
        }

        try {
          const texture = await Assets.load(url);
          texture.source.scaleMode = 'nearest';

          if (!currentTextureManager) {
            return;
          }

          const columns = Math.floor(texture.width / 64);
          const rows = Math.floor(texture.height / 64);
          if (columns <= 0 || rows <= 0) {
            return;
          }

          const lease = await currentTextureManager.acquireSpritesheet({
            baseTexture: texture,
            layout: {
              frameWidth: 64,
              frameHeight: 64,
              columns,
              rows,
              keyPrefix: stateStr,
            },
            cacheKey: url,
          });

          // The cycle may have been superseded while the sheet was parsing.
          // Releasing here is what stops a late lease from pinning a sheet
          // nobody will ever animate from.
          if (isStaleCycle(cycle)) {
            lease.release();
            return;
          }

          sheetLeases.set(url, lease);

          // Set initial frame (idle = frame 0, down direction)
          const idleFrame = lease.spritesheet.textures.walk_2_0;
          if (idleFrame && !displaySprite) {
            const sprite = new Sprite(idleFrame);
            sprite.eventMode = 'none';
            sprite.x = x;
            sprite.y = y;
            displaySprite = sprite;
          }
        } catch {
          // Silently skip failed loads — placeholder remains visible.
        }
      });

      await Promise.all(loadPromises);
    } finally {
      // A superseded cycle must not clear the flag of the live one.
      if (!isStaleCycle(cycle)) {
        loading = false;
      }
    }
  })();

  // Cleanup on recipe change or unmount.
  return () => {
    loadCycle++;
    releaseSheets();
    loading = true;
  };
});

onDestroy(() => {
  loadCycle++;
  releaseSheets();
});
</script>

<!-- Invisible container — sprite is managed via PixiJS display tree.
     The loading state is exposed for parent diagnostics. -->
<div
  class="absolute pointer-events-none opacity-0 w-0 h-0 overflow-hidden"
  aria-hidden="true"
  data-loading={loading}
  data-spritesheet-count={sheetLeases.size}
></div>
