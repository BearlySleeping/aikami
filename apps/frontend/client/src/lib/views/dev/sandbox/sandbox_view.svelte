<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/sandbox/sandbox_view.svelte
  import { onMount } from 'svelte';
  import BaseViewModelContainer from '$components/base_view_model_container.svelte';
  import type { SandboxViewModelInterface } from './sandbox_view_model.svelte.ts';

  type Props = {
    viewModel: SandboxViewModelInterface;
  };

  let { viewModel }: Props = $props();

  let canvasElement: HTMLCanvasElement | undefined = $state();

  /**
   * Hands the bound canvas to the ViewModel for engine initialization.
   *
   * The ViewModel manages the full GameWorld lifecycle (Web Worker, PixiJS
   * renderer, keyboard input). The view only provides the canvas reference.
   */
  onMount(() => {
    if (canvasElement) {
      void viewModel.initializeEngine(canvasElement);
    }
  });
</script>

<svelte:head>
  <title>Game Engine Sandbox - Aikami</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div
    class="relative flex min-h-[calc(100vh-6rem)] w-full flex-col overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm"
  >
    <!-- Game engine canvas — fills available space, disabled when dialog is open -->
    <canvas
      bind:this={canvasElement}
      class="flex-1 w-full h-full"
      class:pointer-events-none={viewModel.showDialog}
    ></canvas>

    <!-- Toolbar overlay -->
    <div
      class="absolute top-3 left-3 z-10 rounded-lg bg-base-200/80 px-3 py-1.5 shadow backdrop-blur-sm"
    >
      <span class="text-xs font-medium text-base-content/70">Sandbox</span>
      {#if viewModel.engineError}
        <span class="ml-1.5 text-sm font-semibold text-error">Error</span>
      {:else if viewModel.engineReady}
        <span class="ml-1.5 text-sm font-semibold text-primary">Engine Running</span>
      {:else}
        <span class="ml-1.5 text-sm font-semibold text-warning">Engine Loading…</span>
      {/if}
    </div>

    <!-- Interaction hint — shown when player is near NPC, prompts to press E -->
    {#if viewModel.interactionHint && !viewModel.showDialog}
      <div
        class="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-xl bg-black/70 px-6 py-3 backdrop-blur-md"
      >
        <span class="text-base font-medium text-white">{viewModel.interactionHint}</span>
      </div>
    {/if}
    {#if viewModel.engineError}
      <div
        class="absolute top-12 left-3 z-10 max-w-md rounded-lg bg-error/10 px-3 py-1.5 backdrop-blur-sm"
      >
        <span class="text-xs font-mono text-error">{viewModel.engineError}</span>
      </div>
    {/if}

    <!-- NPC Dialog overlay — pauses game, blocks input -->
    {#if viewModel.showDialog}
      <div class="absolute inset-0 z-20 flex items-end justify-center pb-16">
        <div
          class="mx-4 w-full max-w-lg rounded-2xl border border-base-300 bg-base-200/95 p-6 shadow-2xl backdrop-blur-xl"
        >
          <!-- NPC name -->
          <h3 class="mb-1 text-sm font-semibold tracking-wide text-accent uppercase">
            {viewModel.dialogNpcName}
          </h3>

          <!-- Dialog text with streaming indicator -->
          <div class="mb-4 min-h-[3rem]">
            {#if viewModel.dialogText}
              <p class="text-base leading-relaxed text-base-content">
                {viewModel.dialogText}
                {#if viewModel.isStreaming}
                  <span
                    class="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent align-middle"
                    aria-label="AI is typing"
                  ></span>
                {/if}
              </p>
            {:else if viewModel.isStreaming}
              <div class="flex items-center gap-1.5 text-sm text-base-content/60">
                <span>Thinking</span>
                <span class="flex gap-1">
                  <span
                    class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-accent"
                    style="animation-delay: 0ms"
                  ></span>
                  <span
                    class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-accent"
                    style="animation-delay: 150ms"
                  ></span>
                  <span
                    class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-accent"
                    style="animation-delay: 300ms"
                  ></span>
                </span>
              </div>
            {/if}
          </div>

          <!-- Dismiss button -->
          <div class="flex justify-end">
            <button
              class="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-content transition hover:brightness-110"
              onclick={() => viewModel.dismissDialog()}
            >
              {viewModel.isStreaming ? 'Skip' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
