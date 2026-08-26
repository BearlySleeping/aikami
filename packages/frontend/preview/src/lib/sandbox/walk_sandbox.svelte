<script lang="ts">
  // packages/frontend/preview/src/lib/sandbox/walk_sandbox.svelte
  //
  // Walk sandbox component — mounts a GameWorld for interactive map exploration.
  // Imported from @aikami/frontend/preview/sandbox to avoid pulling GameWorld
  // into static preview bundles.

  import { onMount, onDestroy } from 'svelte';
  import {
    getWalkSandboxViewModel,
    type WalkSandboxViewModelInterface,
  } from './walk_sandbox_view_model.svelte';
  import type { AssetResolver } from '@aikami/types';

  type Props = {
    resolver: AssetResolver;
    mapTag?: string;
    width?: number;
    height?: number;
  };

  let {
    resolver,
    mapTag,
    width = 768,
    height = 512,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
  let viewModel = $state<WalkSandboxViewModelInterface | undefined>(undefined);

  onMount(async () => {
    const vm = getWalkSandboxViewModel({
      className: 'WalkSandbox',
      resolver,
      mapTag,
    });
    viewModel = vm;
    await vm.initialize();

    if (canvasEl) {
      await vm.initializeEngine(canvasEl);
    }
  });

  onDestroy(() => {
    viewModel?.destroyEngine();
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
    width={width}
    height={height}
    class="block rounded-box bg-base-300"
    aria-label="Walk sandbox"
  ></canvas>

  {#if viewModel?.engineReady}
    <div class="text-xs text-base-content/60 flex gap-4">
      <span>Map: {viewModel.currentMap ?? 'none'}</span>
    </div>
  {/if}
</div>
