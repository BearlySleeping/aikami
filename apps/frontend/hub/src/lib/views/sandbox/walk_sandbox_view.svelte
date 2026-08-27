<script lang="ts">
// apps/frontend/hub/src/lib/views/sandbox/walk_sandbox_view.svelte
// Walk sandbox view (C-447): mounts WalkSandbox engine with debug overlays and HUD.

import { onMount, tick } from 'svelte';
import BaseViewModelContainer from '$components/base_view_model_container.svelte';
import type { HubWalkSandboxViewModelInterface } from './walk_sandbox_view_model.svelte.ts';

type Props = { viewModel: HubWalkSandboxViewModelInterface };
let { viewModel }: Props = $props();

let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);
let overlayContainerEl = $state<HTMLDivElement | undefined>(undefined);
let sandboxError = $state<string | undefined>(undefined);
let loading = $state(true);

// ── Lifecycle ─────────────────────────────────────────────────────────────

onMount(() => {
  const _mount = async () => {
    try {
      // Build the CDN resolver
      const resolver = await viewModel.ensureResolverBuilt();
      if (!resolver) {
        sandboxError = 'Could not create asset resolver.';
        viewModel.setSandboxError('Could not create asset resolver.');
        loading = false;
        return;
      }

      // Dynamically import WalkSandbox ViewModel (avoids pulling engine into server bundle)
      const { getWalkSandboxViewModel: getBaseVm } = await import(
        '@aikami/frontend/preview/sandbox'
      );

      // Create the base WalkSandbox ViewModel
      const baseVm = getBaseVm({
        className: 'HubWalkSandbox',
        resolver,
        mapTag: viewModel.mapTag,
      });

      await baseVm.initialize();

      // Initialize engine on the canvas
      if (canvasEl) {
        await baseVm.initializeEngine(canvasEl);
      }

      viewModel.setSandboxMounted();
      loading = false;

      // Create overlays after the DOM updates
      await tick();
      if (overlayContainerEl) {
        viewModel.createOverlays(overlayContainerEl, 960, 640);
      }

      // Listen to engine events for player position
      // The engine emits PLAYER_POSITION_CHANGED events through the bridge
      // For now, we track position via keyboard events on the canvas
      const handleKeyDown = (e: KeyboardEvent) => {
        // Arrow keys and WASD
        const key = e.key.toLowerCase();
        let dx = 0;
        let dy = 0;
        if (key === 'arrowup' || key === 'w') {
          dy = -1;
        } else if (key === 'arrowdown' || key === 's') {
          dy = 1;
        } else if (key === 'arrowleft' || key === 'a') {
          dx = -1;
        } else if (key === 'arrowright' || key === 'd') {
          dx = 1;
        }
        if (dx !== 0 || dy !== 0) {
          // Update player cell (approximate from movement)
          const current = viewModel.playerCell ?? { x: 0, y: 0 };
          const newX = current.x + dx;
          const newY = current.y + dy;
          viewModel.updatePlayerCell(newX, newY, true);
        }
      };

      window.addEventListener('keydown', handleKeyDown);

      // Cleanup
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        void baseVm.dispose().catch(() => {});
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sandboxError = `Could not load sandbox: ${message}`;
      viewModel.setSandboxError(sandboxError);
      loading = false;
    }
  };
  return _mount();
});

// ── Overlay toggle labels ─────────────────────────────────────────────────

const walkableLabel = (walkable: boolean | undefined): string => {
  if (walkable === undefined) {
    return '—';
  }
  return walkable ? 'Yes' : 'No';
};

const OVERLAY_LABELS: Record<string, string> = {
  collision: 'Collision',
  zBands: 'Z-Bands',
  renderOrder: 'Render Order',
  transitions: 'Transitions',
  spawns: 'Spawns',
} as const;
</script>

<BaseViewModelContainer
  {viewModel}
  id="walk-sandbox"
  class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4"
>
  <!-- Error state -->
  {#if sandboxError}
    <div
      class="flex flex-col items-center gap-4 rounded-lg border border-error bg-error/5 p-8 text-center"
      role="alert"
      aria-live="polite"
      data-testid="sandbox-error"
    >
      <span class="text-2xl">⚠️</span>
      <p class="text-base-content">{sandboxError}</p>
    </div>
  {:else if !loading}
    <!-- Canvas with overlay container -->
    <div
      class="relative overflow-hidden rounded-box border border-base-300 bg-base-300"
      bind:this={overlayContainerEl}
    >
      <canvas
        bind:this={canvasEl}
        width="960"
        height="640"
        class="block w-full"
        aria-label="Walk sandbox — interactive map preview"
        data-testid="sandbox-canvas"
        tabindex="0"
      ></canvas>
    </div>

    <!-- Debug overlay toggles -->
    <fieldset class="flex flex-wrap gap-2 border-0 p-0" aria-label="Debug overlays">
      {#each Object.keys(OVERLAY_LABELS) as key (key)}
        <button
          type="button"
          class="btn btn-xs {viewModel.overlays[key as keyof typeof viewModel.overlays]
            ? 'btn-primary'
            : 'btn-ghost'}"
          onclick={() => viewModel.toggleOverlay(key as keyof typeof viewModel.overlays)}
          data-testid="sandbox-overlay-toggle-{key}"
        >
          {OVERLAY_LABELS[key]}
        </button>
      {/each}
    </fieldset>

    <!-- HUD: player cell info -->
    {#if viewModel.playerCell}
      <div
        class="flex flex-wrap items-center gap-4 rounded-lg border border-base-300 bg-base-200/50 px-4 py-2 text-xs"
        data-testid="sandbox-hud"
      >
        <span>
          Cell:
          <strong data-testid="sandbox-player-cell"
            >{viewModel.playerCell.x}, {viewModel.playerCell.y}</strong
          >
        </span>
        <span>
          Walkable:
          <strong
            class:text-success={viewModel.playerCellWalkable}
            class:text-error={!viewModel.playerCellWalkable}
            data-testid="sandbox-player-walkable"
          >
            {walkableLabel(viewModel.playerCellWalkable)}
          </strong>
        </span>
        {#if viewModel.spawnClamped}
          <span class="text-warning" data-testid="sandbox-spawn-clamped">
            Spawn clamped (out of bounds)
          </span>
        {/if}
        <button
          type="button"
          class="btn btn-xs btn-ghost ml-auto"
          onclick={() => viewModel.copyReproLink()}
          data-testid="sandbox-copy-repro"
        >
          Copy Repro Link
        </button>
      </div>
    {/if}
  {:else}
    <!-- Loading state -->
    <div
      class="flex items-center justify-center rounded-box border border-base-300 bg-base-300 p-16"
      data-testid="sandbox-loading"
    >
      <span class="loading loading-spinner loading-lg text-base-content/40"></span>
    </div>
  {/if}
</BaseViewModelContainer>
