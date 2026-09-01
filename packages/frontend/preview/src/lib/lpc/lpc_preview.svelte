<script lang="ts">
// packages/frontend/preview/src/lib/lpc/lpc_preview.svelte
//
// Host-agnostic LPC character preview component.
// Pure wrapper — all logic lives in the ViewModel.
// Takes a resolver, catalog slots, and optional initial state.
// Renders a canvas with PixiJS for the character + control panel.

import { LpcAnimationState, LpcDirection } from '@aikami/lpc';
import type { AssetResolver } from '@aikami/types';
import {
  getLpcPreviewViewModel,
  type LpcPreviewState,
  type LpcPreviewViewModelInterface,
  type LpcSlotDef,
} from './lpc_preview_view_model.svelte';

type Props = {
  resolver: AssetResolver;
  allSlots: LpcSlotDef[];
  width?: number;
  height?: number;
  zoom?: number;
  initialState?: LpcPreviewState;
  onStateChange?: (state: LpcPreviewState) => void;
  controls?: boolean;
};

let {
  resolver,
  allSlots,
  width = 960,
  height = 540,
  zoom = 1,
  initialState,
  onStateChange,
  controls = true,
}: Props = $props();

let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
let viewModel = $state<LpcPreviewViewModelInterface | undefined>(undefined);
// Mirrors the `controls` prop. $state($props()) would capture only the
// initial value (svelte/state_referenced_locally); $derived tracks it.
const showControls = $derived(controls);

// Create ViewModel with zoom wired in
$effect(() => {
  const vm = getLpcPreviewViewModel({
    className: 'LpcPreview',
    resolver,
    allSlots,
    initialState,
    onStateChange,
    zoom,
  });
  viewModel = vm;
  void vm.initialize();
  // Return sync cleanup function (not async)
  return () => {
    void vm.dispose().catch(() => {
      // dispose silently
    });
  };
});

// Bind canvas element once available
$effect(() => {
  if (canvasEl && viewModel) {
    viewModel.setCanvasElement(canvasEl);
  }
});
</script>

<div
  class="flex flex-col bg-base-200 text-base-content font-sans rounded-box overflow-hidden"
  style="width: {width}px;"
