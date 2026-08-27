<script lang="ts">
  // packages/frontend/preview/src/lib/map/map_preview.svelte
  //
  // Map preview component — pure wrapper. All logic lives in the ViewModel.
  // Renders a tilemap with optional collision and z-band overlays.

  import {
    getMapPreviewViewModel,
    type MapPreviewViewModelInterface,
  } from './map_preview_view_model.svelte';
  import type { AssetResolver } from '@aikami/types';

  type Props = {
    resolver: AssetResolver;
    mapTag: string;
    width?: number;
    height?: number;
    showCollision?: boolean;
    showZBands?: boolean;
    zoom?: number;
  };

  let {
    resolver,
    mapTag,
    width = 640,
    height = 480,
    showCollision = false,
    showZBands = false,
    zoom = 1,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
  let viewModel = $state<MapPreviewViewModelInterface | undefined>(undefined);

  $effect(() => {
    const vm = getMapPreviewViewModel({
      className: 'MapPreview',
      resolver,
      mapTag,
      width,
      height,
      showCollision,
      showZBands,
      zoom,
    });
    viewModel = vm;
    void vm.initialize();
    return () => {
      void vm.dispose();
    };
  });

  $effect(() => {
    if (canvasEl && viewModel) {
      viewModel.setCanvasElement(canvasEl);
    }
  });
</script>

<div class="flex flex-col gap-2">
  {#if viewModel?.error}
    <div class="bg-error/10 border border-error text-error px-3 py-2 rounded text-xs">
      ⚠️ {viewModel.error}
    </div>
  {:else}
    <canvas
      bind:this={canvasEl}
      width={width}
      height={height}
      class="block rounded-box bg-base-300 [image-rendering:pixelated]"
      aria-label="Map preview: {mapTag}"
    ></canvas>
  {/if}
</div>
