<script lang="ts">
  // apps/frontend/client/src/lib/views/game/canvas/game_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import FloatingText from '$lib/components/game/floating_text.svelte';
  import ModeIndicator from '$lib/components/mode_indicator.svelte';
  import DiegeticHealthBar from '../../combat/components/diegetic_health_bar.svelte';
  import type { GameViewViewModelInterface } from './game_view_model.svelte';

  type Props = {
    viewModel: GameViewViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <!--
    Canvas container — fills whatever space the parent layout gives it.

    Contract: C-164 Combat Split-Screen Layout
    The parent (+page.svelte) controls the grid layout. This component
    is always full-size within its grid cell.
  -->
  <div class="relative w-full h-full overflow-hidden">
    <!-- Layer 0 (z-0): Game canvas — PixiJS owns this DOM element -->
    <div
      id="game-canvas-container"
      class="absolute inset-0 z-0"
      class:animate-shake={viewModel.isShaking}
    >
      <canvas bind:this={viewModel.canvasElement} class="w-full h-full block touch-none"></canvas>
    </div>

    <!-- Layer 10 (z-10): Svelte UI overlay — positioned on top of canvas -->
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

      <!-- Mode Indicator (C-140) -->
      <ModeIndicator />

      <!-- Floating damage text (C-163) -->
      {#each viewModel.floatingTexts as ft (ft.id)}
        <FloatingText
          amount={ft.amount}
          x={ft.x}
          y={ft.y}
          isCritical={ft.isCritical}
          onComplete={() => viewModel.removeFloatingText(ft.id)}
        />
      {/each}

      <!-- Diegetic health bars (C-166 AC-2) -->
      {#each viewModel.combatantScreenStates as cs (cs.entityId)}
        <DiegeticHealthBar
          entityId={cs.entityId}
          hp={cs.hp}
          maxHp={cs.maxHp}
          screenX={cs.screenX}
          screenY={cs.screenY}
          isActiveTurn={cs.isActiveTurn}
          label={cs.entityId === 1 ? 'Player' : 'Enemy'}
        />
      {/each}

      <!-- Game Error — centered top overlay -->
      {#if viewModel.gameError}
        <div
          class="pointer-events-auto absolute top-4 inset-x-0 mx-auto max-w-sm rounded-lg border border-error/30 bg-error/10 p-3 text-center"
        >
          <p class="text-sm text-error">{viewModel.gameError}</p>
        </div>
      {/if}

      <!-- Loading State -->
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

<style>
  @keyframes shake {
    0%,
    100% {
      transform: translate(0, 0);
    }
    10% {
      transform: translate(-4px, -2px);
    }
    20% {
      transform: translate(3px, 1px);
    }
    30% {
      transform: translate(-3px, 2px);
    }
    40% {
      transform: translate(2px, -1px);
    }
    50% {
      transform: translate(-2px, -2px);
    }
    60% {
      transform: translate(1px, 1px);
    }
    70% {
      transform: translate(-1px, -1px);
    }
    80% {
      transform: translate(1px, 0);
    }
    90% {
      transform: translate(-1px, 1px);
    }
  }

  .animate-shake {
    animation: shake 0.3s ease-in-out;
  }
</style>
