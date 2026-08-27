<script lang="ts">
// packages/frontend/preview/src/lib/tileset/tileset_preview.svelte
//
// Tileset preview component — pure wrapper. All logic lives in the ViewModel.
// Renders a tileset atlas with optional grid overlay and hover tile index.

import type { AssetResolver } from '@aikami/types';
import {
  getTilesetPreviewViewModel,
  type TilesetPreviewViewModelInterface,
} from './tileset_preview_view_model.svelte';

type Props = {
  resolver: AssetResolver;
  tag: string;
  width?: number;
  height?: number;
  tileSize?: number;
  showGrid?: boolean;
  zoom?: number;
};

let {
  resolver,
  tag,
  width = 512,
  height = 512,
  tileSize = 32,
  showGrid = false,
  zoom = 1,
}: Props = $props();

let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
let viewModel = $state<TilesetPreviewViewModelInterface | undefined>(undefined);

$effect(() => {
  const vm = getTilesetPreviewViewModel({
    className: 'TilesetPreview',
    resolver,
    tag,
    width,
    height,
    tileSize,
    showGrid,
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
  {#if viewModel?.errorMessage}
    <div class="bg-error/10 border border-error text-error px-3 py-2 rounded text-xs">
      ⚠️ {viewModel.errorMessage}
    </div>
  {:else}
    <canvas
      bind:this={canvasEl}
      {width}
      {height}
      class="block rounded-box bg-base-300 [image-rendering:pixelated] cursor-crosshair"
      aria-label="Tileset preview: {tag}"
      onmousemove={(e) => viewModel?.handleMouseMove(e)}
    ></canvas>
    {#if viewModel?.hoveredTileIndex !== undefined}
      <div class="text-xs text-base-content/60">Tile index: {viewModel.hoveredTileIndex}</div>
    {/if}
  {/if}
</div>
