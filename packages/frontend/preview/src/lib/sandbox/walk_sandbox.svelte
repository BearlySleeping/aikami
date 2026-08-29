<script lang="ts">
// packages/frontend/preview/src/lib/sandbox/walk_sandbox.svelte
//
// Walk sandbox component — mounts a GameWorld for interactive map exploration.
// Pure wrapper; all logic lives in the ViewModel.
// Imported from @aikami/frontend-preview/sandbox to avoid pulling GameWorld
// into static preview bundles.

import type { AssetResolver } from '@aikami/types';
import { onDestroy } from 'svelte';
import {
  getWalkSandboxViewModel,
  type WalkSandboxViewModelInterface,
} from './walk_sandbox_view_model.svelte';

type Props = {
  resolver: AssetResolver;
  mapTag?: string;
  width?: number;
  height?: number;
};

let { resolver, mapTag, width = 768, height = 512 }: Props = $props();

let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
let viewModel = $state<WalkSandboxViewModelInterface | undefined>(undefined);

// Create ViewModel and initialize on mount
$effect(() => {
  const vm = getWalkSandboxViewModel({
    className: 'WalkSandbox',
    resolver,
    mapTag,
  });
  viewModel = vm;
  void vm.initialize();

  return () => {
    void vm.dispose().catch(() => {
      // dispose silently
    });
  };
});

// Bind canvas once available and initialize engine
$effect(() => {
  if (canvasEl && viewModel && !viewModel.engineReady && !viewModel.engineError) {
    void viewModel.initializeEngine(canvasEl);
  }
});

onDestroy(() => {
  // Safety net: if the $effect cleanup hasn't run (e.g. SvelteKit navigation edge cases),
  // ensure dispose is called. The effect cleanup guard prevents double-dispose.
  if (viewModel) {
    void viewModel.dispose().catch(() => {
      // dispose silently
    });
    viewModel = undefined;
  }
});
</script>

<div class="flex flex-col gap-2">
  {#if viewModel?.engineError}
    <div class="bg-error/10 border border-error text-error px-3 py-2 rounded text-xs">
      ⚠️ Engine error: {viewModel.engineError}
    </div>
  {/if}

  <canvas
    bind:this={canvasEl}
    {width}
    {height}
    class="block rounded-box bg-base-300"
    aria-label="Walk sandbox"
  ></canvas>

  {#if viewModel?.engineReady}
    <div class="text-xs text-base-content/60 flex gap-4">
      <span>Map: {viewModel.currentMap ?? 'none'}</span>
    </div>
  {/if}
</div>
