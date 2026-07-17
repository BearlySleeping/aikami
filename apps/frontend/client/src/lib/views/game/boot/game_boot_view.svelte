<script lang="ts">
// apps/frontend/client/src/lib/views/game/boot/game_boot_view.svelte
//
// Zero-logic View for the staged game boot loading/error UI.
// Replaces the inline "Loading game engine..." overlay in game_canvas_view.
//
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { GameBootViewModelInterface } from './game_boot_view_model.svelte';

type Props = {
  viewModel: GameBootViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col items-center justify-center h-full w-full gap-4 px-4">
    <!-- Error state: failure panel with Retry and Return-to-menu -->
    {#if viewModel.isFailed}
      <div
        class="pointer-events-auto rounded-lg border border-error/30 bg-error/10 p-6 max-w-md w-full text-center"
        role="alert"
        aria-live="assertive"
      >
        <h2 class="text-lg font-semibold text-error mb-2">Boot Failed</h2>
        <p class="text-sm text-error/80 mb-4">{viewModel.bootErrorMessage}</p>
        <div class="flex gap-3 justify-center">
          <button
            class="btn btn-primary btn-sm"
            onclick={() => viewModel.retryBoot()}
            type="button"
          >
            Retry
          </button>
          <button
            class="btn btn-ghost btn-sm"
            onclick={() => viewModel.returnToMenu()}
            type="button"
          >
            Return to Menu
          </button>
        </div>
      </div>
    {:else}
      <!-- Loading state: stage label + progress bar -->
      <div class="flex flex-col items-center gap-3 max-w-sm w-full" aria-live="polite">
        <div class="text-sm text-base-content/60">
          {viewModel.stageLabel}
        </div>

        <!-- Progress bar -->
        <progress
          class="progress progress-primary w-full"
          value={viewModel.stageIndex}
          max={viewModel.stageCount}
          aria-label="Boot progress: {viewModel.stageIndex} of {viewModel.stageCount} stages complete"
        ></progress>

        <div class="text-xs text-base-content/40">
          Stage {viewModel.stageIndex + 1} of {viewModel.stageCount}
        </div>
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
