<script lang="ts">
  // apps/frontend/client/src/lib/views/game/canvas/game_view.svelte
  import { untrack } from 'svelte';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import ModeIndicator from '$lib/components/mode_indicator.svelte';
  import GameUIView from '../ui/game_ui_view.svelte';
  import type { GameUIViewModelInterface } from '../ui/game_ui_view_model.svelte';
  import type { GameViewModelInterface } from './game_view_model.svelte';

  type Props = {
    viewModel: GameViewModelInterface;
    gameUIViewModel: GameUIViewModelInterface;
  };

  const { viewModel, gameUIViewModel }: Props = $props();

  let canvasElement = $state<HTMLCanvasElement | undefined>(undefined);

  $effect(() => {
    const el = canvasElement;
    if (el) {
      // untrack prevents Svelte from intercepting engine state changes
      // through the reactivity graph. The engine (PixiJS + WebGL) must
      // run outside Svelte's proxy trap.
      untrack(() => {
        viewModel.canvasElement = el;
      });

      return () => {
        untrack(() => {
          viewModel.canvasElement = undefined;
        });
      };
    }
  });
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <div class="relative w-screen h-screen overflow-hidden">
    <!--
      Layer 0 (z-0): Game canvas container — PixiJS owns this DOM element.
      The engine renders directly into the <canvas> at WebGL native resolution.
    -->
    <div id="game-canvas-container" class="absolute inset-0 z-0">
      <canvas bind:this={canvasElement} class="w-full h-full block touch-none"></canvas>
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
        Game UI Overlay Router (C-125, C-128).
        Switches between overlays (PAUSE_MENU, DIALOGUE, COMBAT) based on
        GameUIViewModel.activeOverlay. Escape key is handled inside.
      -->
      <GameUIView viewModel={gameUIViewModel} />

      <!-- Mode Indicator (C-140) — floating badge showing current game mode -->
      <ModeIndicator />

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