>
  <!-- Status Banner -->
  {#if viewModel?.statusBanner}
    <div
      class="flex items-center justify-between px-4 py-2 text-xs border-b z-20
        {viewModel.statusBanner.level === 'info' ? 'bg-info/10 border-info text-info' : ''}
        {viewModel.statusBanner.level === 'warn' ? 'bg-warning/10 border-warning text-warning' : ''}
        {viewModel.statusBanner.level === 'error' ? 'bg-error/10 border-error text-error' : ''}"
    >
      <span class="flex-1">{viewModel.statusBanner.message}</span>
      <button
        type="button"
        class="btn btn-ghost btn-xs opacity-70 hover:opacity-100"
        onclick={() => viewModel?.clearStatus()}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  {/if}

  <div class="flex {showControls ? 'flex-row' : 'flex-col'}">
    <!-- Canvas -->
    <div class="flex-1 flex items-center justify-center bg-base-300" style="min-height: {height}px">
      <canvas
        bind:this={canvasEl}
        class="block [image-rendering:pixelated]"
        {width}
        {height}
        aria-label="LPC character preview"
      ></canvas>
    </div>

    <!-- Controls -->
    {#if showControls && viewModel}
      <div
        class="w-72 bg-base-200 border-l border-base-300 flex flex-col overflow-y-auto p-3 gap-3"
      >
        <!-- Animation Controls -->
        <fieldset class="border-0 p-0 m-0">
          <legend class="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-2">
            Animation
          </legend>

          <div class="flex gap-1 mb-2">
            <button
              type="button"
              class="btn btn-xs {viewModel.isPlaying ? 'btn-primary' : 'btn-ghost'}"
              onclick={() => viewModel?.togglePlayback()}
            >
              {viewModel.isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              onclick={() => viewModel?.stepPrev()}
              disabled={viewModel.isPlaying}
            >
              ⏮
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              onclick={() => viewModel?.stepNext()}
              disabled={viewModel.isPlaying}
            >
              ⏭
            </button>
          </div>

          <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-1">
            State
            <select
              class="select select-sm w-full bg-base-100"
              value={viewModel.animationState}
              onchange={(e: Event) => {
                const val = Number.parseInt((e.target as HTMLSelectElement).value, 10);
                viewModel?.setAnimationState(val as LpcAnimationState);
              }}
            >
              {#each viewModel.animationStateOptions as state}
                <option value={state}>
                  {LpcAnimationState[state as unknown as keyof typeof LpcAnimationState]}
                </option>
              {/each}
            </select>
          </label>

          <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-1">
            Direction
            <select
              class="select select-sm w-full bg-base-100"
              value={viewModel.facingDirection}
              onchange={(e: Event) => {
                const val = Number.parseInt((e.target as HTMLSelectElement).value, 10);
                viewModel?.setFacingDirection(val as LpcDirection);
              }}
            >
              {#each viewModel.directionOptions as dir}
                <option value={dir}>
                  {LpcDirection[dir as unknown as keyof typeof LpcDirection]}
                </option>
              {/each}
            </select>
          </label>

          <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-1">
            Frame: {viewModel.animationFrame} / {viewModel.maxFrame}
            <input
              type="range"
              class="range range-sm range-primary w-full mt-1"
              min="0"
              max={viewModel.maxFrame}
              step="1"
              value={viewModel.animationFrame}
              oninput={(e: Event) => {
                const val = Number.parseInt((e.target as HTMLInputElement).value, 10);
                viewModel?.setAnimationFrame(val);
              }}
            >
          </label>
        </fieldset>

        <!-- Layers -->
        <fieldset class="border-0 p-0 m-0">
          <legend class="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-2">
            Layers ({viewModel.activeLayers.length})
          </legend>

          {#each viewModel.activeLayers as layer, i (i)}
            {@const slotDef = viewModel.allSlots[layer.slotDefIndex]}
            <div class="card bg-base-300 rounded-lg p-2 flex flex-col gap-1 mb-1">
              <div class="flex justify-between items-center">
                <span class="text-xs font-semibold">Layer {i}</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  onclick={() => viewModel?.removeLayer(i)}
                  aria-label="Remove layer {i}"
                >
                  ✕
                </button>
              </div>

              <label class="flex flex-col gap-1 text-xs text-base-content/60">
                Slot
                <select
                  class="select select-sm w-full bg-base-100"
                  value={layer.slotDefIndex}
                  onchange={(e: Event) => {
                    const val = Number.parseInt((e.target as HTMLSelectElement).value, 10);
                    viewModel?.setSlotDef(i, val);
                  }}
                >
                  {#each viewModel.allSlots as slotOpt, sIdx}
                    <option value={sIdx}>{slotOpt.label}</option>
                  {/each}
                </select>
              </label>

              {#if slotDef}
                <label class="flex flex-col gap-1 text-xs text-base-content/60">
                  Variant
                  <select
                    class="select select-sm w-full bg-base-100"
                    value={layer.variantIndex}
                    onchange={(e: Event) => {
                      const val = Number.parseInt((e.target as HTMLSelectElement).value, 10);
                      viewModel?.setVariant(i, val);
                    }}
                  >
                    {#each slotDef.variants as varOpt, vIdx}
                      <option value={vIdx}>{varOpt.label}</option>
                    {/each}
                  </select>
                </label>
              {/if}
            </div>
          {/each}

          <button
            type="button"
            class="btn btn-ghost btn-xs w-full mt-1"
            onclick={() => viewModel?.addLayer()}
            disabled={viewModel.activeLayers.length >= viewModel.maxLayers}
          >
            + Add Layer
          </button>
        </fieldset>

        <!-- Zoom -->
        <label class="flex flex-col gap-1 text-xs text-base-content/60">
          Zoom: {viewModel.zoom.toFixed(1)}x
          <input
            type="range"
            class="range range-sm range-primary w-full mt-1"
            min="0.5"
            max="10"
            step="0.1"
            value={viewModel.zoom}
            oninput={(e: Event) => {
              const val = Number.parseFloat((e.target as HTMLInputElement).value);
              viewModel?.setZoom(val);
            }}
          >
        </label>
      </div>
    {/if}
  </div>
</div>
