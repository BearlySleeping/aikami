<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/sandbox/camera/camera_sandbox_view.svelte
  //
  // Camera & Spatial UI sandbox — renders the game canvas, spatial speech
  // bubble, and collapsible devtools panel with debug event log.
  //
  // Contract: C-161 Spatial UI Camera — devtool sandbox

  import { onMount } from 'svelte';
  import BaseViewModelContainer from '$components/base_view_model_container.svelte';
  import type { CameraSandboxViewModelInterface } from './camera_sandbox_view_model.svelte.ts';

  type Props = {
    viewModel: CameraSandboxViewModelInterface;
  };

  let { viewModel }: Props = $props();

  let canvasElement: HTMLCanvasElement | undefined = $state();
  let devtoolsCollapsed = $state(false);

  onMount(() => {
    if (canvasElement) {
      void viewModel.initializeEngine(canvasElement);
    }
  });
</script>

<svelte:head>
  <title>Camera & Spatial UI Sandbox — Aikami</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div
    class="relative flex min-h-[calc(100vh-6rem)] w-full flex-col overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm"
  >
    <canvas bind:this={canvasElement} class="flex-1 w-full h-full"></canvas>

    <!-- Spatial Speech Bubble -->
    {#if viewModel.trackingNpcPosition && viewModel.npcScreenX >= 0}
      {@const clampedX = Math.max(16, Math.min(viewModel.npcScreenX, window.innerWidth - 16))}
      {@const clampedY = Math.max(16, Math.min(viewModel.npcScreenY, window.innerHeight - 16))}
      <div
        class="spatial-bubble pointer-events-none absolute z-30 rounded-xl bg-base-100/95 border-2 border-primary/50 px-4 py-2 text-sm font-bold text-base-content shadow-2xl backdrop-blur-sm"
        style="left: {clampedX}px; top: {clampedY - 56}px; transform: translate(-50%, -100%);"
      >
        <div class="flex items-center gap-1.5">
          <span class="text-lg">💬</span>
          <span>Hello, traveler!</span>
        </div>
        <div
          class="absolute left-1/2 top-full -translate-x-1/2 border-[6px] border-transparent border-t-primary/50"
        ></div>
      </div>
    {/if}

    <!-- Status (top-left) -->
    <div
      class="absolute top-3 left-3 z-10 rounded-lg bg-base-200/80 px-3 py-1.5 shadow backdrop-blur-sm"
    >
      <span class="text-xs font-medium text-base-content/70">Camera Sandbox</span>
      {#if viewModel.engineError}
        <span class="ml-1.5 text-sm font-semibold text-error">Error</span>
      {:else if viewModel.engineReady}
        <span class="ml-1.5 text-sm font-semibold text-success">Running</span>
        <span class="ml-1 text-xs text-base-content/50">({viewModel.npcCount} NPCs)</span>
      {:else}
        <span class="ml-1.5 text-sm font-semibold text-warning">Loading…</span>
      {/if}
    </div>

    <!-- Devtools toggle -->
    <button
      type="button"
      class="absolute top-3 right-3 z-50 btn btn-xs btn-ghost gap-1 rounded-lg bg-base-200/80 backdrop-blur-sm"
      onclick={() => (devtoolsCollapsed = !devtoolsCollapsed)}
    >
      {devtoolsCollapsed ? '📷 Show Inspector' : '📷 Hide Inspector'}
    </button>

    <!-- Map name -->
    {#if viewModel.currentMap}
      <div
        class="absolute top-3 right-36 z-10 rounded-lg bg-base-300/70 px-3 py-1.5 shadow backdrop-blur-sm"
      >
        <span class="text-xs font-mono text-base-content/60">{viewModel.currentMap}</span>
      </div>
    {/if}

    <!-- Engine error -->
    {#if viewModel.engineError}
      <div
        class="absolute top-12 left-3 z-20 max-w-md rounded-lg bg-error/10 px-3 py-1.5 backdrop-blur-sm"
      >
        <span class="text-xs font-mono text-error">{viewModel.engineError}</span>
      </div>
    {/if}

    <!-- Interaction hint -->
    {#if viewModel.interactionHint}
      <div
        class="absolute bottom-20 left-1/2 z-20 -translate-x-1/2 rounded-xl bg-black/70 px-6 py-3 backdrop-blur-md"
      >
        <span class="text-base font-medium text-white">{viewModel.interactionHint}</span>
      </div>
    {/if}

    <!-- Dialogue Card — shown when zoom is active -->
    {#if viewModel.dialogueZoomActive && viewModel.activeNpcName}
      <div
        class="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 w-full max-w-lg rounded-2xl border-2 border-primary/40 bg-base-200/95 p-5 shadow-2xl backdrop-blur-xl"
      >
        <div class="flex items-center gap-2 mb-2">
          <span class="text-sm font-bold uppercase tracking-wide text-primary"
            >{viewModel.activeNpcName}</span
          >
          {#if viewModel.mockDialogueActive}
            <span class="badge badge-xs badge-info">DIALOGUE</span>
          {/if}
        </div>
        <p class="text-sm leading-relaxed text-base-content">
          {viewModel.activeNpcDialog || '...'}
        </p>
        <div class="mt-3 flex justify-end">
          <button
            type="button"
            class="btn btn-sm btn-primary"
            onclick={() => viewModel.endMockDialogue()}
          >
            End Conversation
          </button>
        </div>
      </div>
    {/if}

    <!-- Collapsible Devtools Panel -->
    {#if !devtoolsCollapsed}
      <div class="absolute bottom-4 left-4 z-40 flex flex-col gap-2 max-h-[70vh]">
        <!-- Camera Inspector -->
        <div
          class="rounded-xl border border-primary/30 bg-base-200/95 px-4 py-3 shadow-xl backdrop-blur-md min-w-[280px]"
        >
          <div class="mb-2 flex items-center justify-between">
            <span class="text-xs font-semibold uppercase tracking-widest text-primary"
              >📷 Camera</span
            >
            {#if viewModel.dialogueZoomActive}
              <span class="badge badge-xs badge-primary">ZOOMED</span>
            {:else}
              <span class="badge badge-xs badge-ghost">NORMAL</span>
            {/if}
          </div>

          <div class="mb-2 space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs text-base-content/60">Zoom</span>
              <span
                class="font-mono text-xs font-bold"
                class:text-primary={viewModel.cameraZoom > 1.01}
              >
                {viewModel.cameraZoom.toFixed(3)}×
              </span>
            </div>
            <div class="h-1.5 w-full rounded-full bg-base-300">
              <div
                class="h-full rounded-full bg-primary transition-all duration-100"
                style="width: {Math.min(100, ((viewModel.cameraZoom - 1.0) / 0.5) * 100)}%"
              ></div>
            </div>
          </div>

          {#if viewModel.trackingNpcPosition}
            <div class="grid grid-cols-2 gap-2 mb-2">
              <div class="rounded-md bg-base-300/50 px-2 py-1">
                <span class="text-[10px] text-base-content/40">NPC X</span>
                <span class="ml-1 font-mono text-xs font-bold text-accent"
                  >{viewModel.npcScreenX.toFixed(0)}</span
                >
              </div>
              <div class="rounded-md bg-base-300/50 px-2 py-1">
                <span class="text-[10px] text-base-content/40">NPC Y</span>
                <span class="ml-1 font-mono text-xs font-bold text-accent"
                  >{viewModel.npcScreenY.toFixed(0)}</span
                >
              </div>
            </div>
          {/if}
        </div>

        <!-- Controls -->
        <div
          class="rounded-xl border border-base-300 bg-base-200/95 px-4 py-3 shadow-xl backdrop-blur-md min-w-[280px]"
        >
          <div class="mb-2 flex items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-widest text-base-content/70"
              >🎮 Controls</span
            >
          </div>

          <div class="flex gap-2">
            <button
              type="button"
              class="btn btn-sm gap-1 flex-1"
              class:btn-primary={!viewModel.mockDialogueActive}
              class:btn-error={viewModel.mockDialogueActive}
              onclick={() => viewModel.toggleMockDialogue()}
              disabled={!viewModel.engineReady}
            >
              {viewModel.mockDialogueActive ? '✕ End' : '▶ Mock Dialogue'}
            </button>
          </div>

          <p class="mt-2 text-[10px] text-base-content/40 leading-tight">
            <strong>Tip:</strong>
            Walk near NPC, press <kbd class="kbd kbd-xs">E</kbd>. Or use
            <code class="text-[10px]">?trigger</code>
            query param for auto-dialogue.
          </p>
        </div>

        <!-- Debug Event Log -->
        <div
          class="rounded-xl border border-warning/30 bg-base-200/95 px-3 py-2 shadow-xl backdrop-blur-md min-w-[280px] max-h-[200px] flex flex-col"
        >
          <div class="mb-1 flex items-center justify-between">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-warning"
              >🐛 Event Log ({viewModel.debugLog.length})</span
            >
            <button
              type="button"
              class="btn btn-ghost btn-xs text-[10px]"
              onclick={() => viewModel.clearDebugLog()}
            >
              Clear
            </button>
          </div>
          <div class="flex-1 overflow-y-auto space-y-0.5 font-mono text-[10px]">
            {#if viewModel.debugLog.length === 0}
              <span class="text-base-content/30 italic">No events yet...</span>
            {:else}
              {#each viewModel.debugLog as entry}
                <div class="flex gap-1.5">
                  <span class="shrink-0 text-base-content/30"
                    >{new Date(entry.time).toISOString().slice(11, 19)}</span
                  >
                  <span class="font-semibold text-warning">{entry.label}</span>
                  {#if entry.detail}
                    <span class="text-base-content/50">{entry.detail}</span>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
