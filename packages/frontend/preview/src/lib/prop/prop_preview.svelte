<script lang="ts">
// packages/frontend/preview/src/lib/prop/prop_preview.svelte
//
// Prop preview component — pure wrapper. All logic lives in the ViewModel.
// Renders a single prop sprite.

import type { AssetResolver } from '@aikami/types';
import {
  getPropPreviewViewModel,
  type PropPreviewViewModelInterface,
} from './prop_preview_view_model.svelte';

type Props = {
  resolver: AssetResolver;
  tag: string;
  width?: number;
  height?: number;
  zoom?: number;
};

let { resolver, tag, width = 128, height = 128, zoom = 2 }: Props = $props();

let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
let viewModel = $state<PropPreviewViewModelInterface | undefined>(undefined);

$effect(() => {
  const vm = getPropPreviewViewModel({
    className: 'PropPreview',
    resolver,
    tag,
    width,
    height,
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
      class="block rounded-box bg-base-300 [image-rendering:pixelated]"
      aria-label="Prop preview: {tag}"
    ></canvas>
  {/if}
</div>
