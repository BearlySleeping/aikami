<script lang="ts">
// apps/frontend/client/src/lib/components/game/game_canvas.svelte

type Props = {
  /** Called when the canvas is mounted and ready for engine initialization. */
  onReady: (canvas: HTMLCanvasElement) => void | Promise<void>;
  /** Optional class string applied to the canvas element. */
  class?: string;
};

const { onReady, class: className = '' }: Props = $props();

let canvasElement: HTMLCanvasElement | undefined = $state();

$effect(() => {
  if (canvasElement) {
    void onReady(canvasElement);
  }
});
</script>

<canvas bind:this={canvasElement} class={className}></canvas>
