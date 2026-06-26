<script lang="ts">
  // apps/frontend/client/src/lib/views/game/canvas/game_view.svelte
  import { untrack } from 'svelte';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import FloatingText from '$lib/components/game/floating_text.svelte';
  import ModeIndicator from '$lib/components/mode_indicator.svelte';
  import { gameStateService } from '$services';
  import CombatSidebar from '../../combat/combat_sidebar.svelte';
  import DiegeticHealthBar from '../../combat/components/diegetic_health_bar.svelte';
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

  /**
   * When the combat mode changes, the canvas container changes size.
   * Trigger a PixiJS resize after the CSS grid layout settles so the
   * engine doesn't render stretched or blurry pixels.
   */
  $effect(() => {
    const _mode = gameStateService.currentMode;
    // Read _mode so Svelte tracks the dependency.
    // After the layout has updated (next animation frame), force resize.
    if (viewModel.isGameReady) {
      requestAnimationFrame(() => {
        viewModel.triggerResize();
      });
    }
  });

  /** Whether the combat split-screen layout is active. */
  const isCombat = $derived(gameStateService.currentMode === 'COMBAT');
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <!--
    Outer container switches to CSS Grid when game mode is COMBAT.
    Grid layout: 35vw left pane (combat sidebar) + 1fr right pane (canvas).
    In non-combat modes, the canvas fills the entire viewport.

    Contract: C-164 Combat Split-Screen Layout
  -->
  <div
    class="w-screen h-screen overflow-hidden"
    class:grid={isCombat}
    style={isCombat ? 'grid-template-columns: 35vw 1fr;' : ''}
  >
    <!--
      Combat Sidebar — rendered in the left grid column during combat.
      Replaces the old full-screen combat modal overlay.
    -->
    {#if isCombat && gameUIViewModel.combatViewModel}
      <CombatSidebar viewModel={gameUIViewModel.combatViewModel} />
    {/if}

    <!--
      Right column: Canvas + UI Layer.
      In combat mode this fills the remaining 65% of the viewport.
      In explore mode it fills the entire viewport.
    -->
    <div class="relative w-full h-full overflow-hidden">
      <!--
        Layer 0 (z-0): Game canvas container — PixiJS owns this DOM element.
        The engine renders directly into the <canvas> at WebGL native resolution.
      -->
      <div
        id="game-canvas-container"
        class="absolute inset-0 z-0"
        class:animate-shake={viewModel.isShaking}
      >
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
          Switches between overlays (PAUSE_MENU, DIALOGUE) based on
          GameUIViewModel.activeOverlay. Escape key is handled inside.
          Note: COMBAT overlay is now rendered as a sidebar (left grid column),
          not as a full-screen modal.
        -->
        <GameUIView viewModel={gameUIViewModel} />

        <!-- Mode Indicator (C-140) — floating badge showing current game mode -->
        <ModeIndicator />

        <!--
          Floating damage text (C-163) — rendered as DOM elements on top of
          the WebGL canvas. Each instance floats upward and fades out.
        -->
        {#each viewModel.floatingTexts as ft (ft.id)}
          <FloatingText
            amount={ft.amount}
            x={ft.x}
            y={ft.y}
            isCritical={ft.isCritical}
            onComplete={() => viewModel.removeFloatingText(ft.id)}
          />
        {/each}

        <!-- Diegetic health bars — positioned over PixiJS sprites during combat (C-166 AC-2) -->
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
