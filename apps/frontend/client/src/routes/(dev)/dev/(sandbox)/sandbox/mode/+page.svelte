<script lang="ts">
// apps/frontend/client/src/routes/dev/sandbox/mode/+page.svelte
import { untrack } from 'svelte';
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import ModeIndicator from '$lib/components/mode_indicator.svelte';
import { gameStateService } from '$services';
import {
  getModeSandboxViewModel,
  type ModeSandboxViewModelInterface,
} from './mode_sandbox_view_model.svelte';

const viewModel: ModeSandboxViewModelInterface = getModeSandboxViewModel({
  className: 'ModeSandboxViewModel',
});

let canvasElement = $state<HTMLCanvasElement | undefined>(undefined);

$effect(() => {
  const el = canvasElement;
  if (el) {
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

/** Derived button active state for mode toggle buttons. */
const exploreActive = $derived(gameStateService.currentMode === 'EXPLORE');
const dialogueActive = $derived(gameStateService.currentMode === 'DIALOGUE');
const menuActive = $derived(gameStateService.currentMode === 'MENU');

/** Whether any non-EXPLORE overlay is active. */
const isLocked = $derived(gameStateService.currentMode !== 'EXPLORE');

/** Locked-mode overlay color classes. */
const lockedColor = $derived(
  gameStateService.currentMode === 'DIALOGUE'
    ? 'border-info/40 bg-info/10'
    : 'border-base-300/40 bg-base-300/10',
);
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <div class="relative w-screen h-screen overflow-hidden">
    <!-- Game canvas layer -->
    <div class="absolute inset-0 z-0">
      <canvas bind:this={canvasElement} class="w-full h-full block touch-none"></canvas>
    </div>

    <!-- UI overlay layer -->
    <div class="absolute inset-0 z-10 pointer-events-none">
      <!-- Mode Indicator badge (top-right) -->
      <ModeIndicator />

      <!-- Locked Mode Overlay — shown when not in EXPLORE -->
      {#if viewModel.isReady && isLocked}
        <div
          class="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-base-100/40 backdrop-blur-sm"
        >
          <div
            class="rounded-xl border {lockedColor} bg-base-200/90 px-8 py-4 shadow-lg backdrop-blur"
          >
            <p class="text-lg font-bold text-base-content">
              {gameStateService.currentMode}
            </p>
            <p class="mt-1 text-sm text-base-content/50">Movement Locked</p>
          </div>
        </div>
      {/if}

      <!-- Loading overlay -->
      {#if !viewModel.isReady && !viewModel.engineError}
        <div
          class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-base-100/80"
        >
          <p class="text-sm text-base-content/60">Loading sandbox engine...</p>
        </div>
      {/if}

      <!-- Error overlay -->
      {#if viewModel.engineError}
        <div
          class="pointer-events-auto absolute top-4 inset-x-0 mx-auto max-w-sm rounded-lg border border-error/30 bg-error/10 p-3 text-center"
        >
          <p class="text-sm text-error">{viewModel.engineError}</p>
        </div>
      {/if}

      <!-- Mode Control Panel — floating bottom-center -->
      {#if viewModel.isReady}
        <div
          class="pointer-events-auto absolute bottom-6 inset-x-0 mx-auto w-fit rounded-xl border border-base-300 bg-base-200/90 p-3 shadow-lg backdrop-blur-sm"
        >
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-base-content/50 mr-1">Mode:</span>
            <button
              type="button"
              class="btn btn-xs {exploreActive ? 'btn-success' : 'btn-outline'}"
              onclick={() => viewModel.setExploreMode()}
            >
              EXPLORE
            </button>
            <button
              type="button"
              class="btn btn-xs {dialogueActive ? 'btn-info' : 'btn-outline'}"
              onclick={() => viewModel.setDialogueMode()}
            >
              DIALOGUE
            </button>
            <button
              type="button"
              class="btn btn-xs {menuActive ? 'btn-ghost' : 'btn-outline'}"
              onclick={() => viewModel.setMenuMode()}
            >
              MENU
            </button>
          </div>

          <p class="mt-2 text-center text-xs text-base-content/40">
            Press WASD / Arrow Keys to move. Movement is <strong>only</strong> active in EXPLORE
            mode.
          </p>
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
