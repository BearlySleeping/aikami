<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/sandbox/map/map_sandbox_view.svelte
  //
  // Thin Svelte view for the Map & Zoning sandbox.
  // Binds a canvas to the ViewModel and renders floating Dev UI buttons.
  //
  // Contract: C-139 Task 2

  import { onMount } from 'svelte';
  import BaseViewModelContainer from '$components/base_view_model_container.svelte';
  import type { MapSandboxViewModelInterface } from './map_sandbox_view_model.svelte.ts';

  type Props = {
    viewModel: MapSandboxViewModelInterface;
  };

  let { viewModel }: Props = $props();

  let canvasElement: HTMLCanvasElement | undefined = $state();

  /**
   * Hands the bound canvas to the ViewModel for engine initialization.
   */
  onMount(() => {
    if (canvasElement) {
      void viewModel.initializeEngine(canvasElement);
    }
  });
</script>

<svelte:head>
  <title>Map & Zoning Sandbox - Aikami</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div
    class="relative flex min-h-[calc(100vh-6rem)] w-full flex-col overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm"
  >
    <!-- Game engine canvas — fills available space -->
    <canvas bind:this={canvasElement} class="flex-1 w-full h-full"></canvas>

    <!-- Status overlay -->
    <div
      class="absolute top-3 left-3 z-10 rounded-lg bg-base-200/80 px-3 py-1.5 shadow backdrop-blur-sm"
    >
      <span class="text-xs font-medium text-base-content/70">Map Sandbox</span>
      {#if viewModel.engineError}
        <span class="ml-1.5 text-sm font-semibold text-error">Error</span>
      {:else if viewModel.engineReady}
        <span class="ml-1.5 text-sm font-semibold text-success">Running</span>
      {:else}
        <span class="ml-1.5 text-sm font-semibold text-warning">Loading…</span>
      {/if}
    </div>

    <!-- Current map indicator -->
    {#if viewModel.currentMap}
      <div
        class="absolute top-3 right-3 z-10 rounded-lg bg-base-300/70 px-3 py-1.5 shadow backdrop-blur-sm"
      >
        <span class="text-xs font-mono text-base-content/60">
          {viewModel.currentMap.split('/').pop()}
        </span>
      </div>
    {/if}

    <!-- Engine error display -->
    {#if viewModel.engineError}
      <div
        class="absolute top-12 left-3 z-20 max-w-md rounded-lg bg-error/10 px-3 py-1.5 backdrop-blur-sm"
      >
        <span class="text-xs font-mono text-error">{viewModel.engineError}</span>
      </div>
    {/if}

    <!-- Floating Dev UI buttons for rapid map switching -->
    <div
      class="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 flex gap-2 rounded-xl bg-neutral/90 px-4 py-2 shadow-lg backdrop-blur-sm"
    >
      <button
        class="btn btn-sm gap-1"
        class:btn-primary={viewModel.currentMap?.includes('zone_a')}
        class:btn-outline={!viewModel.currentMap?.includes('zone_a')}
        onclick={() => viewModel.loadZoneA()}
        disabled={!viewModel.engineReady}
      >
        Zone A
      </button>
      <button
        class="btn btn-sm gap-1"
        class:btn-secondary={viewModel.currentMap?.includes('zone_b')}
        class:btn-outline={!viewModel.currentMap?.includes('zone_b')}
        onclick={() => viewModel.loadZoneB()}
        disabled={!viewModel.engineReady}
      >
        Zone B
      </button>

      {#if !viewModel.engineReady}
        <span class="self-center text-xs text-neutral-content/60">— Engine not ready</span>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
