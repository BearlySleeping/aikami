<script lang="ts">
  // apps/frontend/client/src/lib/components/game/lpc_character_renderer.svelte
  // Stub — the LPC dev page does its own rendering via the view model.
  // This component was a parallel PixiJS renderer that used the legacy
  // static PNG pipeline. Now unused — kept as an empty container.
  import type { LpcBatchManager } from '@aikami/frontend/engine';
  import type { LpcAnimationState, LpcDirection } from '$lib/data/lpc_models';
  import type { LpcLayerRecipe } from '@aikami/frontend/engine';
  import { getContext } from 'svelte';
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
  };

  let {
    x,
    y,
    state,
    direction,
    frame,
    recipes,
    showSprites,
    showGrid,
    zoom,
    compositionFailed,
  }: Props = $props();

  // Capture context for potential future use
  getContext<LpcBatchManager>(LPC_BATCH_MANAGER_KEY);
  getContext(LPC_STAGE_CONTAINER_KEY);
</script>
