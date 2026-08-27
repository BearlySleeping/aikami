<script lang="ts">
// apps/frontend/hub/src/lib/views/sandbox/walk_sandbox_view.svelte
// Walk sandbox view (C-447): mounts WalkSandbox engine with debug overlays and HUD.
// Player position is tracked from engine bridge events, not local keyboard state.

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
  let cleanup: (() => void) | undefined;
  let baseVm: { dispose: () => Promise<void> } | undefined;
  let disposed = false;

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
      const mod = await import('@aikami/frontend/preview/sandbox');

      // Create the base WalkSandbox ViewModel
      baseVm = mod.getWalkSandboxViewModel({
        className: 'HubWalkSandbox',
        resolver,
        mapTag: viewModel.mapTag,
      });

      await baseVm.initialize();

      // Clear loading state and await DOM update to ensure canvas is rendered
      loading = false;
      await tick();

      // Initialize engine on the canvas (requires canvas to be in DOM)
      if (!canvasEl) {
        throw new Error('Canvas element not found after DOM update');
      }
      await baseVm.initializeEngine(canvasEl);

      viewModel.setSandboxMounted();

      // Create overlays after successful engine initialization
      if (overlayContainerEl) {
        viewModel.createOverlays(overlayContainerEl, 960, 640);
      }

      // Load overlay data (collision grid, transitions, spawns) from the map
      // using the engine's own data extraction functions
      await viewModel.loadOverlayData();

      // Listen to engine events for player position.
      // The engine emits PLAYER_POSITION_CHANGED events through the bridge.
      try {
        const { createEngineBridge, isWalkable } = await import('@aikami/frontend/engine');
        const bridge = createEngineBridge();

        if (bridge) {
          cleanup = bridge.on('PLAYER_POSITION_CHANGED', (event) => {
            const cellX = Math.floor(event.x / 32);
            const cellY = Math.floor(event.y / 32);
            const walkable = isWalkable(event.x, event.y);
            viewModel.updatePlayerCell(cellX, cellY, walkable);
          });
        }
      } catch {
        // Bridge events are a best-effort enhancement — the HUD will show
        // player position when events arrive
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sandboxError = `Could not load sandbox: ${message}`;
      viewModel.setSandboxError(sandboxError);
      loading = false;
    }
  };

  // Start mounting asynchronously (don't return the promise)
  void _mount();

  // Return a synchronous cleanup function
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;

    if (cleanup) {
      cleanup();
    }
    if (baseVm) {
      void baseVm.dispose().catch(() => {});
    }
  };
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
