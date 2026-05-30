<script lang="ts">
  import { onMount } from 'svelte';
  // apps/frontend/pwa/src/lib/views/game/game-view.svelte
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import type { GameViewModelInterface } from './game-view-model.svelte.ts';

  type Props = {
    viewModel: GameViewModelInterface;
  };

  const { viewModel }: Props = $props();

  /** The canvas element that PixiJS will render into. */
  let canvasElement: HTMLCanvasElement | undefined = $state();

  onMount(() => {
    if (canvasElement) {
      void viewModel.attachCanvas(canvasElement);
    }
  });
</script>

<BaseViewModelContainer {viewModel} fillHeight={true} class="relative">
  <!-- PixiJS canvas — the game engine owns this DOM element -->
  <canvas bind:this={canvasElement} class="absolute inset-0 w-full h-full"></canvas>

  <!-- Svelte UI overlay — owns the DOM above the canvas -->
  {#if viewModel.activeDialog}
    <div class="absolute bottom-0 inset-x-0 p-4">
      <div class="mx-auto max-w-lg rounded-lg border border-base-300 bg-base-200 p-4 shadow-lg">
        <p class="text-sm font-bold text-primary">{viewModel.activeDialog.npcName}</p>
        <p class="mt-1 text-sm text-base-content">{viewModel.activeDialog.dialog}</p>
      </div>
    </div>
  {/if}

  {#if viewModel.gameError}
    <div
      class="absolute top-4 inset-x-0 mx-auto max-w-sm rounded-lg border border-error/30 bg-error/10 p-3 text-center"
    >
      <p class="text-sm text-error">{viewModel.gameError}</p>
    </div>
  {/if}

  {#if !viewModel.isGameReady && !viewModel.gameError}
    <div class="absolute inset-0 flex items-center justify-center bg-base-100/80">
      <p class="text-sm text-base-content/60">Loading game engine...</p>
    </div>
  {/if}
</BaseViewModelContainer>
