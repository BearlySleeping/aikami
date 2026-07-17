<script lang="ts">
// apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view.svelte
//
// LPC Preview View — zero-logic wrapper for the PixiJS character preview canvas.
// Binds the canvas element to the ViewModel and provides an animation toggle.
// Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults

import { onMount, onDestroy } from 'svelte';
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
  type LpcPreviewViewModelOptions,
} from './lpc_preview_view_model.svelte';

type Props = {
  viewModel?: LpcPreviewViewModelInterface;
  options?: LpcPreviewViewModelOptions;
};

const props = $props<Props>();
const viewModel = props.viewModel ?? getLpcPreviewViewModel(props.options ?? { className: 'LpcPreviewViewModel' });
const isOwnedViewModel = !props.viewModel;

let canvasElement: HTMLCanvasElement | undefined = $state(undefined);

$effect(() => {
  if (canvasElement) {
    viewModel.setCanvasElement(canvasElement);
  }
});

onMount(async () => {
  if (isOwnedViewModel) {
    await viewModel.initialize();
  }
});

onDestroy(async () => {
  if (isOwnedViewModel) {
    await viewModel.dispose();
  }
});
</script>

<div class="flex flex-col items-center gap-2">
  <canvas
    id="lpc-preview-canvas"
    bind:this={canvasElement}
    class="rounded border border-base-300 bg-base-300"
    width={256}
    height={256}
    role="img"
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
</div>
