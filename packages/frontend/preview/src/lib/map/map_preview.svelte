<script lang="ts">
// packages/frontend/preview/src/lib/map/map_preview.svelte
//
// Map preview component — pure wrapper. All logic lives in the ViewModel.
// Renders a tilemap with optional collision and z-band overlays.

import type { ContentPackTerrain } from '@aikami/schemas';
import type { AssetResolver } from '@aikami/types';
import { untrack } from 'svelte';
import {
  getMapPreviewViewModel,
  type MapPreviewAtlas,
  type MapPreviewViewModelInterface,
} from './map_preview_view_model.svelte';

type Props = {
  resolver: AssetResolver;
  mapTag: string;
  sceneId?: string;
  assetLock?: string;
  baseTerrain?: string;
  /** Pack terrain definitions — required for terrain-channel scenes. */
  terrains?: readonly ContentPackTerrain[];
  /** Explicit frame -> source-rect atlas for packed/real textures. */
  atlas?: MapPreviewAtlas;
  /** In-memory manifest text — when set, no fetch happens (mapTag is ignored). */
  manifestText?: string;
  width?: number;
  height?: number;
  showCollision?: boolean;
  zoom?: number;
};

let {
  resolver,
  mapTag,
  sceneId,
  assetLock,
  baseTerrain,
  terrains,
  atlas,
  manifestText,
  width = 640,
  height = 480,
  showCollision = false,
  zoom = 1,
}: Props = $props();

let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
let viewModel = $state<MapPreviewViewModelInterface | undefined>(undefined);

$effect(() => {
  // atlas deliberately read untracked here — the VM is created once per
  // structural option; atlas updates flow through setAtlas below.
  const vm = getMapPreviewViewModel({
    className: 'MapPreview',
    resolver,
    mapTag,
    sceneId,
    assetLock,
    baseTerrain,
    terrains,
    atlas: untrack(() => atlas),
    width,
    height,
    showCollision,
    zoom,
  });
  viewModel = vm;
  void vm.initialize();
  return () => {
    void vm.dispose();
  };
});

// Manifest text updates flow through the same VM instance — no teardown.
$effect(() => {
  viewModel?.setManifestText(manifestText);
});

// Atlas updates flow through the same VM instance — no teardown.
$effect(() => {
  viewModel?.setAtlas(atlas);
});

// Canvas binding — runs when either the canvas or the VM changes.
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
      aria-label="Map preview: {mapTag}"
    ></canvas>
  {/if}
</div>
