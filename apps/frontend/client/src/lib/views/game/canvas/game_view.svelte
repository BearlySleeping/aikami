<script lang="ts">
  // apps/frontend/client/src/lib/views/game/canvas/game_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import GameUIView from '../ui/game_ui_view.svelte';
  import type { GameUIViewModelInterface } from '../ui/game_ui_view_model.svelte';
  import type { GameViewModelInterface } from './game_view_model.svelte';

  type Props = {
    viewModel: GameViewModelInterface;
    gameUIViewModel: GameUIViewModelInterface;
  };

  const { viewModel, gameUIViewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <div class="relative w-screen h-screen overflow-hidden">
    <!--
      Layer 0 (z-0): Game canvas container — PixiJS owns this DOM element.
      The engine renders directly into the <canvas> at WebGL native resolution.
    -->
    <div id="game-canvas-container" class="absolute inset-0 z-0">
      <canvas bind:this={viewModel.canvasElement} class="absolute inset-0 w-full h-full"></canvas>
    </div>

    <!--
      Layer 10 (z-10): Svelte UI overlay — rendered on top of the WebGL canvas.
      pointer-events-none allows clicks to pass through to the game canvas
      unless a child element explicitly sets pointer-events-auto.
    -->
    <div id="game-ui-layer" class="absolute inset-0 z-10 pointer-events-none">
      <!-- Player HUD — top-left overlay -->
      {#if viewModel.isGameReady}
        <div
          class="pointer-events-auto absolute top-3 left-3 rounded-lg bg-base-200/80 px-3 py-1.5 shadow backdrop-blur-sm"
        >
          <span class="text-xs font-medium text-base-content/70">Player</span>
          <span class="ml-1.5 text-sm font-semibold text-primary"
            >{viewModel.playerDisplayName}</span
          >
        </div>
      {/if}

      <!--
        Game UI Overlay Router (C-125).
        Switches between overlays (PAUSE_MENU, DIALOGUE, COMBAT) based on
        GameUIViewModel.activeOverlay. The Escape key is handled inside.
      -->
      <GameUIView viewModel={gameUIViewModel} />

      <!-- Active NPC Dialog — bottom overlay -->
      {#if viewModel.activeDialog}
        <div class="pointer-events-auto absolute bottom-0 inset-x-0 p-4">
          <div class="mx-auto max-w-lg rounded-lg border border-base-300 bg-base-200 p-4 shadow-lg">
            <p class="text-sm font-bold text-primary">{viewModel.activeDialog.npcName}</p>
            <p class="mt-1 text-sm text-base-content">{viewModel.activeDialog.dialog}</p>
          </div>
        </div>
      {/if}

      <!-- Game Error — centered top overlay -->
      {#if viewModel.gameError}
        <div
          class="pointer-events-auto absolute top-4 inset-x-0 mx-auto max-w-sm rounded-lg border border-error/30 bg-error/10 p-3 text-center"
        >
          <p class="text-sm text-error">{viewModel.gameError}</p>
        </div>
      {/if}

      <!-- Loading State — centered overlay -->
      {#if !viewModel.isGameReady && !viewModel.gameError}
        <div
          class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-base-100/80"
        >
          <p class="text-sm text-base-content/60">Loading game engine...</p>
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
