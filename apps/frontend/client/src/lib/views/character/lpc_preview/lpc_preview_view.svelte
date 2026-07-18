<script lang="ts">
import BaseViewModelContainer from '$components/base_view_model_container.svelte';
// apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view.svelte
//
// LPC Preview View — zero-logic wrapper for the PixiJS character preview canvas.
// Binds the canvas element to the ViewModel and provides an animation toggle.
// Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
} from './lpc_preview_view_model.svelte';

type Props = {
  viewModel?: LpcPreviewViewModelInterface;
};
let { viewModel = getLpcPreviewViewModel({ className: 'LpcPreviewViewModel' }) }: Props = $props();

let canvasElement: HTMLCanvasElement | undefined = $state(undefined);

$effect(() => {
  if (canvasElement) {
    viewModel.setCanvasElement(canvasElement);
  }
});
</script>

<BaseViewModelContainer {viewModel} class="flex flex-col items-center gap-2">
  <canvas
    id="lpc-preview-canvas"
    bind:this={canvasElement}
    class="rounded border border-base-300 bg-base-300"
    width={256}
    height={256}
    aria-label="Character appearance preview"
  ></canvas>

  <button
    type="button"
    class="btn btn-sm btn-ghost"
    aria-pressed={viewModel.isPlaying}
    onclick={() => viewModel.togglePlayback()}
  >
    {viewModel.isPlaying ? '⏸ Pause' : '▶ Play Walk Animation'}
  </button>

  {#if viewModel.compositionFailed}
    <p class="text-xs text-warning">Preview rendering issue — try a different preset.</p>
  {/if}
</BaseViewModelContainer>
