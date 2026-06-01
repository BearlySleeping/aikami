<script lang="ts">
  import type { EngineBridge, GameWorld } from '@aikami/frontend/engine';
  // apps/frontend/pwa/src/lib/components/game/game_canvas.svelte
  import { onMount } from 'svelte';

  type Props = {
    /** Called when the canvas is mounted and ready for engine initialization. */
    onReady: (canvas: HTMLCanvasElement) => void | Promise<void>;
    /** Optional class string applied to the canvas element. */
    class?: string;
  };

  const { onReady, class: className = '' }: Props = $props();

  let canvasElement: HTMLCanvasElement | undefined = $state();

  onMount(() => {
    if (canvasElement) {
      void onReady(canvasElement);
    }
  });
</script>

<canvas bind:this={canvasElement} class={className}></canvas>
