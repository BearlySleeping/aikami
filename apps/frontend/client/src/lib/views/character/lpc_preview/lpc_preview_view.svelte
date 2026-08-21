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

  <div class="flex items-center gap-2">
    <button
      type="button"
      class="btn btn-sm btn-ghost"
      aria-pressed={viewModel.isPlaying}
      onclick={() => viewModel.togglePlayback()}
    >
      {viewModel.isPlaying ? '⏸ Pause' : '▶ Play Walk Animation'}
    </button>

    <!-- Zoom control -->
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="btn btn-xs btn-ghost"
        aria-label="Zoom out"
        onclick={() => viewModel.setZoom(Math.max(0.5, viewModel.zoom - 0.25))}
      >
        −
      </button>
      <input
        type="range"
        min="0.5"
        max="3"
        step="0.1"
        class="range range-xs w-24"
        value={viewModel.zoom}
        aria-label="Zoom level"
        oninput={(e) => viewModel.setZoom(Number((e.target as HTMLInputElement).value))}
      >
      <button
        type="button"
        class="btn btn-xs btn-ghost"
        aria-label="Zoom in"
        onclick={() => viewModel.setZoom(Math.min(3, viewModel.zoom + 0.25))}
      >
        +
      </button>
      <span class="text-xs text-base-content/60 w-10 text-right tabular-nums">
        {Math.round(viewModel.zoom * 100)}%
      </span>
    </div>
  </div>

  {#if viewModel.missingAssets.length > 0}
    <span
      class="badge badge-warning badge-outline badge-sm gap-1"
      title={viewModel.missingAssets.join('\n')}
    >
      ⚠ {viewModel.missingAssets.length} layer{viewModel.missingAssets.length === 1 ? '' : 's'}
      unavailable
    </span>
  {/if}

  {#if viewModel.compositionFailed}
    <p class="text-xs text-warning">Preview rendering issue — try a different preset.</p>
  {/if}
</BaseViewModelContainer>
