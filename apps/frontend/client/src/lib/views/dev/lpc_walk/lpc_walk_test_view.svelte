<script lang="ts">
// apps/frontend/client/src/lib/views/dev/lpc_walk/lpc_walk_test_view.svelte
//
// LPC Walk Animation Tester View — WASD-driven character with debug overlay
// showing animation state, frame index, direction, and FPS.

import BaseViewModelContainer from '$components/base_view_model_container.svelte';
import type { LpcWalkTestViewModelInterface } from './lpc_walk_test_view_model.svelte';

type Props = {
  viewModel: LpcWalkTestViewModelInterface;
};

const { viewModel }: Props = $props();

const stateClass = $derived(viewModel.isIdle ? 'text-base-content/40' : 'text-success');

const stuckWarning = $derived(viewModel.stuckFrameTicks > 30);

const idleMismatch = $derived(
  viewModel.isIdle && (viewModel.velocityX !== 0 || viewModel.velocityY !== 0),
);
</script>

<BaseViewModelContainer {viewModel}>
  <div class="min-h-screen bg-base-100 flex flex-col items-center justify-center p-4 gap-4">
    <h1 class="text-xl font-bold">LPC Walk Animation Tester</h1>
    <p class="text-sm text-base-content/60 mb-2">
      Use <kbd class="kbd kbd-xs">W</kbd><kbd class="kbd kbd-xs">A</kbd
      ><kbd class="kbd kbd-xs">S</kbd><kbd class="kbd kbd-xs">D</kbd>
      to move. Check browser console for detailed debug logs.
    </p>

    <div class="relative inline-block">
      <canvas
        bind:this={viewModel.canvasElement}
        class="rounded border border-base-300"
        width={768}
        height={512}
        style="image-rendering: pixelated;"
      ></canvas>

      <!-- Debug Overlay -->
      <div
        class="absolute top-2 left-2 bg-base-300/90 text-xs font-mono p-2 rounded pointer-events-none leading-relaxed max-w-[200px]"
      >
        <div
          class="text-primary/70 uppercase tracking-wider text-[0.65rem] mb-1 border-b border-base-100 pb-0.5"
        >
          Animation
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-base-content/60">Frame</span>
          <span class="tabular-nums">{viewModel.animFrame} / {9}</span>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-base-content/60">Dir</span>
          <span class="tabular-nums">{viewModel.directionLabel}</span>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-base-content/60">State</span>
          <span class="tabular-nums {stateClass}">
            {viewModel.isIdle ? 'Idle' : 'Walking'}
          </span>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-base-content/60">Vel</span>
          <span class="tabular-nums">({viewModel.velocityX},{viewModel.velocityY})</span>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-base-content/60">Ticks</span>
          <span class="tabular-nums">{viewModel.effectiveTicks}</span>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-base-content/60">FPS</span>
          <span class="tabular-nums">{viewModel.fps.toFixed(1)}</span>
        </div>

        <div
          class="text-primary/70 uppercase tracking-wider text-[0.65rem] mt-1 mb-1 border-b border-base-100 pb-0.5"
        >
          Textures
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-base-content/60">Sprites</span>
          <span class="tabular-nums">{viewModel.loadedLayers}/{viewModel.totalLayers}</span>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-base-content/60">Ticker</span>
          <span class="tabular-nums">{viewModel.tickCount}</span>
        </div>

        {#if viewModel.missingAssets.length > 0}
          <div class="mt-1 pt-1 border-t border-error/30 text-error text-[0.65rem]">
            ⚠️ Missing: {viewModel.missingAssets.join(', ')}
          </div>
        {/if}

        {#if idleMismatch}
          <div class="mt-1 pt-1 border-t border-error/30 text-error text-[0.65rem]">
            ⚠️ Vel non-zero, idle!
          </div>
        {/if}

        {#if stuckWarning}
          <div class="mt-1 pt-1 border-t border-warning/30 text-warning text-[0.65rem]">
            ⚡ Stuck {viewModel.stuckFrameTicks} ticks at frame 0
          </div>
        {/if}
      </div>

      {#if !viewModel.isReady}
        <div class="absolute inset-0 flex items-center justify-center bg-base-300/80 rounded">
          <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>
      {/if}
    </div>

    <p class="text-xs text-base-content/40 mt-2">
      Open browser console (F12) to see detailed debug logs from the ViewModel.
    </p>
  </div>
</BaseViewModelContainer>
